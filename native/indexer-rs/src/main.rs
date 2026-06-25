// Keep our small handwritten SQLite FFI surface, but use libsqlite3-sys to
// provide bundled/static SQLite link metadata for packaged helpers.
extern crate libsqlite3_sys as _;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::env;
use std::ffi::{CStr, CString};
use std::fs;
use std::io::Write;
use std::os::raw::{c_char, c_double, c_int, c_void};
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::ptr;

const ABI_VERSION: u32 = 1;
const ENGINE: &str = "native-rust";
const MODE_FULL: &str = "full";
const MODE_INCREMENTAL: &str = "incremental";
const SCHEMA_VERSION: &str = "5";
const SQLITE_DIRECT_WARNING: &str = "sqlite3-direct-ffi";
const SQLITE_BRIDGE_WARNING: &str = "sqlite3-cli-bridge";
const ROW_STREAM_WARNING: &str = "row-stream";
const PARALLEL_INDEX_FILE_THRESHOLD: usize = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputMode {
    RowStream,
    SqliteBridge,
    SqliteDirect,
}

impl OutputMode {
    fn from_manifest(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("sqlite-direct") {
            "row-stream" => Ok(Self::RowStream),
            "sqlite-bridge" => Ok(Self::SqliteBridge),
            "sqlite-direct" => Ok(Self::SqliteDirect),
            other => Err(format!(
                "unsupported output_mode: {other}; expected row-stream, sqlite-bridge, or sqlite-direct"
            )),
        }
    }

    fn warning(self) -> &'static str {
        match self {
            Self::RowStream => ROW_STREAM_WARNING,
            Self::SqliteBridge => SQLITE_BRIDGE_WARNING,
            Self::SqliteDirect => SQLITE_DIRECT_WARNING,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ManifestFile {
    language: String,
    #[serde(rename = "mtimeMs")]
    mtime_ms: f64,
    path: String,
    profile: String,
    size: u64,
}

#[derive(Debug, Deserialize)]
struct Manifest {
    abi_version: u32,
    database_path: String,
    #[serde(default)]
    deleted_paths: Vec<String>,
    engine: String,
    files: Vec<ManifestFile>,
    mode: String,
    output_mode: Option<String>,
    parser_mode: String,
    project_root: String,
    rows_path: Option<String>,
    schema_version: String,
    scopes: Vec<String>,
}

#[derive(Default)]
struct Counts {
    configs: usize,
    edges: usize,
    files: usize,
    imports: usize,
    routes: usize,
    symbols: usize,
}

#[derive(Serialize)]
struct Summary {
    engine: String,
    schema_version: String,
    mode: String,
    database: String,
    files: usize,
    native_files: usize,
    typescript_files: usize,
    reindexed_files: usize,
    deleted_files: usize,
    unchanged_files: usize,
    symbols: usize,
    imports: usize,
    routes: usize,
    configs: usize,
    edges: usize,
    elapsed_ms: f64,
    unsupported_profiles: Vec<String>,
    warnings: Vec<String>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let manifest_path = parse_manifest_arg()?;
    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "failed to read manifest {}: {error}",
            manifest_path.display()
        )
    })?;
    let manifest: Manifest = serde_json::from_str(&manifest_text)
        .map_err(|error| format!("failed to parse manifest JSON: {error}"))?;
    validate_manifest(&manifest)?;
    let output_mode = OutputMode::from_manifest(manifest.output_mode.as_deref())?;

    let started = std::time::Instant::now();
    let rows = collect_index_rows(&manifest)?;
    match manifest.mode.as_str() {
        MODE_FULL => match output_mode {
            OutputMode::RowStream => write_row_stream(&manifest, &rows)?,
            OutputMode::SqliteBridge => {
                let sql = build_sql(&manifest, &rows)?;
                write_database_with_sqlite_bridge(&manifest.database_path, &sql)?;
            }
            OutputMode::SqliteDirect => write_database_direct(&manifest, &rows)?,
        },
        MODE_INCREMENTAL => write_database_incremental_direct(&manifest, &rows)?,
        _ => unreachable!("manifest mode is validated"),
    }
    let counts = rows.counts();
    let summary = Summary {
        engine: ENGINE.to_string(),
        schema_version: manifest.schema_version.clone(),
        mode: manifest.mode.clone(),
        database: manifest.database_path.clone(),
        files: counts.files,
        native_files: counts.files,
        typescript_files: 0,
        reindexed_files: counts.files,
        deleted_files: manifest.deleted_paths.len(),
        unchanged_files: 0,
        symbols: counts.symbols,
        imports: counts.imports,
        routes: counts.routes,
        configs: counts.configs,
        edges: counts.edges,
        elapsed_ms: started.elapsed().as_secs_f64() * 1000.0,
        unsupported_profiles: Vec::new(),
        warnings: vec![output_mode.warning().to_string()],
    };
    println!(
        "{}",
        serde_json::to_string(&summary)
            .map_err(|error| format!("failed to render summary JSON: {error}"))?
    );
    Ok(())
}

fn parse_manifest_arg() -> Result<PathBuf, String> {
    let args: Vec<String> = env::args().collect();
    let mut index = 1;
    while index < args.len() {
        if args[index] == "--manifest" {
            let value = args.get(index + 1).ok_or("missing value for --manifest")?;
            return Ok(PathBuf::from(value));
        }
        index += 1;
    }
    Err("usage: project-librarian-indexer --manifest <path>".to_string())
}

fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.abi_version != ABI_VERSION {
        return Err(format!(
            "unsupported ABI version: expected {ABI_VERSION}, got {}",
            manifest.abi_version
        ));
    }
    if manifest.engine != ENGINE {
        return Err(format!(
            "unsupported engine: expected {ENGINE}, got {}",
            manifest.engine
        ));
    }
    if manifest.mode != MODE_FULL && manifest.mode != MODE_INCREMENTAL {
        return Err(format!(
            "unsupported mode: expected {MODE_FULL} or {MODE_INCREMENTAL}, got {}",
            manifest.mode
        ));
    }
    if manifest.schema_version != SCHEMA_VERSION {
        return Err(format!(
            "unsupported schema version: expected {SCHEMA_VERSION}, got {}",
            manifest.schema_version
        ));
    }
    if manifest.project_root.trim().is_empty() || !Path::new(&manifest.project_root).is_absolute() {
        return Err("project_root must be an absolute path".to_string());
    }
    if !Path::new(&manifest.database_path).is_absolute() {
        return Err("database_path must be absolute".to_string());
    }
    validate_database_path(&manifest.project_root, &manifest.database_path)?;
    let output_mode = OutputMode::from_manifest(manifest.output_mode.as_deref())?;
    if manifest.mode == MODE_INCREMENTAL && output_mode != OutputMode::SqliteDirect {
        return Err("incremental mode requires output_mode sqlite-direct".to_string());
    }
    if output_mode == OutputMode::RowStream {
        let rows_path = manifest
            .rows_path
            .as_deref()
            .ok_or("rows_path is required when output_mode is row-stream")?;
        validate_rows_path(rows_path)?;
    }
    for scope in &manifest.scopes {
        validate_relative_path(scope, "scope")?;
    }
    let mut seen_deleted_paths = BTreeSet::new();
    for deleted_path in &manifest.deleted_paths {
        validate_relative_path(deleted_path, "deleted path")?;
        if !seen_deleted_paths.insert(deleted_path.clone()) {
            return Err(format!("duplicate deleted path: {deleted_path}"));
        }
    }
    if manifest.mode == MODE_FULL && !manifest.deleted_paths.is_empty() {
        return Err("deleted_paths is only supported in incremental mode".to_string());
    }
    if manifest.mode == MODE_INCREMENTAL && !Path::new(&manifest.database_path).exists() {
        return Err(format!(
            "incremental mode requires an existing database: {}",
            manifest.database_path
        ));
    }
    let mut seen_paths = BTreeSet::new();
    for file in &manifest.files {
        validate_relative_path(&file.path, "file path")?;
        if !seen_paths.insert(file.path.clone()) {
            return Err(format!("duplicate manifest file path: {}", file.path));
        }
        if !native_supported_profile(&file.profile) {
            return Err(format!(
                "native helper does not support profile {} for {}",
                file.profile, file.path
            ));
        }
        validate_profile_language(file)?;
        let path = contained_path(&manifest.project_root, &file.path)?;
        let stat = fs::metadata(&path)
            .map_err(|error| format!("failed to stat {}: {error}", path.display()))?;
        if stat.len() != file.size {
            return Err(format!(
                "manifest size mismatch for {}: expected {}, got {}",
                file.path,
                file.size,
                stat.len()
            ));
        }
    }
    Ok(())
}

fn native_supported_profile(profile: &str) -> bool {
    matches!(
        profile,
        "typescript-ast"
            | "config"
            | "python-light"
            | "go-light"
            | "c-light"
            | "cpp-light"
            | "csharp-light"
            | "java-light"
            | "kotlin-light"
            | "php-light"
            | "rust-light"
            | "swift-light"
            | "inventory-only"
    )
}

fn validate_profile_language(file: &ManifestFile) -> Result<(), String> {
    let valid = match file.profile.as_str() {
        "typescript-ast" => file.language == "javascript" || file.language == "typescript",
        "config" => file.language == "config",
        "python-light" => file.language == "python",
        "go-light" => file.language == "go",
        "c-light" => file.language == "c",
        "cpp-light" => file.language == "cpp",
        "csharp-light" => file.language == "csharp",
        "java-light" => file.language == "java",
        "kotlin-light" => file.language == "kotlin",
        "php-light" => file.language == "php",
        "rust-light" => file.language == "rust",
        "swift-light" => file.language == "swift",
        "inventory-only" => file.language != "config",
        _ => false,
    };
    if valid {
        Ok(())
    } else {
        Err(format!(
            "native helper profile/language mismatch for {}: {} / {}",
            file.path, file.profile, file.language
        ))
    }
}

fn validate_rows_path(rows_path: &str) -> Result<(), String> {
    let path = Path::new(rows_path);
    if !path.is_absolute() {
        return Err(format!("rows_path must be absolute: {rows_path}"));
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("invalid rows_path: {rows_path}"))?;
    if !parent.exists() {
        return Err(format!(
            "rows_path parent does not exist: {}",
            parent.display()
        ));
    }
    Ok(())
}

fn validate_database_path(project_root: &str, database_path: &str) -> Result<(), String> {
    let root_path = canonical_project_root(project_root)?;
    let database = Path::new(database_path);
    let parent = database
        .parent()
        .ok_or_else(|| format!("invalid database path: {database_path}"))?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|error| format!("invalid database parent {}: {error}", parent.display()))?;
    if !canonical_parent.starts_with(&root_path) {
        return Err(format!(
            "database path must stay inside the project root: {database_path}"
        ));
    }
    Ok(())
}

fn validate_relative_path(path: &str, label: &str) -> Result<(), String> {
    if path.trim().is_empty() {
        return Err(format!("{label} must not be empty"));
    }
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(format!("{label} must be project-relative: {path}"));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(format!("{label} must not escape the project root: {path}")),
        }
    }
    Ok(())
}

fn build_sql(manifest: &Manifest, rows: &IndexRows) -> Result<String, String> {
    let mut sql = String::new();
    sql.push_str(setup_database_sql());
    sql.push_str(create_index_sql());
    sql.push_str("BEGIN;\n");
    insert_meta(&mut sql, "created_at", &timestamp_placeholder());
    insert_meta(&mut sql, "schema_version", &manifest.schema_version);
    insert_meta(&mut sql, "updated_at", &timestamp_placeholder());
    insert_meta(&mut sql, "root", &manifest.project_root);
    insert_meta(&mut sql, "scopes", &manifest.scopes.join(", "));
    insert_meta(
        &mut sql,
        "scopes_json",
        &serde_json::to_string(&manifest.scopes)
            .map_err(|error| format!("failed to serialize scopes metadata: {error}"))?,
    );
    insert_meta(&mut sql, "parser_mode", &manifest.parser_mode);
    insert_meta(&mut sql, "terminology", "code evidence index");

    for file in &rows.files {
        insert_file_row(&mut sql, file);
    }
    for symbol in &rows.symbols {
        insert_symbol_row(&mut sql, symbol);
    }
    for import in &rows.imports {
        insert_import_row(&mut sql, import);
    }
    for route in &rows.routes {
        insert_route_row(&mut sql, route);
    }
    for config in &rows.configs {
        insert_config_row(&mut sql, config);
    }
    for edge in &rows.edges {
        insert_edge_row(&mut sql, edge);
    }
    sql.push_str("COMMIT;\n");
    sql.push_str(finalize_database_sql());
    Ok(sql)
}

fn canonical_project_root(root: &str) -> Result<PathBuf, String> {
    Path::new(root)
        .canonicalize()
        .map_err(|error| format!("invalid project root {root}: {error}"))
}

fn contained_path(root: &str, relative: &str) -> Result<PathBuf, String> {
    let root_path = canonical_project_root(root)?;
    contained_path_from_root(&root_path, relative)
}

fn contained_path_from_root(root_path: &Path, relative: &str) -> Result<PathBuf, String> {
    let candidate = root_path.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("invalid file path {relative}: {error}"))?;
    if !canonical.starts_with(root_path) {
        return Err(format!("manifest file escapes project root: {relative}"));
    }
    Ok(candidate)
}

#[derive(Default, Serialize)]
struct IndexRows {
    configs: Vec<ConfigIndexRow>,
    edges: Vec<EdgeIndexRow>,
    files: Vec<FileIndexRow>,
    imports: Vec<ImportIndexRow>,
    routes: Vec<RouteIndexRow>,
    symbols: Vec<SymbolIndexRow>,
}

impl IndexRows {
    fn counts(&self) -> Counts {
        Counts {
            configs: self.configs.len(),
            edges: self.edges.len(),
            files: self.files.len(),
            imports: self.imports.len(),
            routes: self.routes.len(),
            symbols: self.symbols.len(),
        }
    }

    fn append(&mut self, mut other: IndexRows) {
        self.configs.append(&mut other.configs);
        self.files.append(&mut other.files);
        self.symbols.append(&mut other.symbols);
        self.imports.append(&mut other.imports);
        self.routes.append(&mut other.routes);
        self.edges.append(&mut other.edges);
    }
}

#[derive(Serialize)]
struct ConfigIndexRow {
    file_path: String,
    key: String,
    line: usize,
    value: String,
}

#[derive(Serialize)]
struct FileIndexRow {
    bytes: u64,
    content: String,
    hash: String,
    kind: String,
    language: String,
    lines: usize,
    mtime_ms: f64,
    path: String,
    profile: String,
    size: u64,
}

#[derive(Serialize)]
struct SymbolIndexRow {
    file_path: String,
    kind: String,
    line: usize,
    name: String,
    signature: String,
}

#[derive(Serialize)]
struct ImportIndexRow {
    from_file: String,
    imported: String,
    line: usize,
    raw: String,
    to_ref: String,
}

#[derive(Serialize)]
struct RouteIndexRow {
    file_path: String,
    handler: String,
    line: usize,
    method: String,
    route: String,
}

#[derive(Serialize)]
struct EdgeIndexRow {
    evidence: String,
    file_path: String,
    kind: String,
    line: usize,
    source: String,
    source_kind: String,
    target: String,
    target_kind: String,
}

fn collect_index_rows(manifest: &Manifest) -> Result<IndexRows, String> {
    let root_path = canonical_project_root(&manifest.project_root)?;
    let worker_count = std::thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
        .min(8)
        .min(manifest.files.len().max(1));
    if worker_count <= 1 || manifest.files.len() < PARALLEL_INDEX_FILE_THRESHOLD {
        return collect_index_rows_chunk(&root_path, &manifest.files);
    }
    let chunk_size = manifest.files.len().div_ceil(worker_count);
    let chunk_results = std::thread::scope(|scope| {
        let mut handles = Vec::new();
        for chunk in manifest.files.chunks(chunk_size) {
            let root_path = &root_path;
            handles.push(scope.spawn(move || collect_index_rows_chunk(root_path, chunk)));
        }
        handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .unwrap_or_else(|_| Err("native index row worker panicked".to_string()))
            })
            .collect::<Vec<_>>()
    });
    let mut rows = IndexRows::default();
    for chunk_rows in chunk_results {
        rows.append(chunk_rows?);
    }
    Ok(rows)
}

fn collect_index_rows_chunk(root_path: &Path, files: &[ManifestFile]) -> Result<IndexRows, String> {
    let mut rows = IndexRows::default();
    for file in files {
        let absolute_path = contained_path_from_root(root_path, &file.path)?;
        let text = read_source_text_lossy(&absolute_path)?;
        let lines = if text.is_empty() {
            0
        } else {
            text.split('\n').count()
        };
        let hash = sha256_hex(&text);
        let extracted = extract_file(file, &text);
        rows.files.push(FileIndexRow {
            bytes: file.size,
            content: text,
            hash,
            kind: if file.language == "config" {
                "config".to_string()
            } else {
                "source".to_string()
            },
            language: file.language.clone(),
            lines,
            mtime_ms: file.mtime_ms,
            path: file.path.clone(),
            profile: file.profile.clone(),
            size: file.size,
        });
        rows.symbols
            .extend(extracted.symbols.into_iter().map(|symbol| SymbolIndexRow {
                file_path: file.path.clone(),
                kind: symbol.kind,
                line: symbol.line,
                name: symbol.name,
                signature: symbol.signature,
            }));
        rows.imports
            .extend(extracted.imports.into_iter().map(|import| ImportIndexRow {
                from_file: file.path.clone(),
                imported: import.imported,
                line: import.line,
                raw: import.raw,
                to_ref: import.to_ref,
            }));
        rows.routes
            .extend(extracted.routes.into_iter().map(|route| RouteIndexRow {
                file_path: file.path.clone(),
                handler: route.handler,
                line: route.line,
                method: route.method,
                route: route.route,
            }));
        rows.configs
            .extend(extracted.configs.into_iter().map(|config| ConfigIndexRow {
                file_path: file.path.clone(),
                key: config.key,
                line: config.line,
                value: config.value,
            }));
        rows.edges
            .extend(extracted.edges.into_iter().map(|edge| EdgeIndexRow {
                evidence: edge.evidence,
                file_path: file.path.clone(),
                kind: edge.kind,
                line: edge.line,
                source: edge.source,
                source_kind: edge.source_kind,
                target: edge.target,
                target_kind: edge.target_kind,
            }));
    }
    Ok(rows)
}

fn read_source_text_lossy(path: &Path) -> Result<String, String> {
    let bytes =
        fs::read(path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn write_row_stream(manifest: &Manifest, rows: &IndexRows) -> Result<(), String> {
    let rows_path = manifest
        .rows_path
        .as_deref()
        .ok_or("rows_path is required when output_mode is row-stream")?;
    fs::write(
        rows_path,
        serde_json::to_string(rows)
            .map_err(|error| format!("failed to serialize row stream: {error}"))?,
    )
    .map_err(|error| format!("failed to write row stream {rows_path}: {error}"))
}

fn write_database_with_sqlite_bridge(database_path: &str, sql: &str) -> Result<(), String> {
    remove_database_files(database_path)?;
    let mut child = Command::new("sqlite3")
        .arg(database_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to start sqlite3: {error}"))?;
    {
        let stdin = child.stdin.as_mut().ok_or("failed to open sqlite3 stdin")?;
        stdin
            .write_all(sql.as_bytes())
            .map_err(|error| format!("failed to write sqlite script: {error}"))?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for sqlite3: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "sqlite3 failed ({}): {}",
            output.status.code().unwrap_or(-1),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    Ok(())
}

fn remove_database_files(database_path: &str) -> Result<(), String> {
    for suffix in ["", "-wal", "-shm"] {
        let path = format!("{database_path}{suffix}");
        if Path::new(&path).exists() {
            fs::remove_file(&path).map_err(|error| format!("failed to remove {path}: {error}"))?;
        }
    }
    Ok(())
}

#[allow(non_camel_case_types)]
type sqlite3 = c_void;
#[allow(non_camel_case_types)]
type sqlite3_stmt = c_void;
type SqliteDestructor = Option<unsafe extern "C" fn(*mut c_void)>;

const SQLITE_OK: c_int = 0;
const SQLITE_DONE: c_int = 101;
const SQLITE_OPEN_READWRITE: c_int = 0x00000002;
const SQLITE_OPEN_CREATE: c_int = 0x00000004;

#[link(name = "sqlite3")]
extern "C" {
    fn sqlite3_bind_double(statement: *mut sqlite3_stmt, index: c_int, value: c_double) -> c_int;
    fn sqlite3_bind_int64(statement: *mut sqlite3_stmt, index: c_int, value: i64) -> c_int;
    fn sqlite3_bind_text(
        statement: *mut sqlite3_stmt,
        index: c_int,
        value: *const c_char,
        bytes: c_int,
        destructor: SqliteDestructor,
    ) -> c_int;
    fn sqlite3_clear_bindings(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_close(database: *mut sqlite3) -> c_int;
    fn sqlite3_errmsg(database: *mut sqlite3) -> *const c_char;
    fn sqlite3_exec(
        database: *mut sqlite3,
        sql: *const c_char,
        callback: Option<
            unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int,
        >,
        argument: *mut c_void,
        errmsg: *mut *mut c_char,
    ) -> c_int;
    fn sqlite3_finalize(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_open_v2(
        filename: *const c_char,
        database: *mut *mut sqlite3,
        flags: c_int,
        vfs: *const c_char,
    ) -> c_int;
    fn sqlite3_prepare_v2(
        database: *mut sqlite3,
        sql: *const c_char,
        bytes: c_int,
        statement: *mut *mut sqlite3_stmt,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_reset(statement: *mut sqlite3_stmt) -> c_int;
    fn sqlite3_step(statement: *mut sqlite3_stmt) -> c_int;
}

fn sqlite_transient() -> SqliteDestructor {
    unsafe { std::mem::transmute::<isize, SqliteDestructor>(-1) }
}

struct SqliteConnection {
    raw: *mut sqlite3,
}

impl SqliteConnection {
    fn open(database_path: &str) -> Result<Self, String> {
        let filename = cstring(database_path, "database path")?;
        let mut raw = ptr::null_mut();
        let status = unsafe {
            sqlite3_open_v2(
                filename.as_ptr(),
                &mut raw,
                SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE,
                ptr::null(),
            )
        };
        if status != SQLITE_OK {
            let message = if raw.is_null() {
                format!("sqlite open failed with status {status}")
            } else {
                sqlite_error(raw)
            };
            if !raw.is_null() {
                unsafe {
                    sqlite3_close(raw);
                }
            }
            return Err(message);
        }
        Ok(Self { raw })
    }

    fn exec(&self, sql: &str) -> Result<(), String> {
        let sql = cstring(sql, "SQL")?;
        let status = unsafe {
            sqlite3_exec(
                self.raw,
                sql.as_ptr(),
                None,
                ptr::null_mut(),
                ptr::null_mut(),
            )
        };
        if status == SQLITE_OK {
            Ok(())
        } else {
            Err(sqlite_error(self.raw))
        }
    }

    fn prepare(&self, sql: &str) -> Result<SqlitePreparedStatement, String> {
        let sql = cstring(sql, "SQL")?;
        let mut statement = ptr::null_mut();
        let status = unsafe {
            sqlite3_prepare_v2(self.raw, sql.as_ptr(), -1, &mut statement, ptr::null_mut())
        };
        if status == SQLITE_OK {
            Ok(SqlitePreparedStatement {
                database: self.raw,
                raw: statement,
            })
        } else {
            Err(sqlite_error(self.raw))
        }
    }
}

impl Drop for SqliteConnection {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe {
                sqlite3_close(self.raw);
            }
        }
    }
}

struct SqlitePreparedStatement {
    database: *mut sqlite3,
    raw: *mut sqlite3_stmt,
}

impl SqlitePreparedStatement {
    fn bind_text(&self, index: c_int, value: &str) -> Result<(), String> {
        let byte_count = c_int::try_from(value.len())
            .map_err(|_| "SQLite text value is too large to bind".to_string())?;
        let status = unsafe {
            sqlite3_bind_text(
                self.raw,
                index,
                value.as_ptr().cast::<c_char>(),
                byte_count,
                sqlite_transient(),
            )
        };
        if status == SQLITE_OK {
            Ok(())
        } else {
            Err(sqlite_error(self.database))
        }
    }

    fn bind_int64(&self, index: c_int, value: i64) -> Result<(), String> {
        let status = unsafe { sqlite3_bind_int64(self.raw, index, value) };
        if status == SQLITE_OK {
            Ok(())
        } else {
            Err(sqlite_error(self.database))
        }
    }

    fn bind_double(&self, index: c_int, value: f64) -> Result<(), String> {
        let status = unsafe { sqlite3_bind_double(self.raw, index, value) };
        if status == SQLITE_OK {
            Ok(())
        } else {
            Err(sqlite_error(self.database))
        }
    }

    fn run(&self) -> Result<(), String> {
        let status = unsafe { sqlite3_step(self.raw) };
        if status != SQLITE_DONE {
            return Err(sqlite_error(self.database));
        }
        unsafe {
            sqlite3_reset(self.raw);
            sqlite3_clear_bindings(self.raw);
        }
        Ok(())
    }
}

impl Drop for SqlitePreparedStatement {
    fn drop(&mut self) {
        if !self.raw.is_null() {
            unsafe {
                sqlite3_finalize(self.raw);
            }
        }
    }
}

fn sqlite_error(database: *mut sqlite3) -> String {
    if database.is_null() {
        return "sqlite error on null database".to_string();
    }
    unsafe {
        let message = sqlite3_errmsg(database);
        if message.is_null() {
            "sqlite error without message".to_string()
        } else {
            CStr::from_ptr(message).to_string_lossy().into_owned()
        }
    }
}

fn cstring(value: &str, label: &str) -> Result<CString, String> {
    CString::new(value).map_err(|_| format!("{label} contains an embedded NUL byte"))
}

fn setup_database_sql() -> &'static str {
    r#"
PRAGMA journal_mode = OFF;
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
PRAGMA locking_mode = EXCLUSIVE;
PRAGMA cache_size = -20000;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  fts_rowid INTEGER NOT NULL UNIQUE,
  language TEXT NOT NULL,
  profile TEXT NOT NULL,
  kind TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  lines INTEGER NOT NULL,
  hash TEXT NOT NULL,
  mtime_ms REAL NOT NULL,
  size INTEGER NOT NULL
);
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  signature TEXT NOT NULL
);
CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  from_file TEXT NOT NULL,
  to_ref TEXT NOT NULL,
  imported TEXT NOT NULL,
  line INTEGER NOT NULL,
  raw TEXT NOT NULL
);
CREATE TABLE routes (
  id INTEGER PRIMARY KEY,
  method TEXT NOT NULL,
  route TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  handler TEXT NOT NULL
);
CREATE TABLE configs (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL
);
CREATE TABLE edges (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line INTEGER NOT NULL,
  evidence TEXT NOT NULL
);
CREATE VIRTUAL TABLE files_fts USING fts5(path, language, profile, content);
CREATE VIRTUAL TABLE symbols_fts USING fts5(name, kind, file_path, signature);
"#
}

fn finalize_database_sql() -> &'static str {
    r#"
PRAGMA journal_mode = WAL;
"#
}

fn create_index_sql() -> &'static str {
    r#"
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_imports_from ON imports(from_file);
CREATE INDEX idx_routes_path ON routes(route);
CREATE INDEX idx_configs_file ON configs(file_path);
CREATE INDEX idx_edges_source ON edges(source_kind, source);
CREATE INDEX idx_edges_target ON edges(target_kind, target);
CREATE INDEX idx_edges_kind ON edges(kind);
"#
}

fn write_database_direct(manifest: &Manifest, rows: &IndexRows) -> Result<(), String> {
    remove_database_files(&manifest.database_path)?;
    let database = SqliteConnection::open(&manifest.database_path)?;
    database.exec(setup_database_sql())?;
    database.exec("BEGIN")?;
    let result = insert_index_rows_direct(&database, manifest, rows);
    match result {
        Ok(()) => {
            database.exec(create_index_sql())?;
            database.exec("COMMIT")?;
            database.exec(finalize_database_sql())?;
        }
        Err(error) => {
            let _ = database.exec("ROLLBACK");
            return Err(error);
        }
    }
    Ok(())
}

fn write_database_incremental_direct(manifest: &Manifest, rows: &IndexRows) -> Result<(), String> {
    let database = SqliteConnection::open(&manifest.database_path)?;
    database.exec(
        r#"
PRAGMA synchronous = OFF;
PRAGMA temp_store = MEMORY;
PRAGMA cache_size = -20000;
"#,
    )?;
    database.exec("BEGIN")?;
    let mut paths = BTreeSet::new();
    paths.extend(manifest.deleted_paths.iter().cloned());
    paths.extend(rows.files.iter().map(|file| file.path.clone()));
    let result = (|| {
        insert_metadata_direct(&database, manifest, false)?;
        delete_index_rows_direct(&database, &paths)?;
        insert_rows_direct(&database, rows)
    })();
    match result {
        Ok(()) => database.exec("COMMIT")?,
        Err(error) => {
            let _ = database.exec("ROLLBACK");
            return Err(error);
        }
    }
    Ok(())
}

fn delete_index_rows_direct(
    database: &SqliteConnection,
    paths: &BTreeSet<String>,
) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }
    if paths.len() >= 16 {
        return delete_index_rows_direct_batched(database, paths);
    }
    let delete_configs = database.prepare("DELETE FROM configs WHERE file_path = ?")?;
    let delete_edges = database.prepare("DELETE FROM edges WHERE file_path = ?")?;
    let delete_imports = database.prepare("DELETE FROM imports WHERE from_file = ?")?;
    let delete_routes = database.prepare("DELETE FROM routes WHERE file_path = ?")?;
    let delete_symbols = database.prepare("DELETE FROM symbols WHERE file_path = ?")?;
    let delete_symbols_fts = database.prepare("DELETE FROM symbols_fts WHERE file_path = ?")?;
    let delete_files_fts = database.prepare("DELETE FROM files_fts WHERE rowid = ?")?;
    let delete_files = database.prepare("DELETE FROM files WHERE path = ?")?;
    for path in paths {
        delete_configs.bind_text(1, path)?;
        delete_configs.run()?;
        delete_edges.bind_text(1, path)?;
        delete_edges.run()?;
        delete_imports.bind_text(1, path)?;
        delete_imports.run()?;
        delete_routes.bind_text(1, path)?;
        delete_routes.run()?;
        delete_symbols.bind_text(1, path)?;
        delete_symbols.run()?;
        delete_symbols_fts.bind_text(1, path)?;
        delete_symbols_fts.run()?;
        delete_files_fts.bind_int64(1, file_fts_rowid(path))?;
        delete_files_fts.run()?;
        delete_files.bind_text(1, path)?;
        delete_files.run()?;
    }
    Ok(())
}

fn delete_index_rows_direct_batched(
    database: &SqliteConnection,
    paths: &BTreeSet<String>,
) -> Result<(), String> {
    database.exec(
        r#"
CREATE TEMP TABLE IF NOT EXISTS incremental_delete_paths (
  path TEXT PRIMARY KEY,
  fts_rowid INTEGER NOT NULL
);
DELETE FROM incremental_delete_paths;
"#,
    )?;
    let insert_path =
        database.prepare("INSERT INTO incremental_delete_paths (path, fts_rowid) VALUES (?, ?)")?;
    for path in paths {
        insert_path.bind_text(1, path)?;
        insert_path.bind_int64(2, file_fts_rowid(path))?;
        insert_path.run()?;
    }
    database.exec(
        r#"
DELETE FROM configs WHERE file_path IN (SELECT path FROM incremental_delete_paths);
DELETE FROM edges WHERE file_path IN (SELECT path FROM incremental_delete_paths);
DELETE FROM imports WHERE from_file IN (SELECT path FROM incremental_delete_paths);
DELETE FROM routes WHERE file_path IN (SELECT path FROM incremental_delete_paths);
DELETE FROM symbols WHERE file_path IN (SELECT path FROM incremental_delete_paths);
DELETE FROM symbols_fts WHERE file_path IN (SELECT path FROM incremental_delete_paths);
DELETE FROM files_fts WHERE rowid IN (SELECT fts_rowid FROM incremental_delete_paths);
DELETE FROM files WHERE path IN (SELECT path FROM incremental_delete_paths);
DELETE FROM incremental_delete_paths;
"#,
    )
}

fn insert_index_rows_direct(
    database: &SqliteConnection,
    manifest: &Manifest,
    rows: &IndexRows,
) -> Result<(), String> {
    insert_metadata_direct(database, manifest, true)?;
    insert_rows_direct(database, rows)
}

fn insert_metadata_direct(
    database: &SqliteConnection,
    manifest: &Manifest,
    include_created_at: bool,
) -> Result<(), String> {
    let insert_meta = database.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")?;
    if include_created_at {
        insert_meta.bind_text(1, "created_at")?;
        insert_meta.bind_text(2, &timestamp_placeholder())?;
        insert_meta.run()?;
    }
    insert_meta.bind_text(1, "schema_version")?;
    insert_meta.bind_text(2, &manifest.schema_version)?;
    insert_meta.run()?;
    insert_meta.bind_text(1, "updated_at")?;
    insert_meta.bind_text(2, &timestamp_placeholder())?;
    insert_meta.run()?;
    insert_meta.bind_text(1, "root")?;
    insert_meta.bind_text(2, &manifest.project_root)?;
    insert_meta.run()?;
    insert_meta.bind_text(1, "scopes")?;
    insert_meta.bind_text(2, &manifest.scopes.join(", "))?;
    insert_meta.run()?;
    insert_meta.bind_text(1, "scopes_json")?;
    insert_meta.bind_text(
        2,
        &serde_json::to_string(&manifest.scopes)
            .map_err(|error| format!("failed to serialize scopes metadata: {error}"))?,
    )?;
    insert_meta.run()?;
    insert_meta.bind_text(1, "parser_mode")?;
    insert_meta.bind_text(2, &manifest.parser_mode)?;
    insert_meta.run()?;
    insert_meta.bind_text(1, "terminology")?;
    insert_meta.bind_text(2, "code evidence index")?;
    insert_meta.run()?;
    Ok(())
}

fn insert_rows_direct(database: &SqliteConnection, rows: &IndexRows) -> Result<(), String> {
    let insert_file = database.prepare("INSERT INTO files (path, fts_rowid, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")?;
    let insert_file_fts = database.prepare(
        "INSERT INTO files_fts (rowid, path, language, profile, content) VALUES (?, ?, ?, ?, ?)",
    )?;
    for file in &rows.files {
        let fts_rowid = file_fts_rowid(&file.path);
        insert_file.bind_text(1, &file.path)?;
        insert_file.bind_int64(2, fts_rowid)?;
        insert_file.bind_text(3, &file.language)?;
        insert_file.bind_text(4, &file.profile)?;
        insert_file.bind_text(5, &file.kind)?;
        insert_file.bind_int64(6, file.bytes as i64)?;
        insert_file.bind_int64(7, file.lines as i64)?;
        insert_file.bind_text(8, &file.hash)?;
        insert_file.bind_double(9, file.mtime_ms)?;
        insert_file.bind_int64(10, file.size as i64)?;
        insert_file.run()?;

        insert_file_fts.bind_int64(1, fts_rowid)?;
        insert_file_fts.bind_text(2, &file.path)?;
        insert_file_fts.bind_text(3, &file.language)?;
        insert_file_fts.bind_text(4, &file.profile)?;
        insert_file_fts.bind_text(5, &file.content)?;
        insert_file_fts.run()?;
    }

    let insert_symbol = database.prepare(
        "INSERT INTO symbols (name, kind, file_path, line, signature) VALUES (?, ?, ?, ?, ?)",
    )?;
    let insert_symbol_fts = database.prepare(
        "INSERT INTO symbols_fts (name, kind, file_path, signature) VALUES (?, ?, ?, ?)",
    )?;
    for symbol in &rows.symbols {
        insert_symbol.bind_text(1, &symbol.name)?;
        insert_symbol.bind_text(2, &symbol.kind)?;
        insert_symbol.bind_text(3, &symbol.file_path)?;
        insert_symbol.bind_int64(4, symbol.line as i64)?;
        insert_symbol.bind_text(5, &symbol.signature)?;
        insert_symbol.run()?;

        insert_symbol_fts.bind_text(1, &symbol.name)?;
        insert_symbol_fts.bind_text(2, &symbol.kind)?;
        insert_symbol_fts.bind_text(3, &symbol.file_path)?;
        insert_symbol_fts.bind_text(4, &symbol.signature)?;
        insert_symbol_fts.run()?;
    }

    let insert_import = database.prepare(
        "INSERT INTO imports (from_file, to_ref, imported, line, raw) VALUES (?, ?, ?, ?, ?)",
    )?;
    for import in &rows.imports {
        insert_import.bind_text(1, &import.from_file)?;
        insert_import.bind_text(2, &import.to_ref)?;
        insert_import.bind_text(3, &import.imported)?;
        insert_import.bind_int64(4, import.line as i64)?;
        insert_import.bind_text(5, &import.raw)?;
        insert_import.run()?;
    }

    let insert_route = database.prepare(
        "INSERT INTO routes (method, route, file_path, line, handler) VALUES (?, ?, ?, ?, ?)",
    )?;
    for route in &rows.routes {
        insert_route.bind_text(1, &route.method)?;
        insert_route.bind_text(2, &route.route)?;
        insert_route.bind_text(3, &route.file_path)?;
        insert_route.bind_int64(4, route.line as i64)?;
        insert_route.bind_text(5, &route.handler)?;
        insert_route.run()?;
    }

    let insert_config = database
        .prepare("INSERT INTO configs (key, value, file_path, line) VALUES (?, ?, ?, ?)")?;
    for config in &rows.configs {
        insert_config.bind_text(1, &config.key)?;
        insert_config.bind_text(2, &config.value)?;
        insert_config.bind_text(3, &config.file_path)?;
        insert_config.bind_int64(4, config.line as i64)?;
        insert_config.run()?;
    }

    let insert_edge = database.prepare("INSERT INTO edges (kind, source_kind, source, target_kind, target, file_path, line, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")?;
    for edge in &rows.edges {
        insert_edge.bind_text(1, &edge.kind)?;
        insert_edge.bind_text(2, &edge.source_kind)?;
        insert_edge.bind_text(3, &edge.source)?;
        insert_edge.bind_text(4, &edge.target_kind)?;
        insert_edge.bind_text(5, &edge.target)?;
        insert_edge.bind_text(6, &edge.file_path)?;
        insert_edge.bind_int64(7, edge.line as i64)?;
        insert_edge.bind_text(8, &edge.evidence)?;
        insert_edge.run()?;
    }
    Ok(())
}

fn insert_meta(sql: &mut String, key: &str, value: &str) {
    sql.push_str(&format!(
        "INSERT INTO meta (key, value) VALUES ({}, {});\n",
        sql_string(key),
        sql_string(value)
    ));
}

fn insert_file_row(sql: &mut String, file: &FileIndexRow) {
    let fts_rowid = file_fts_rowid(&file.path);
    sql.push_str(&format!(
        "INSERT INTO files (path, fts_rowid, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES ({}, {}, {}, {}, {}, {}, {}, {}, {:.3}, {});\n",
        sql_string(&file.path),
        fts_rowid,
        sql_string(&file.language),
        sql_string(&file.profile),
        sql_string(&file.kind),
        file.bytes,
        file.lines,
        sql_string(&file.hash),
        file.mtime_ms,
        file.size
    ));
    sql.push_str(&format!(
        "INSERT INTO files_fts (rowid, path, language, profile, content) VALUES ({}, {}, {}, {}, {});\n",
        fts_rowid,
        sql_string(&file.path),
        sql_string(&file.language),
        sql_string(&file.profile),
        sql_string(&file.content)
    ));
}

fn insert_symbol_row(sql: &mut String, symbol: &SymbolIndexRow) {
    sql.push_str(&format!(
        "INSERT INTO symbols (name, kind, file_path, line, signature) VALUES ({}, {}, {}, {}, {});\n",
        sql_string(&symbol.name),
        sql_string(&symbol.kind),
        sql_string(&symbol.file_path),
        symbol.line,
        sql_string(&symbol.signature)
    ));
    sql.push_str(&format!(
        "INSERT INTO symbols_fts (name, kind, file_path, signature) VALUES ({}, {}, {}, {});\n",
        sql_string(&symbol.name),
        sql_string(&symbol.kind),
        sql_string(&symbol.file_path),
        sql_string(&symbol.signature)
    ));
}

fn insert_import_row(sql: &mut String, import: &ImportIndexRow) {
    sql.push_str(&format!(
        "INSERT INTO imports (from_file, to_ref, imported, line, raw) VALUES ({}, {}, {}, {}, {});\n",
        sql_string(&import.from_file),
        sql_string(&import.to_ref),
        sql_string(&import.imported),
        import.line,
        sql_string(&import.raw)
    ));
}

fn insert_route_row(sql: &mut String, route: &RouteIndexRow) {
    sql.push_str(&format!(
        "INSERT INTO routes (method, route, file_path, line, handler) VALUES ({}, {}, {}, {}, {});\n",
        sql_string(&route.method),
        sql_string(&route.route),
        sql_string(&route.file_path),
        route.line,
        sql_string(&route.handler)
    ));
}

fn insert_config_row(sql: &mut String, config: &ConfigIndexRow) {
    sql.push_str(&format!(
        "INSERT INTO configs (key, value, file_path, line) VALUES ({}, {}, {}, {});\n",
        sql_string(&config.key),
        sql_string(&config.value),
        sql_string(&config.file_path),
        config.line
    ));
}

fn insert_edge_row(sql: &mut String, edge: &EdgeIndexRow) {
    sql.push_str(&format!(
        "INSERT INTO edges (kind, source_kind, source, target_kind, target, file_path, line, evidence) VALUES ({}, {}, {}, {}, {}, {}, {}, {});\n",
        sql_string(&edge.kind),
        sql_string(&edge.source_kind),
        sql_string(&edge.source),
        sql_string(&edge.target_kind),
        sql_string(&edge.target),
        sql_string(&edge.file_path),
        edge.line,
        sql_string(&edge.evidence)
    ));
}

#[derive(Default)]
struct Extracted {
    configs: Vec<ConfigRow>,
    edges: Vec<EdgeRow>,
    imports: Vec<ImportRow>,
    routes: Vec<RouteRow>,
    symbols: Vec<SymbolRow>,
}

struct ConfigRow {
    key: String,
    line: usize,
    value: String,
}

struct EdgeRow {
    evidence: String,
    kind: String,
    line: usize,
    source: String,
    source_kind: String,
    target: String,
    target_kind: String,
}

struct ImportRow {
    edge_kind: String,
    imported: String,
    line: usize,
    raw: String,
    to_ref: String,
}

struct RouteRow {
    handler: String,
    line: usize,
    method: String,
    route: String,
}

struct SymbolRow {
    kind: String,
    line: usize,
    name: String,
    signature: String,
}

struct DecoratorRoute {
    callee: String,
    line: usize,
    method: String,
    route: String,
}

struct ContextFrame {
    brace_depth: i32,
    name: String,
}

struct PendingCallExpression {
    context: String,
    line: usize,
    parts: Vec<String>,
}

struct PendingMultilineCallChain {
    context: String,
    delimiter_delta: i32,
    line: usize,
    parts: Vec<String>,
}

struct PendingVariableFunctionSymbol {
    delimiter_delta: i32,
    parts: Vec<String>,
    requires_arrow: bool,
    saw_arrow: bool,
    symbol: SymbolRow,
}

struct PendingImportDeclaration {
    line: usize,
    parts: Vec<String>,
}

struct PendingPythonFunctionSymbol {
    args: String,
    line: usize,
    name: String,
}

fn extract_file(file: &ManifestFile, text: &str) -> Extracted {
    match file.profile.as_str() {
        "typescript-ast" => extract_javascript_like(file, text),
        "config" => extract_config(file, text),
        "python-light" => extract_python_light(file, text),
        "go-light" => extract_go_light(file, text),
        "c-light" => extract_generic_light(file, text, GenericLightLanguage::C),
        "cpp-light" => extract_generic_light(file, text, GenericLightLanguage::Cpp),
        "csharp-light" => extract_generic_light(file, text, GenericLightLanguage::Csharp),
        "java-light" => extract_generic_light(file, text, GenericLightLanguage::Java),
        "kotlin-light" => extract_generic_light(file, text, GenericLightLanguage::Kotlin),
        "php-light" => extract_generic_light(file, text, GenericLightLanguage::Php),
        "rust-light" => extract_generic_light(file, text, GenericLightLanguage::Rust),
        "swift-light" => extract_generic_light(file, text, GenericLightLanguage::Swift),
        "inventory-only" => Extracted::default(),
        _ => Extracted::default(),
    }
}

fn extract_config(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    if path_basename(&file.path) == "package.json" {
        match serde_json::from_str::<serde_json::Value>(text) {
            Ok(parsed) => {
                push_package_json_config_section(&mut extracted, &parsed, "scripts", "script");
                push_package_json_config_section(
                    &mut extracted,
                    &parsed,
                    "dependencies",
                    "dependency",
                );
                push_package_json_config_section(
                    &mut extracted,
                    &parsed,
                    "devDependencies",
                    "devDependency",
                );
            }
            Err(_) => extracted.configs.push(ConfigRow {
                key: "parse-error".to_string(),
                line: 1,
                value: "package.json is not valid JSON".to_string(),
            }),
        }
        return extracted;
    }

    let lines = text
        .split('\n')
        .map(|line| line.trim_end_matches('\r'))
        .collect::<Vec<_>>();
    let mut index = 0usize;
    while index < lines.len() {
        if let Some((config, consumed_lines)) = config_key_value_from_lines(&lines, index) {
            extracted.configs.push(config);
            index += consumed_lines.max(1);
        } else {
            index += 1;
        }
    }
    extracted
}

fn path_basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

fn push_package_json_config_section(
    extracted: &mut Extracted,
    parsed: &serde_json::Value,
    section: &str,
    prefix: &str,
) {
    let Some(entries) = parsed.get(section).and_then(|value| value.as_object()) else {
        return;
    };
    for (name, value) in entries {
        extracted.configs.push(ConfigRow {
            key: format!("{prefix}:{name}"),
            line: 1,
            value: json_config_value_to_string(value),
        });
    }
}

fn json_config_value_to_string(value: &serde_json::Value) -> String {
    value
        .as_str()
        .map(ToString::to_string)
        .unwrap_or_else(|| value.to_string())
}

fn config_key_value_from_lines(lines: &[&str], index: usize) -> Option<(ConfigRow, usize)> {
    let line = lines.get(index)?;
    let trimmed = line.trim_start();
    let key_end = trimmed
        .char_indices()
        .take_while(|(_, ch)| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '-'))
        .map(|(index, ch)| index + ch.len_utf8())
        .last()
        .unwrap_or(0);
    if key_end == 0 {
        return None;
    }
    let key = &trimmed[..key_end];
    let after_key = trimmed[key_end..].trim_start();
    let delimiter = after_key.chars().next()?;
    if delimiter != ':' && delimiter != '=' {
        return None;
    }
    let value = &after_key[delimiter.len_utf8()..];
    if !value.trim().is_empty() {
        return Some((
            ConfigRow {
                key: key.to_string(),
                line: index + 1,
                value: value.trim().to_string(),
            },
            1,
        ));
    }
    for (next_index, next_line) in lines.iter().enumerate().skip(index + 1) {
        let next_value = next_line.trim();
        if next_value.is_empty() {
            continue;
        }
        return Some((
            ConfigRow {
                key: key.to_string(),
                line: index + 1,
                value: next_value.to_string(),
            },
            next_index - index + 1,
        ));
    }
    None
}

fn extract_python_light(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    let mut pending_blank_start_line: Option<usize> = None;
    let mut pending_function: Option<PendingPythonFunctionSymbol> = None;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = raw_line.trim_end_matches('\r');
        if let Some(mut pending) = pending_function.take() {
            if let Some(args_end) = line.find(')') {
                pending.args.push('\n');
                pending.args.push_str(&line[..args_end]);
                extracted.symbols.push(SymbolRow {
                    kind: "function".to_string(),
                    line: pending.line,
                    name: pending.name.clone(),
                    signature: format!("def {}({})", pending.name, pending.args),
                });
            } else {
                pending.args.push('\n');
                pending.args.push_str(line);
                pending_function = Some(pending);
            }
            continue;
        }
        if line.trim().is_empty() {
            pending_blank_start_line.get_or_insert(line_number);
            continue;
        }
        let match_line = pending_blank_start_line.take().unwrap_or(line_number);
        let trimmed = line.trim_start();
        if let Some(rest) = trimmed.strip_prefix("def ") {
            if let Some((name, after_name)) = take_ascii_identifier_with_rest(rest) {
                let after_name = after_name.trim_start();
                if let Some(args_start) = after_name.strip_prefix('(') {
                    if let Some(args_end) = args_start.find(')') {
                        extracted.symbols.push(SymbolRow {
                            kind: "function".to_string(),
                            line: match_line,
                            name: name.to_string(),
                            signature: format!("def {}({})", name, &args_start[..args_end]),
                        });
                    } else {
                        pending_function = Some(PendingPythonFunctionSymbol {
                            args: args_start.to_string(),
                            line: match_line,
                            name: name.to_string(),
                        });
                    }
                }
            }
        }
        if let Some(rest) = trimmed.strip_prefix("class ") {
            if let Some((name, _)) = take_ascii_identifier_with_rest(rest) {
                extracted.symbols.push(SymbolRow {
                    kind: "class".to_string(),
                    line: match_line,
                    name: name.to_string(),
                    signature: format!("class {name}"),
                });
            }
        }
        if let Some(import) = python_import_from_line(trimmed, match_line) {
            push_import_row(&mut extracted, file, import);
        }
    }
    extracted
}

fn python_import_from_line(line: &str, line_number: usize) -> Option<ImportRow> {
    if let Some(rest) = line.strip_prefix("from ") {
        let (to_ref, after_ref) = take_python_module_ref(rest)?;
        let imported = after_ref.trim_start().strip_prefix("import ")?;
        if imported.is_empty() {
            return None;
        }
        return Some(ImportRow {
            edge_kind: "import".to_string(),
            imported: imported.trim().to_string(),
            line: line_number,
            raw: line.trim().to_string(),
            to_ref: to_ref.to_string(),
        });
    }
    if let Some(rest) = line.strip_prefix("import ") {
        let imported = rest.trim_end();
        if imported.is_empty() || !imported.chars().all(is_python_import_list_char) {
            return None;
        }
        return Some(ImportRow {
            edge_kind: "import".to_string(),
            imported: String::new(),
            line: line_number,
            raw: line.trim().to_string(),
            to_ref: imported.to_string(),
        });
    }
    None
}

fn take_python_module_ref(text: &str) -> Option<(&str, &str)> {
    let mut end = 0usize;
    for (index, ch) in text.char_indices() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '$') {
            end = index + ch.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        return None;
    }
    Some((&text[..end], &text[end..]))
}

fn is_python_import_list_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '$' | ',' | ' ' | '\t')
}

fn extract_go_light(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    let mut in_import_block = false;
    let mut pending_blank_start_line: Option<usize> = None;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = raw_line.trim_end_matches('\r');
        if line.trim().is_empty() {
            pending_blank_start_line.get_or_insert(line_number);
            continue;
        }
        let match_line = pending_blank_start_line.take().unwrap_or(line_number);
        let trimmed = line.trim_start();
        if in_import_block {
            if trimmed.starts_with(')') {
                in_import_block = false;
                continue;
            }
            if let Some(import) = go_import_spec_from_line(trimmed, match_line) {
                push_import_row(&mut extracted, file, import);
            }
            continue;
        }
        if let Some(symbol) = go_symbol_from_line(trimmed, match_line) {
            extracted.symbols.push(symbol);
        }
        if starts_go_import_block(trimmed) {
            in_import_block = true;
            continue;
        }
        if let Some(import) = go_single_import_from_line(trimmed, match_line) {
            push_import_row(&mut extracted, file, import);
        }
    }
    extracted
}

fn go_symbol_from_line(line: &str, line_number: usize) -> Option<SymbolRow> {
    go_func_symbol_from_line(line, line_number)
        .or_else(|| go_type_or_value_symbol_from_line(line, line_number))
}

fn go_func_symbol_from_line(line: &str, line_number: usize) -> Option<SymbolRow> {
    let rest = line.strip_prefix("func")?;
    if !rest
        .chars()
        .next()
        .is_none_or(|ch| ch.is_whitespace() || ch == '(')
    {
        return None;
    }
    let rest = rest.trim_start();
    if let Some(receiver) = rest.strip_prefix('(') {
        let receiver_end = receiver.find(')')?;
        let after_receiver = receiver[receiver_end + 1..].trim_start();
        let (name, after_name) = take_ascii_identifier_with_rest(after_receiver)?;
        let args = parenthesized_prefix(after_name.trim_start())?;
        return Some(SymbolRow {
            kind: "method".to_string(),
            line: line_number,
            name: name.to_string(),
            signature: format!("func (...) {}({})", name, args),
        });
    }
    let (name, after_name) = take_ascii_identifier_with_rest(rest)?;
    let args = parenthesized_prefix(after_name.trim_start())?;
    Some(SymbolRow {
        kind: "function".to_string(),
        line: line_number,
        name: name.to_string(),
        signature: format!("func {}({})", name, args),
    })
}

fn go_type_or_value_symbol_from_line(line: &str, line_number: usize) -> Option<SymbolRow> {
    for (prefix, kind) in [
        ("type ", "type"),
        ("const ", "constant"),
        ("var ", "variable"),
    ] {
        let Some(rest) = line.strip_prefix(prefix) else {
            continue;
        };
        let (name, after_name) = take_ascii_identifier_with_rest(rest)?;
        if kind == "type" {
            if after_name.is_empty() {
                return None;
            }
            let after_name = after_name.trim_start();
            let type_kind = if after_name.starts_with("struct") {
                "struct"
            } else if after_name.starts_with("interface") {
                "interface"
            } else {
                ""
            };
            let signature = if type_kind.is_empty() {
                format!("type {name}")
            } else {
                format!("type {name} {type_kind}")
            };
            return Some(SymbolRow {
                kind: kind.to_string(),
                line: line_number,
                name: name.to_string(),
                signature,
            });
        }
        return Some(SymbolRow {
            kind: kind.to_string(),
            line: line_number,
            name: name.to_string(),
            signature: format!("{} {}", prefix.trim(), name),
        });
    }
    None
}

fn starts_go_import_block(line: &str) -> bool {
    let Some(rest) = line.strip_prefix("import") else {
        return false;
    };
    rest.trim_start().starts_with('(')
}

fn go_single_import_from_line(line: &str, line_number: usize) -> Option<ImportRow> {
    let rest = line.strip_prefix("import")?;
    if !rest.chars().next().is_none_or(|ch| ch.is_whitespace()) {
        return None;
    }
    go_import_spec_from_line(rest.trim_start(), line_number).map(|mut row| {
        row.raw = format!("import {}", row.raw);
        row
    })
}

fn go_import_spec_from_line(line: &str, line_number: usize) -> Option<ImportRow> {
    let trimmed = line.trim_start();
    let (imported, literal) = if trimmed.starts_with('"') || trimmed.starts_with('`') {
        ("", trimmed)
    } else {
        let (alias, after_alias) = take_go_import_alias(trimmed)?;
        (alias, after_alias.trim_start())
    };
    let (to_ref, raw_literal) = go_import_literal(literal)?;
    let raw = if imported.is_empty() {
        raw_literal.to_string()
    } else {
        format!("{imported} {raw_literal}")
    };
    Some(ImportRow {
        edge_kind: "import".to_string(),
        imported: imported.to_string(),
        line: line_number,
        raw,
        to_ref: to_ref.to_string(),
    })
}

fn take_go_import_alias(text: &str) -> Option<(&str, &str)> {
    let first = text.chars().next()?;
    if first == '_' || first == '.' {
        return Some((&text[..first.len_utf8()], &text[first.len_utf8()..]));
    }
    take_ascii_identifier_with_rest(text)
}

fn go_import_literal(text: &str) -> Option<(&str, &str)> {
    let quote = text.chars().next()?;
    if quote != '"' && quote != '`' {
        return None;
    }
    let rest = &text[quote.len_utf8()..];
    let end = rest.find(quote)?;
    let raw_end = quote.len_utf8() + end + quote.len_utf8();
    Some((&rest[..end], &text[..raw_end]))
}

fn parenthesized_prefix(text: &str) -> Option<&str> {
    let rest = text.strip_prefix('(')?;
    let end = rest.find(')')?;
    Some(&rest[..end])
}

fn take_ascii_identifier_with_rest(text: &str) -> Option<(&str, &str)> {
    let mut chars = text.char_indices();
    let (_, first) = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let mut end = first.len_utf8();
    for (index, ch) in chars {
        if ch.is_ascii_alphanumeric() || ch == '_' {
            end = index + ch.len_utf8();
        } else {
            break;
        }
    }
    Some((&text[..end], &text[end..]))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum GenericLightLanguage {
    C,
    Cpp,
    Csharp,
    Java,
    Kotlin,
    Php,
    Rust,
    Swift,
}

fn extract_generic_light(
    file: &ManifestFile,
    text: &str,
    language: GenericLightLanguage,
) -> Extracted {
    let mut extracted = Extracted::default();
    let mut php_type_depth = 0i32;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = raw_line.trim_end_matches('\r');
        let normalized = normalize_generic_light_line(line, language);
        let trimmed = normalized.as_str();
        if trimmed.is_empty() || generic_line_is_comment(trimmed, language) {
            php_type_depth += brace_delta(trimmed);
            continue;
        }
        if let Some(import) = generic_light_import(trimmed, language, line_number) {
            push_import_row(&mut extracted, file, import);
        }
        if let Some(symbol) =
            generic_light_symbol(trimmed, language, php_type_depth > 0, line_number)
        {
            extracted.symbols.push(symbol);
        }
        php_type_depth += brace_delta(trimmed);
    }
    extracted
}

fn normalize_generic_light_line(line: &str, language: GenericLightLanguage) -> String {
    let trimmed = line.trim();
    let normalized = if language == GenericLightLanguage::Php {
        trimmed
            .strip_prefix("<?php")
            .map(str::trim_start)
            .unwrap_or(trimmed)
    } else if matches!(
        language,
        GenericLightLanguage::Java | GenericLightLanguage::Kotlin | GenericLightLanguage::Swift
    ) {
        strip_leading_at_annotations(trimmed)
    } else {
        trimmed
    };
    normalized.to_string()
}

fn strip_leading_at_annotations(mut line: &str) -> &str {
    loop {
        let trimmed = line.trim_start();
        let Some(end) = at_annotation_prefix_len(trimmed) else {
            return trimmed;
        };
        line = trimmed[end..].trim_start();
    }
}

fn at_annotation_prefix_len(line: &str) -> Option<usize> {
    let rest = line.strip_prefix('@')?;
    let mut chars = rest.char_indices();
    let mut end = 1usize;
    let mut saw_name = false;
    for (index, ch) in &mut chars {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | ':') {
            saw_name = true;
            end = 1 + index + ch.len_utf8();
        } else {
            break;
        }
    }
    if !saw_name {
        return None;
    }
    let after_name = &line[end..];
    if !after_name.starts_with('(') {
        return Some(end);
    }
    let mut depth = 0i32;
    let mut quote = None::<char>;
    let mut escaped = false;
    for (offset, ch) in after_name.char_indices() {
        if let Some(active_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == active_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
        } else if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return Some(end + offset + ch.len_utf8());
            }
        }
    }
    None
}

fn generic_line_is_comment(line: &str, language: GenericLightLanguage) -> bool {
    line.starts_with("//")
        || line.starts_with("/*")
        || line.starts_with('*')
        || (language == GenericLightLanguage::Php && line.starts_with('#'))
}

fn generic_light_import(
    line: &str,
    language: GenericLightLanguage,
    line_number: usize,
) -> Option<ImportRow> {
    match language {
        GenericLightLanguage::C | GenericLightLanguage::Cpp => {
            if let Some(to_ref) = include_import_ref(line) {
                return Some(generic_import_row("import", "", line, line_number, &to_ref));
            }
            if language == GenericLightLanguage::Cpp {
                if let Some(rest) = line.strip_prefix("using ") {
                    let rest = rest.strip_prefix("namespace ").unwrap_or(rest).trim_start();
                    let to_ref = take_qualified_name(rest, "::")?;
                    return Some(generic_import_row("import", "", line, line_number, to_ref));
                }
            }
            None
        }
        GenericLightLanguage::Rust => {
            let to_ref = line
                .strip_prefix("use ")
                .map(|rest| rest.trim().trim_end_matches(';').trim())?;
            Some(generic_import_row(
                "use",
                "",
                line,
                line_number,
                &normalize_spaces(to_ref),
            ))
        }
        GenericLightLanguage::Php => {
            let to_ref = line
                .strip_prefix("use ")
                .map(|rest| rest.trim().trim_end_matches(';').trim())?;
            Some(generic_import_row(
                "import",
                "",
                line,
                line_number,
                &normalize_spaces(to_ref),
            ))
        }
        GenericLightLanguage::Csharp => {
            let rest = line.strip_prefix("using ")?;
            let to_ref = take_dotted_name(rest.trim_start())?;
            Some(generic_import_row("import", "", line, line_number, to_ref))
        }
        GenericLightLanguage::Swift => {
            let rest = line.strip_prefix("import ")?;
            let (to_ref, _) = take_ascii_identifier_with_rest(rest.trim_start())?;
            Some(generic_import_row("import", "", line, line_number, to_ref))
        }
        GenericLightLanguage::Java | GenericLightLanguage::Kotlin => {
            let rest = line.strip_prefix("import ")?;
            let to_ref = take_dotted_import_name(rest.trim_start())?;
            Some(generic_import_row("import", "", line, line_number, to_ref))
        }
    }
}

fn generic_light_symbol(
    line: &str,
    language: GenericLightLanguage,
    php_inside_type: bool,
    line_number: usize,
) -> Option<SymbolRow> {
    match language {
        GenericLightLanguage::Rust => rust_light_symbol(line, line_number),
        GenericLightLanguage::Kotlin => kotlin_light_symbol(line, line_number),
        GenericLightLanguage::Swift => swift_light_symbol(line, line_number),
        GenericLightLanguage::Php => php_light_symbol(line, php_inside_type, line_number),
        GenericLightLanguage::C | GenericLightLanguage::Cpp => {
            c_family_light_symbol(line, language, line_number)
        }
        GenericLightLanguage::Java | GenericLightLanguage::Csharp => {
            jvm_or_csharp_light_symbol(line, language, line_number)
        }
    }
}

fn rust_light_symbol(line: &str, line_number: usize) -> Option<SymbolRow> {
    let rest = strip_repeated_prefixes(line, &["pub ", "async "]);
    if let Some(name) = rest
        .strip_prefix("fn ")
        .and_then(|rest| take_ascii_identifier_with_rest(rest).map(|(name, _)| name))
    {
        return Some(generic_symbol("function", name, line, line_number));
    }
    for (keyword, kind) in [
        ("struct ", "struct"),
        ("enum ", "enum"),
        ("trait ", "trait"),
    ] {
        let rest = strip_repeated_prefixes(line, &["pub "]);
        if let Some(name) = rest
            .strip_prefix(keyword)
            .and_then(|rest| take_ascii_identifier_with_rest(rest).map(|(name, _)| name))
        {
            return Some(generic_symbol(kind, name, line, line_number));
        }
    }
    let rest = line.strip_prefix("unsafe ").unwrap_or(line);
    let mut rest = rest.strip_prefix("impl")?;
    if rest.starts_with('<') {
        let end = matching_angle_end(rest)?;
        if end <= 1 {
            return None;
        }
        let after_generic = &rest[end + 1..];
        if !after_generic
            .chars()
            .next()
            .is_some_and(char::is_whitespace)
        {
            return None;
        }
        rest = after_generic.trim_start();
    } else if rest.chars().next().is_some_and(char::is_whitespace) {
        rest = rest.trim_start();
    } else {
        return None;
    }
    if let Some(for_index) = rest.rfind(" for ") {
        let after_for = rest[for_index + 5..].trim_start();
        if let Some((name, _)) = take_ascii_identifier_with_rest(after_for) {
            return Some(generic_symbol("impl", name, line, line_number));
        }
        rest = rest[..for_index].trim_end();
    }
    let (name, _) = take_ascii_identifier_with_rest(rest)?;
    Some(generic_symbol("impl", name, line, line_number))
}

fn kotlin_light_symbol(line: &str, line_number: usize) -> Option<SymbolRow> {
    if let Some(rest) = word_prefix_keyword_rest(line, "fun") {
        let (first_name, after_first) = take_ascii_identifier_with_rest(rest)?;
        let name = if let Some(after_dot) = after_first.trim_start().strip_prefix('.') {
            take_ascii_identifier_with_rest(after_dot.trim_start())
                .map(|(name, _)| name)
                .unwrap_or(first_name)
        } else {
            first_name
        };
        return Some(generic_symbol("function", name, line, line_number));
    }
    for (keyword, kind) in [
        ("class", "class"),
        ("interface", "interface"),
        ("object", "object"),
    ] {
        if let Some(rest) = word_prefix_keyword_rest(line, keyword) {
            let (name, _) = take_ascii_identifier_with_rest(rest)?;
            return Some(generic_symbol(kind, name, line, line_number));
        }
    }
    None
}

fn swift_light_symbol(line: &str, line_number: usize) -> Option<SymbolRow> {
    if let Some(rest) = word_prefix_keyword_rest(line, "func") {
        let (name, _) = take_ascii_identifier_with_rest(rest)?;
        return Some(generic_symbol("function", name, line, line_number));
    }
    for (keyword, kind) in [
        ("class", "class"),
        ("struct", "struct"),
        ("protocol", "protocol"),
        ("enum", "enum"),
    ] {
        if let Some(rest) = word_prefix_keyword_rest(line, keyword) {
            let (name, _) = take_ascii_identifier_with_rest(rest)?;
            return Some(generic_symbol(kind, name, line, line_number));
        }
    }
    None
}

fn php_light_symbol(line: &str, inside_type: bool, line_number: usize) -> Option<SymbolRow> {
    let rest = strip_repeated_prefixes(line, &["abstract ", "final "]);
    for (keyword, kind) in [
        ("class ", "class"),
        ("interface ", "interface"),
        ("trait ", "trait"),
    ] {
        if let Some(name) = rest
            .strip_prefix(keyword)
            .and_then(|rest| take_ascii_identifier_with_rest(rest).map(|(name, _)| name))
        {
            return Some(generic_symbol(kind, name, line, line_number));
        }
    }
    let rest = strip_repeated_prefixes(
        line,
        &[
            "public ",
            "private ",
            "protected ",
            "static ",
            "final ",
            "abstract ",
        ],
    );
    let rest = rest.strip_prefix("function ")?;
    let rest = rest
        .trim_start()
        .strip_prefix('&')
        .unwrap_or(rest)
        .trim_start();
    let (name, _) = take_ascii_identifier_with_rest(rest)?;
    Some(generic_symbol(
        if inside_type { "method" } else { "function" },
        name,
        line,
        line_number,
    ))
}

fn c_family_light_symbol(
    line: &str,
    language: GenericLightLanguage,
    line_number: usize,
) -> Option<SymbolRow> {
    if language == GenericLightLanguage::Cpp {
        if let Some(rest) = line.strip_prefix("namespace ") {
            let (name, _) = take_ascii_identifier_with_rest(rest.trim_start())?;
            return Some(generic_symbol("namespace", name, line, line_number));
        }
        let rest = line
            .strip_prefix("template")
            .and_then(|rest| {
                let rest = rest.trim_start();
                if rest.starts_with('<') {
                    matching_angle_end(rest).map(|end| rest[end + 1..].trim_start())
                } else {
                    None
                }
            })
            .unwrap_or(line);
        for (keyword, kind) in [("class ", "class"), ("struct ", "struct")] {
            if let Some(name) = rest
                .strip_prefix(keyword)
                .and_then(|rest| take_ascii_identifier_with_rest(rest).map(|(name, _)| name))
            {
                return Some(generic_symbol(kind, name, line, line_number));
            }
        }
        if let Some(name) = rest
            .strip_prefix("enum class ")
            .or_else(|| rest.strip_prefix("enum "))
            .and_then(|rest| take_ascii_identifier_with_rest(rest).map(|(name, _)| name))
        {
            return Some(generic_symbol("enum", name, line, line_number));
        }
    } else {
        for (keyword, kind) in [("struct ", "struct"), ("enum ", "enum")] {
            if let Some(name) = line
                .strip_prefix(keyword)
                .and_then(|rest| take_ascii_identifier_with_rest(rest).map(|(name, _)| name))
            {
                return Some(generic_symbol(kind, name, line, line_number));
            }
        }
    }
    let name = c_like_function_name(line)?;
    Some(generic_symbol("function", name, line, line_number))
}

fn jvm_or_csharp_light_symbol(
    line: &str,
    language: GenericLightLanguage,
    line_number: usize,
) -> Option<SymbolRow> {
    for (keyword, kind) in [
        ("class", "class"),
        ("interface", "interface"),
        ("enum", "enum"),
        ("struct", "struct"),
    ] {
        if keyword == "struct" && language != GenericLightLanguage::Csharp {
            continue;
        }
        if let Some(rest) = word_prefix_keyword_rest(line, keyword) {
            let (name, _) = take_ascii_identifier_with_rest(rest)?;
            return Some(generic_symbol(kind, name, line, line_number));
        }
    }
    let name = c_like_function_name(line)?;
    Some(generic_symbol("method", name, line, line_number))
}

fn generic_import_row(
    edge_kind: &str,
    imported: &str,
    raw: &str,
    line: usize,
    to_ref: &str,
) -> ImportRow {
    ImportRow {
        edge_kind: edge_kind.to_string(),
        imported: imported.to_string(),
        line,
        raw: raw.trim_end_matches(';').to_string(),
        to_ref: to_ref.to_string(),
    }
}

fn generic_symbol(kind: &str, name: &str, line: &str, line_number: usize) -> SymbolRow {
    SymbolRow {
        kind: kind.to_string(),
        line: line_number,
        name: name.to_string(),
        signature: one_line(line),
    }
}

fn include_import_ref(line: &str) -> Option<String> {
    let rest = line.strip_prefix("#")?.trim_start();
    let rest = rest.strip_prefix("include")?.trim_start();
    let opener = rest.chars().next()?;
    let closer = if opener == '<' {
        '>'
    } else if opener == '"' {
        '"'
    } else {
        return None;
    };
    let body = &rest[opener.len_utf8()..];
    let end = body.find(closer)?;
    Some(body[..end].to_string())
}

fn take_qualified_name<'a>(text: &'a str, separator: &str) -> Option<&'a str> {
    let mut end = 0usize;
    for (index, ch) in text.char_indices() {
        if ch.is_ascii_alphanumeric() || ch == '_' || separator.contains(ch) {
            end = index + ch.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        None
    } else {
        Some(&text[..end])
    }
}

fn take_dotted_name(text: &str) -> Option<&str> {
    let mut end = 0usize;
    for (index, ch) in text.char_indices() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.') {
            end = index + ch.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        None
    } else {
        Some(&text[..end])
    }
}

fn take_dotted_import_name(text: &str) -> Option<&str> {
    let mut end = 0usize;
    for (index, ch) in text.char_indices() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '*' | '$') {
            end = index + ch.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 {
        None
    } else {
        Some(&text[..end])
    }
}

fn normalize_spaces(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_repeated_prefixes<'a>(mut text: &'a str, prefixes: &[&str]) -> &'a str {
    loop {
        let mut stripped = false;
        for prefix in prefixes {
            if let Some(rest) = text.strip_prefix(prefix) {
                text = rest.trim_start();
                stripped = true;
                break;
            }
            if *prefix == "pub " && text.starts_with("pub(") {
                if let Some(end) = text.find(')') {
                    text = text[end + 1..].trim_start();
                    stripped = true;
                    break;
                }
            }
        }
        if !stripped {
            return text;
        }
    }
}

fn matching_angle_end(text: &str) -> Option<usize> {
    let mut depth = 0i32;
    for (index, ch) in text.char_indices() {
        if ch == '<' {
            depth += 1;
        } else if ch == '>' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn find_keyword(line: &str, keyword: &str) -> Option<usize> {
    let mut search_from = 0usize;
    while let Some(relative) = line[search_from..].find(keyword) {
        let index = search_from + relative;
        let before = line[..index].chars().next_back();
        let after = line[index + keyword.len()..].chars().next();
        let before_ok = before.is_none_or(|ch| !is_identifier_char(ch));
        let after_ok = after.is_none_or(|ch| !is_identifier_char(ch));
        if before_ok && after_ok {
            return Some(index);
        }
        search_from = index + keyword.len();
    }
    None
}

fn word_prefix_keyword_rest<'a>(line: &'a str, keyword: &str) -> Option<&'a str> {
    let index = find_keyword(line, keyword)?;
    let prefix = &line[..index];
    if !prefix
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch.is_whitespace())
    {
        return None;
    }
    if !prefix.is_empty() && !prefix.chars().next_back().is_some_and(char::is_whitespace) {
        return None;
    }
    let rest = &line[index + keyword.len()..];
    if !rest.chars().next().is_some_and(char::is_whitespace) {
        return None;
    }
    Some(rest.trim_start())
}

fn is_identifier_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_'
}

fn c_like_function_name(line: &str) -> Option<&str> {
    if !line.contains('(') || line.ends_with(';') || line.starts_with('#') {
        return None;
    }
    let first = line.split_whitespace().next().unwrap_or_default();
    if matches!(
        first,
        "if" | "for" | "while" | "switch" | "catch" | "return" | "new" | "throw"
    ) {
        return None;
    }
    let before_paren = line[..line.find('(')?].trim_end();
    let mut end = before_paren.len();
    while end > 0 {
        let ch = before_paren[..end].chars().next_back()?;
        if is_identifier_char(ch) {
            break;
        }
        end -= ch.len_utf8();
    }
    let mut start = end;
    while start > 0 {
        let ch = before_paren[..start].chars().next_back()?;
        if is_identifier_char(ch) {
            start -= ch.len_utf8();
        } else {
            break;
        }
    }
    if let Some(previous) = before_paren[..start].chars().next_back() {
        if !(previous.is_whitespace() || matches!(previous, ':' | '*' | '&' | '~')) {
            return None;
        }
    }
    let name = &before_paren[start..end];
    if name.is_empty()
        || matches!(
            name,
            "if" | "for" | "while" | "switch" | "catch" | "return" | "sizeof"
        )
    {
        None
    } else {
        Some(name)
    }
}

fn push_import_row(extracted: &mut Extracted, file: &ManifestFile, import: ImportRow) {
    if import.to_ref.is_empty() {
        return;
    }
    extracted.edges.push(EdgeRow {
        evidence: import.raw.clone(),
        kind: import.edge_kind.clone(),
        line: import.line,
        source: file.path.clone(),
        source_kind: "file".to_string(),
        target: import.to_ref.clone(),
        target_kind: "module".to_string(),
    });
    extracted.imports.push(import);
}

fn extract_javascript_like(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    let mut context_stack: Vec<ContextFrame> = Vec::new();
    let mut pending_decorator_routes: Vec<DecoratorRoute> = Vec::new();
    let mut pending_call: Option<PendingCallExpression> = None;
    let mut pending_multiline_call_chain: Option<PendingMultilineCallChain> = None;
    let mut pending_bare_call_chain: Option<PendingMultilineCallChain> = None;
    let mut pending_variable_function: Option<PendingVariableFunctionSymbol> = None;
    let mut pending_context_symbol: Option<String> = None;
    let mut pending_import: Option<PendingImportDeclaration> = None;
    let mut in_block_comment = false;
    let mut in_template_literal = false;
    let mut template_expression_depth = 0i32;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = one_line(raw_line);
        let mut trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if in_template_literal {
            let template_context = context_stack
                .last()
                .map(|frame| frame.name.clone())
                .unwrap_or_default();
            for call in calls_from_template_expressions(trimmed) {
                extracted.edges.push(EdgeRow {
                    evidence: call.evidence,
                    kind: "call".to_string(),
                    line: line_number,
                    source: if template_context.is_empty() {
                        file.path.clone()
                    } else {
                        template_context.clone()
                    },
                    source_kind: if template_context.is_empty() {
                        "file".to_string()
                    } else {
                        "symbol".to_string()
                    },
                    target: call.target,
                    target_kind: "symbol".to_string(),
                });
            }
            let template_state =
                scan_template_literal_continuation(trimmed, template_expression_depth);
            template_expression_depth = template_state.expression_depth;
            if template_state.closes {
                in_template_literal = false;
                template_expression_depth = 0;
            }
            continue;
        }
        if in_block_comment {
            if trimmed.contains("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if let Some(after_comment) = strip_leading_closed_block_comment(trimmed) {
            if after_comment.is_empty() {
                continue;
            }
            trimmed = after_comment;
        } else if trimmed.starts_with("/*") {
            if !trimmed.contains("*/") {
                in_block_comment = true;
            }
            continue;
        }
        if is_comment_line(trimmed) {
            continue;
        }
        if starts_non_declaration_template_literal(trimmed) {
            in_template_literal = true;
            template_expression_depth = template_expression_depth_after_opening_line(trimmed);
            continue;
        }
        let opens_template_literal = has_unbalanced_template_delimiter(trimmed);
        if let Some(import) = pending_import.as_mut() {
            import.parts.push(trimmed.to_string());
            if import_declaration_complete(trimmed) {
                let joined = one_line_unbounded(&import.parts.join(" "));
                if let Some(mut row) = import_from_line(&joined, import.line) {
                    row.raw = one_line(&row.raw);
                    extracted.edges.push(EdgeRow {
                        evidence: row.raw.clone(),
                        kind: row.edge_kind.clone(),
                        line: row.line,
                        source: file.path.clone(),
                        source_kind: "file".to_string(),
                        target: row.to_ref.clone(),
                        target_kind: "module".to_string(),
                    });
                    extracted.imports.push(row);
                }
                pending_import = None;
            }
            continue;
        }
        if starts_multiline_import_declaration(trimmed) {
            pending_import = Some(PendingImportDeclaration {
                line: line_number,
                parts: vec![trimmed.to_string()],
            });
            continue;
        }
        if let Some(route) = decorator_route_from_line(trimmed, line_number) {
            pending_decorator_routes.push(route);
            continue;
        }
        if let Some(mut pending_variable) = pending_variable_function.take() {
            push_pending_variable_function_part(&mut pending_variable, trimmed);
            if pending_variable_function_complete(&pending_variable, trimmed) {
                let symbol = finalize_pending_variable_function_symbol(pending_variable);
                if is_context_symbol(&symbol) && opens_pending_context_body(trimmed) {
                    let delta = brace_delta(trimmed);
                    if delta > 0 {
                        context_stack.push(ContextFrame {
                            brace_depth: delta,
                            name: symbol.name.clone(),
                        });
                    }
                }
                extracted.symbols.push(symbol);
            } else {
                pending_variable_function = Some(pending_variable);
            }
            continue;
        }
        let pending_context_opens_on_line =
            pending_context_symbol.is_some() && opens_pending_context_body(trimmed);
        let current_context = if pending_context_opens_on_line {
            pending_context_symbol.clone().unwrap_or_default()
        } else {
            context_stack
                .last()
                .map(|frame| frame.name.clone())
                .unwrap_or_default()
        };
        let mut line_symbol = symbol_from_line(trimmed, line_number);
        if let Some(pending_variable) = line_symbol
            .as_ref()
            .and_then(|symbol| pending_variable_function_candidate(symbol, trimmed))
        {
            pending_variable_function = Some(pending_variable);
            continue;
        }
        if let Some(symbol) = line_symbol.as_mut() {
            if symbol.kind == "method" && !pending_decorator_routes.is_empty() {
                symbol.line = pending_decorator_routes[0].line;
                for route in pending_decorator_routes.drain(..) {
                    extracted.routes.push(RouteRow {
                        handler: symbol.name.clone(),
                        line: route.line,
                        method: route.method.clone(),
                        route: route.route.clone(),
                    });
                    extracted.edges.push(EdgeRow {
                        evidence: symbol.signature.clone(),
                        kind: "route_to_handler".to_string(),
                        line: route.line,
                        source: format!("{} {}", route.method, route.route),
                        source_kind: "route".to_string(),
                        target: symbol.name.clone(),
                        target_kind: "symbol".to_string(),
                    });
                    extracted.edges.push(EdgeRow {
                        evidence: format!("@{}({})", route.callee, javascript_quote(&route.route)),
                        kind: "call".to_string(),
                        line: route.line,
                        source: symbol.name.clone(),
                        source_kind: "symbol".to_string(),
                        target: route.callee,
                        target_kind: "symbol".to_string(),
                    });
                }
            }
            extracted.symbols.push(SymbolRow {
                kind: symbol.kind.clone(),
                line: symbol.line,
                name: symbol.name.clone(),
                signature: symbol.signature.clone(),
            });
        }
        if let Some(symbol) = line_symbol
            .as_ref()
            .filter(|symbol| is_context_symbol(symbol))
        {
            if opens_pending_context_body(trimmed) {
                pending_context_symbol = None;
            } else {
                pending_context_symbol = Some(symbol.name.clone());
            }
        }
        for symbol in variable_symbols_from_line(trimmed, line_number, line_symbol.as_ref()) {
            extracted.symbols.push(symbol);
        }
        if let Some(import) = import_from_line(trimmed, line_number) {
            extracted.edges.push(EdgeRow {
                evidence: import.raw.clone(),
                kind: import.edge_kind.clone(),
                line: import.line,
                source: file.path.clone(),
                source_kind: "file".to_string(),
                target: import.to_ref.clone(),
                target_kind: "module".to_string(),
            });
            extracted.imports.push(import);
        }
        if let Some(call) = pending_call.as_mut() {
            call.parts.push(trimmed.trim_end_matches(';').to_string());
            if let Some((evidence, target)) = finish_pending_property_call(&call.parts) {
                extracted.edges.push(EdgeRow {
                    evidence,
                    kind: "call".to_string(),
                    line: call.line,
                    source: if call.context.is_empty() {
                        file.path.clone()
                    } else {
                        call.context.clone()
                    },
                    source_kind: if call.context.is_empty() {
                        "file".to_string()
                    } else {
                        "symbol".to_string()
                    },
                    target,
                    target_kind: "symbol".to_string(),
                });
                pending_call = None;
            }
        } else if let Some(start) = pending_property_call_start(trimmed) {
            pending_call = Some(PendingCallExpression {
                context: line_symbol
                    .as_ref()
                    .filter(|symbol| is_context_symbol(symbol))
                    .map(|symbol| symbol.name.clone())
                    .unwrap_or_else(|| current_context.clone()),
                line: line_number,
                parts: vec![start],
            });
        }
        let mut is_route_line = false;
        if let Some(route) = route_from_line(trimmed, line_number) {
            is_route_line = true;
            let evidence = trimmed.trim_end_matches(';').to_string();
            let route_call_context = line_symbol
                .as_ref()
                .filter(|symbol| is_context_symbol(symbol))
                .map(|symbol| symbol.name.clone())
                .unwrap_or_else(|| current_context.clone());
            let route_call_has_context = !route_call_context.is_empty();
            extracted.edges.push(EdgeRow {
                evidence: evidence.clone(),
                kind: "route_to_handler".to_string(),
                line: line_number,
                source: format!("{} {}", route.method, route.route),
                source_kind: "route".to_string(),
                target: route.handler.clone(),
                target_kind: "symbol".to_string(),
            });
            extracted.edges.push(EdgeRow {
                evidence,
                kind: "call".to_string(),
                line: line_number,
                source: if route_call_context.is_empty() {
                    file.path.clone()
                } else {
                    route_call_context
                },
                source_kind: if route_call_has_context {
                    "symbol".to_string()
                } else {
                    "file".to_string()
                },
                target: format!(
                    "{}.{}",
                    route_call_parts(trimmed)
                        .map(|(receiver, _)| receiver)
                        .unwrap_or("app"),
                    route.method.to_lowercase()
                ),
                target_kind: "symbol".to_string(),
            });
            extracted.routes.push(route);
        }
        let call_context = line_symbol
            .as_ref()
            .filter(|symbol| is_context_symbol(symbol))
            .map(|symbol| symbol.name.clone())
            .unwrap_or(current_context);
        let is_property_chain_continuation =
            (trimmed.starts_with('.') && !trimmed.starts_with("...")) || trimmed.starts_with(").");
        let mut consumed_property_chain_continuation = false;
        let mut started_chain_calls: Vec<String> = Vec::new();
        if let Some(chain) = pending_bare_call_chain.as_mut() {
            if is_property_chain_continuation {
                push_pending_chain_part(chain, trimmed);
                consumed_property_chain_continuation = true;
            } else if let Some(chain) = pending_bare_call_chain.take() {
                push_property_chain_call_edges(&mut extracted, file, &chain);
            }
        }
        if let Some(mut chain) = pending_multiline_call_chain.take() {
            let chain_has_open_delimiter = chain.delimiter_delta > 0;
            if is_property_chain_continuation || chain_has_open_delimiter {
                push_pending_chain_part(&mut chain, trimmed);
                consumed_property_chain_continuation |= is_property_chain_continuation;
                if multiline_statement_complete(&chain) {
                    push_property_chain_call_edges(&mut extracted, file, &chain);
                } else {
                    pending_multiline_call_chain = Some(chain);
                }
            } else {
                push_property_chain_call_edges(&mut extracted, file, &chain);
            }
        }
        if pending_multiline_call_chain.is_none() {
            if let Some(start) = multiline_property_chain_start(trimmed) {
                let chain =
                    pending_multiline_call_chain_start(call_context.clone(), line_number, start);
                started_chain_calls = if chain.delimiter_delta > 0 {
                    top_level_property_calls_from_expression(&chain.parts.join(" "))
                        .into_iter()
                        .map(|call| call.target)
                        .collect::<Vec<_>>()
                } else {
                    Vec::new()
                };
                pending_multiline_call_chain = Some(chain);
            } else if pending_bare_call_chain.is_none() {
                if let Some(start) = bare_property_chain_start(trimmed) {
                    pending_bare_call_chain = Some(pending_multiline_call_chain_start(
                        call_context.clone(),
                        line_number,
                        start,
                    ));
                }
            }
        }
        if !consumed_property_chain_continuation {
            for call in calls_from_line(trimmed, line_symbol.as_ref(), is_route_line) {
                if started_chain_calls
                    .iter()
                    .any(|target| target == &call.target)
                {
                    continue;
                }
                extracted.edges.push(EdgeRow {
                    evidence: call.evidence,
                    kind: "call".to_string(),
                    line: line_number,
                    source: if call_context.is_empty() {
                        file.path.clone()
                    } else {
                        call_context.clone()
                    },
                    source_kind: if call_context.is_empty() {
                        "file".to_string()
                    } else {
                        "symbol".to_string()
                    },
                    target: call.target,
                    target_kind: "symbol".to_string(),
                });
            }
        }
        if opens_template_literal {
            in_template_literal = true;
            template_expression_depth = template_expression_depth_after_opening_line(trimmed);
        } else {
            update_context_stack(&mut context_stack, line_symbol.as_ref(), trimmed);
            if pending_context_opens_on_line {
                if let Some(name) = pending_context_symbol.take() {
                    let delta = brace_delta(trimmed);
                    if delta > 0 {
                        context_stack.push(ContextFrame {
                            brace_depth: delta,
                            name,
                        });
                    }
                }
            } else if trimmed.ends_with(';') {
                pending_context_symbol = None;
            }
        }
    }
    if let Some(chain) = pending_bare_call_chain {
        push_property_chain_call_edges(&mut extracted, file, &chain);
    }
    if let Some(chain) = pending_multiline_call_chain {
        push_property_chain_call_edges(&mut extracted, file, &chain);
    }
    if let Some(pending_variable) = pending_variable_function {
        extracted
            .symbols
            .push(finalize_pending_variable_function_symbol(pending_variable));
    }
    extracted
}

fn pending_variable_function_candidate(
    symbol: &SymbolRow,
    line: &str,
) -> Option<PendingVariableFunctionSymbol> {
    if symbol.kind != "variable" {
        return None;
    }
    let cleaned = line
        .strip_prefix("export default ")
        .or_else(|| line.strip_prefix("export "))
        .unwrap_or(line);
    let initializer = variable_initializer(cleaned);
    let requires_arrow = initializer
        .map(generic_multiline_function_initializer_requires_arrow)
        .unwrap_or(false)
        || typed_variable_declaration_can_continue_to_arrow(cleaned, &symbol.name);
    if !requires_arrow
        && !initializer
            .map(potential_multiline_function_initializer)
            .unwrap_or(false)
    {
        return None;
    }
    let delimiter_delta = delimiter_delta(line);
    if delimiter_delta <= 0 && !requires_arrow {
        return None;
    }
    Some(PendingVariableFunctionSymbol {
        delimiter_delta,
        parts: vec![line.to_string()],
        requires_arrow,
        saw_arrow: contains_top_level_arrow(line),
        symbol: SymbolRow {
            kind: symbol.kind.clone(),
            line: symbol.line,
            name: symbol.name.clone(),
            signature: symbol.signature.clone(),
        },
    })
}

fn push_pending_variable_function_part(candidate: &mut PendingVariableFunctionSymbol, line: &str) {
    candidate.delimiter_delta += delimiter_delta(line);
    candidate.parts.push(line.to_string());
    if !candidate.saw_arrow && contains_top_level_arrow(&candidate.parts.join(" ")) {
        candidate.saw_arrow = true;
    }
}

fn pending_variable_function_complete(
    candidate: &PendingVariableFunctionSymbol,
    line: &str,
) -> bool {
    if candidate.saw_arrow {
        return opens_pending_context_body(line)
            || (candidate.delimiter_delta <= 0 && !line.trim_end().ends_with("=>"));
    }
    if candidate.requires_arrow {
        return candidate.delimiter_delta <= 0
            && (line.contains('=') || line.trim_end().ends_with(';'));
    }
    candidate.delimiter_delta <= 0
}

fn finalize_pending_variable_function_symbol(
    candidate: PendingVariableFunctionSymbol,
) -> SymbolRow {
    let mut symbol = candidate.symbol;
    if candidate.saw_arrow {
        symbol.kind = "function".to_string();
    }
    symbol
}

fn push_property_chain_call_edges(
    extracted: &mut Extracted,
    file: &ManifestFile,
    chain: &PendingMultilineCallChain,
) {
    for call in top_level_property_calls_from_expression(&chain.parts.join(" ")) {
        extracted.edges.push(EdgeRow {
            evidence: call.evidence,
            kind: "call".to_string(),
            line: chain.line,
            source: if chain.context.is_empty() {
                file.path.clone()
            } else {
                chain.context.clone()
            },
            source_kind: if chain.context.is_empty() {
                "file".to_string()
            } else {
                "symbol".to_string()
            },
            target: call.target,
            target_kind: "symbol".to_string(),
        });
    }
}

fn pending_multiline_call_chain_start(
    context: String,
    line: usize,
    start: String,
) -> PendingMultilineCallChain {
    PendingMultilineCallChain {
        context,
        delimiter_delta: delimiter_delta(&start),
        line,
        parts: vec![start],
    }
}

fn push_pending_chain_part(chain: &mut PendingMultilineCallChain, part: &str) {
    chain.delimiter_delta += delimiter_delta(part);
    chain.parts.push(part.to_string());
}

fn multiline_property_chain_start(line: &str) -> Option<String> {
    if line.ends_with(';')
        || line.starts_with("import ")
        || (line.starts_with("export ") && line.contains(" from "))
        || line.contains("=>")
    {
        return None;
    }
    let expression = statement_expression_start(line)?;
    if expression.is_empty() {
        return None;
    }
    if expression.contains("=>") {
        return None;
    }
    Some(expression.to_string())
}

fn statement_expression_start(line: &str) -> Option<&str> {
    let expression = line.trim();
    let mut expression = if let Some((lhs, rhs)) = expression.rsplit_once('=') {
        if !assignment_can_start_multiline_chain(lhs) {
            return None;
        }
        rhs.trim()
    } else if let Some(rest) = expression.strip_prefix("return ") {
        rest.trim()
    } else if let Some(rest) = expression.strip_prefix("await ") {
        rest.trim()
    } else {
        return None;
    };
    while let Some(rest) = expression.strip_prefix("await ") {
        expression = rest.trim();
    }
    if expression.is_empty() || matches!(expression, "{" | "[" | "(") {
        return None;
    }
    Some(expression)
}

fn bare_property_chain_start(line: &str) -> Option<String> {
    if line.ends_with(';')
        || line.starts_with('.')
        || line.starts_with(").")
        || line.starts_with("import ")
        || (line.starts_with("export ") && line.contains(" from "))
        || line.starts_with("return ")
        || line.starts_with("throw ")
        || line.starts_with("await ")
        || line.contains("=>")
        || delimiter_delta(line) != 0
    {
        return None;
    }
    if matches!(
        line.split_whitespace().next(),
        Some("if" | "for" | "while" | "switch" | "catch" | "function" | "class")
    ) {
        return None;
    }
    let calls = calls_from_line(line, None, false);
    if calls.is_empty() || calls.iter().any(|call| call.target.contains('.')) {
        return None;
    }
    Some(line.to_string())
}

fn assignment_can_start_multiline_chain(lhs: &str) -> bool {
    let lhs = lhs.trim_start();
    if matches!(
        lhs.split_whitespace().next(),
        Some("if" | "for" | "while" | "switch" | "catch" | "return")
    ) {
        return false;
    }
    if lhs.starts_with("const ")
        || lhs.starts_with("let ")
        || lhs.starts_with("var ")
        || lhs.starts_with("export const ")
        || lhs.starts_with("export let ")
        || lhs.starts_with("export var ")
    {
        return true;
    }
    lhs.chars()
        .last()
        .map(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' || ch == ']' || ch == ')')
        .unwrap_or(false)
}

fn multiline_statement_complete(chain: &PendingMultilineCallChain) -> bool {
    chain
        .parts
        .last()
        .map(|part| part.trim_end().ends_with(';'))
        .unwrap_or(false)
        && chain.delimiter_delta <= 0
}

fn top_level_property_calls_from_expression(expression: &str) -> Vec<CallRow> {
    let expression = expression.trim().trim_end_matches(';');
    let mut calls = Vec::new();
    let mut paren_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut brace_depth = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in expression.char_indices() {
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        match ch {
            '(' => {
                if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 {
                    if let Some((target_start, target)) =
                        call_target_before_paren(expression, index)
                    {
                        if target.contains('.')
                            && !should_skip_call_target(expression, target_start, &target, None)
                        {
                            calls.push(CallRow {
                                evidence: call_evidence(expression, target_start, index),
                                target,
                            });
                        }
                    }
                }
                paren_depth += 1;
            }
            ')' => paren_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            '{' => brace_depth += 1,
            '}' => brace_depth -= 1,
            _ => {}
        }
    }
    calls
}

fn delimiter_delta(text: &str) -> i32 {
    let mut delta = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in text.chars() {
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        match ch {
            '(' | '[' | '{' => delta += 1,
            ')' | ']' | '}' => delta -= 1,
            _ => {}
        }
    }
    delta
}

fn pending_property_call_start(line: &str) -> Option<String> {
    line.strip_prefix("return ")
        .map(str::trim)
        .filter(|rest| rest.starts_with('[') && !rest.contains("]."))
        .map(|rest| rest.trim_end_matches(';').to_string())
}

fn finish_pending_property_call(parts: &[String]) -> Option<(String, String)> {
    let expression = parts.join(" ");
    if !expression.contains("].") || !expression.contains('(') {
        return None;
    }
    let evidence = expression.trim_end_matches(';').to_string();
    let paren_index = evidence.rfind('(')?;
    let target = evidence[..paren_index].trim().to_string();
    if target.is_empty() {
        return None;
    }
    Some((evidence, target))
}

struct CallRow {
    evidence: String,
    target: String,
}

fn is_context_symbol(symbol: &SymbolRow) -> bool {
    symbol.kind == "function" || symbol.kind == "method" || symbol.kind == "class"
}

fn opens_pending_context_body(line: &str) -> bool {
    line.trim_end().ends_with('{') && brace_delta(line) > 0
}

fn update_context_stack(stack: &mut Vec<ContextFrame>, symbol: Option<&SymbolRow>, line: &str) {
    let delta = brace_delta(line);
    if delta != 0 {
        for frame in stack.iter_mut() {
            frame.brace_depth += delta;
        }
        while stack
            .last()
            .map(|frame| frame.brace_depth <= 0)
            .unwrap_or(false)
        {
            stack.pop();
        }
    }
    if delta > 0 {
        if let Some(symbol) = symbol.filter(|candidate| is_context_symbol(candidate)) {
            stack.push(ContextFrame {
                brace_depth: delta,
                name: symbol.name.clone(),
            });
        }
    }
}

fn brace_delta(line: &str) -> i32 {
    let mut total = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut in_regex_literal = false;
    let mut in_regex_char_class = false;
    let mut in_block_comment = false;
    let mut previous_significant: Option<char> = None;
    for (index, ch) in line.char_indices() {
        if in_block_comment {
            if line[index..].starts_with("*/") {
                in_block_comment = false;
            }
            continue;
        }
        if in_regex_literal {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '[' {
                in_regex_char_class = true;
            } else if ch == ']' {
                in_regex_char_class = false;
            } else if ch == '/' && !in_regex_char_class {
                in_regex_literal = false;
                previous_significant = Some('/');
            }
            continue;
        }
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if line[index..].starts_with("//") {
            break;
        }
        if line[index..].starts_with("/*") {
            in_block_comment = true;
            continue;
        }
        if ch == '/' && regex_literal_can_start_after(previous_significant) {
            in_regex_literal = true;
            in_regex_char_class = false;
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        match ch {
            '{' => total += 1,
            '}' => total -= 1,
            _ => {}
        }
        if !ch.is_whitespace() {
            previous_significant = Some(ch);
        }
    }
    total
}

fn calls_from_line(
    line: &str,
    declared_symbol: Option<&SymbolRow>,
    is_route_line: bool,
) -> Vec<CallRow> {
    if is_route_line
        || line.starts_with("import ")
        || (line.starts_with("export ") && line.contains(" from "))
    {
        return Vec::new();
    }
    let mut calls = Vec::new();
    let mut search_from = 0;
    while let Some(relative_index) = line[search_from..].find('(') {
        let paren_index = search_from + relative_index;
        if let Some((target_start, target)) = call_target_before_paren(line, paren_index) {
            if !should_skip_call_target(line, target_start, &target, declared_symbol) {
                calls.push(CallRow {
                    evidence: call_evidence(line, target_start, paren_index),
                    target,
                });
            }
        }
        search_from = paren_index + 1;
    }
    calls
}

fn calls_from_template_expressions(line: &str) -> Vec<CallRow> {
    let mut calls = Vec::new();
    let mut search_from = 0usize;
    while let Some(relative_start) = line[search_from..].find("${") {
        let expression_start = search_from + relative_start + 2;
        let Some(expression_end) = template_expression_end(line, expression_start) else {
            break;
        };
        calls.extend(calls_from_line(
            line[expression_start..expression_end].trim(),
            None,
            false,
        ));
        search_from = expression_end + 1;
    }
    calls
}

fn template_expression_end(line: &str, expression_start: usize) -> Option<usize> {
    let mut depth = 1i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (offset, ch) in line[expression_start..].char_indices() {
        let index = expression_start + offset;
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn call_target_before_paren(line: &str, paren_index: usize) -> Option<(usize, String)> {
    let bytes = line.as_bytes();
    let mut end = paren_index;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    if line[..end].trim_end().ends_with('>') {
        let without_generics = strip_trailing_generic_parameters(&line[..end]);
        if without_generics.len() < line[..end].trim_end().len() {
            end = without_generics.len();
            while end > 0 && bytes[end - 1].is_ascii_whitespace() {
                end -= 1;
            }
        }
    }
    if end > 0 && bytes[end - 1] == b')' {
        let close_index = end - 1;
        if let Some(open_index) = matching_delimiter_backward(line, close_index, '(', ')') {
            let start = expression_start_before_paren(line, open_index);
            let target = line[start..end].trim().to_string();
            if !target.is_empty() {
                return Some((start, target));
            }
        }
    }
    let mut start = end;
    while start > 0 {
        let ch = bytes[start - 1] as char;
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' || ch == '.' {
            start -= 1;
        } else {
            break;
        }
    }
    if start == end {
        return None;
    }
    let stripped_spread_prefix = if line[start..end].starts_with("...") {
        start += 3;
        true
    } else {
        false
    };
    if start == end {
        return None;
    }
    if line[start..end].starts_with('.') {
        start = property_receiver_start(line, start);
    } else if !stripped_spread_prefix {
        if let Some(dot_index) = previous_non_whitespace_index(line, start) {
            if line[dot_index..].starts_with('.') {
                start = property_receiver_start(line, dot_index);
            }
        }
    }
    if let Some(regex_start) = regex_literal_property_start(line, start, end) {
        start = regex_start;
    }
    call_target_without_leading_keyword(line, start, end)
}

fn call_target_without_leading_keyword(
    line: &str,
    start: usize,
    end: usize,
) -> Option<(usize, String)> {
    let mut target_start = start;
    let mut target = line[start..end].trim();
    for keyword in ["return ", "throw ", "yield "] {
        if let Some(rest) = target.strip_prefix(keyword) {
            let offset = line[target_start..end].find(keyword)? + keyword.len();
            target_start += offset;
            target = rest.trim_start();
            break;
        }
    }
    while let Some(prefix) = target.chars().next().filter(|ch| matches!(ch, '!' | '~')) {
        let consumed = prefix.len_utf8();
        target_start += consumed;
        target = target[consumed..].trim_start();
        target_start += line[target_start..end].len() - line[target_start..end].trim_start().len();
    }
    if target.is_empty() {
        return None;
    }
    Some((target_start, target.to_string()))
}

fn previous_non_whitespace_index(line: &str, before: usize) -> Option<usize> {
    line[..before]
        .char_indices()
        .rev()
        .find(|(_, ch)| !ch.is_whitespace())
        .map(|(index, _)| index)
}

fn property_receiver_start(line: &str, dot_start: usize) -> usize {
    let mut start = dot_start;
    while let Some((previous_index, previous)) = line[..start].char_indices().next_back() {
        if previous.is_whitespace() {
            let bridges_spaced_property_access = start == dot_start
                || previous_non_whitespace_index(line, previous_index)
                    .map(|index| line[index..].starts_with('.'))
                    .unwrap_or(false);
            if bridges_spaced_property_access {
                start = previous_index;
                continue;
            }
            break;
        }
        if previous == ')' {
            if let Some(open_index) = matching_delimiter_backward(line, previous_index, '(', ')') {
                start = expression_start_before_paren(line, open_index);
                continue;
            }
        }
        if previous == ']' {
            if let Some(open_index) = matching_delimiter_backward(line, previous_index, '[', ']') {
                start = open_index;
                continue;
            }
        }
        if matches!(previous, '=' | '(' | ',' | '?' | ':' | ';' | '{') {
            break;
        }
        start = previous_index;
    }
    start
}

fn regex_literal_property_start(
    line: &str,
    target_start: usize,
    target_end: usize,
) -> Option<usize> {
    let dot_index = line[..target_end].rfind('.')?;
    if dot_index < target_start {
        return None;
    }
    let closing_slash = line[..dot_index].rfind('/')?;
    if !line[closing_slash + 1..dot_index]
        .chars()
        .all(|ch| ch.is_ascii_alphabetic())
    {
        return None;
    }
    for (candidate, _) in line[..closing_slash].match_indices('/').rev() {
        if !regex_literal_can_start_at(line, candidate) {
            continue;
        }
        if regex_literal_closing_slash(line, candidate) == Some(closing_slash) {
            return Some(candidate);
        }
    }
    None
}

fn regex_literal_can_start_at(line: &str, slash_index: usize) -> bool {
    let prefix = line[..slash_index].trim_end();
    if prefix.ends_with("=>") || prefix.ends_with("&&") || prefix.ends_with("||") {
        return true;
    }
    if line[..slash_index]
        .split_whitespace()
        .next_back()
        .map(|token| {
            matches!(
                token,
                "return" | "throw" | "yield" | "case" | "delete" | "void" | "typeof" | "await"
            )
        })
        .unwrap_or(false)
    {
        return true;
    }
    let previous = line[..slash_index]
        .chars()
        .rev()
        .find(|ch| !ch.is_whitespace());
    regex_literal_can_start_after(previous)
}

fn regex_literal_closing_slash(line: &str, start: usize) -> Option<usize> {
    let mut escaped = false;
    let mut in_char_class = false;
    for (offset, ch) in line[start + 1..].char_indices() {
        let index = start + 1 + offset;
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == '[' {
            in_char_class = true;
            continue;
        }
        if ch == ']' {
            in_char_class = false;
            continue;
        }
        if ch == '/' && !in_char_class {
            return Some(index);
        }
    }
    None
}

fn expression_start_before_paren(line: &str, paren_index: usize) -> usize {
    let start = call_target_before_paren(line, paren_index)
        .map(|(target_start, _)| target_start)
        .unwrap_or(paren_index);
    new_expression_start(line, start).unwrap_or(start)
}

fn new_expression_start(line: &str, expression_start: usize) -> Option<usize> {
    let prefix = line[..expression_start].trim_end();
    let start = prefix
        .strip_suffix("new")
        .map(|_| prefix.len() - "new".len())?;
    let before = line[..start].chars().next_back();
    if before
        .map(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
        .unwrap_or(false)
    {
        return None;
    }
    Some(start)
}

fn matching_delimiter_backward(
    line: &str,
    close_index: usize,
    open: char,
    close: char,
) -> Option<usize> {
    let mut depth = 0i32;
    for (index, ch) in line[..=close_index].char_indices().rev() {
        if ch == close {
            depth += 1;
        } else if ch == open {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

fn should_skip_call_target(
    line: &str,
    target_start: usize,
    target: &str,
    declared_symbol: Option<&SymbolRow>,
) -> bool {
    if is_ignored_call_position(line, target_start) {
        return true;
    }
    if target.starts_with('.')
        || target.starts_with(").")
        || target.starts_with("].")
        || target.starts_with('}')
        || target == "require"
        || matches!(
            target,
            "if" | "for"
                | "while"
                | "switch"
                | "catch"
                | "function"
                | "class"
                | "new"
                | "async"
                | "return"
                | "void"
                | "constructor"
                | "var"
                | "let"
                | "const"
        )
    {
        return true;
    }
    if starts_unclosed_string_literal_target(target) {
        return true;
    }
    if is_type_member_signature_call(line, target_start, target) {
        return true;
    }
    let prefix = line[..target_start].trim_end();
    if prefix.ends_with("function")
        || prefix.ends_with("class")
        || prefix.ends_with("interface")
        || prefix.ends_with("type")
        || prefix.ends_with("enum")
        || prefix.ends_with("new")
    {
        return true;
    }
    if let Some(symbol) = declared_symbol {
        if target == symbol.name && (symbol.kind == "method" || prefix.is_empty()) {
            return true;
        }
    }
    false
}

fn starts_unclosed_string_literal_target(target: &str) -> bool {
    let Some(quote) = target.chars().next().filter(|ch| matches!(ch, '\'' | '"')) else {
        return false;
    };
    let rest = &target[quote.len_utf8()..];
    let Some(close_offset) = rest.find(quote) else {
        return true;
    };
    !rest[close_offset + quote.len_utf8()..]
        .trim_start()
        .starts_with('.')
}

fn is_type_member_signature_call(line: &str, target_start: usize, target: &str) -> bool {
    if target.contains('.') || target.contains(' ') || target.contains('(') {
        return false;
    }
    if !line[..target_start].trim().is_empty() {
        return false;
    }
    let suffix = line[target_start + target.len()..].trim_start();
    suffix.starts_with('(')
        && line.trim_end().ends_with(';')
        && suffix.contains("):")
        && !line.contains("=>")
}

fn is_comment_line(line: &str) -> bool {
    line.starts_with("//")
        || line.starts_with("/*")
        || line.starts_with('*')
        || line.starts_with("*/")
}

fn strip_leading_closed_block_comment(line: &str) -> Option<&str> {
    if !line.starts_with("/*") {
        return None;
    }
    let comment_end = line.find("*/")?;
    Some(line[comment_end + 2..].trim_start())
}

fn starts_non_declaration_template_literal(line: &str) -> bool {
    has_unbalanced_template_delimiter(line)
        && !line.starts_with("const ")
        && !line.starts_with("let ")
        && !line.starts_with("var ")
        && !line.starts_with("export const ")
        && !line.starts_with("export let ")
        && !line.starts_with("export var ")
}

struct TemplateContinuationState {
    closes: bool,
    expression_depth: i32,
}

fn template_expression_depth_after_opening_line(line: &str) -> i32 {
    let Some(open_index) = line.find('`') else {
        return 0;
    };
    scan_template_literal_continuation(&line[open_index + 1..], 0).expression_depth
}

fn scan_template_literal_continuation(
    line: &str,
    mut expression_depth: i32,
) -> TemplateContinuationState {
    let mut index = 0usize;
    let mut escaped = false;
    let mut quote: Option<char> = None;
    while index < line.len() {
        let rest = &line[index..];
        let Some(ch) = rest.chars().next() else {
            break;
        };
        let ch_len = ch.len_utf8();
        if expression_depth > 0 {
            if let Some(current_quote) = quote {
                if escaped {
                    escaped = false;
                } else if ch == '\\' {
                    escaped = true;
                } else if ch == current_quote {
                    quote = None;
                }
                index += ch_len;
                continue;
            }
            if matches!(ch, '"' | '\'' | '`') {
                quote = Some(ch);
                index += ch_len;
                continue;
            }
            if ch == '{' {
                expression_depth += 1;
            } else if ch == '}' {
                expression_depth -= 1;
            }
            index += ch_len;
            continue;
        }
        if escaped {
            escaped = false;
            index += ch_len;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            index += ch_len;
            continue;
        }
        if rest.starts_with("${") {
            expression_depth = 1;
            index += 2;
            continue;
        }
        if ch == '`' {
            return TemplateContinuationState {
                closes: true,
                expression_depth: 0,
            };
        }
        index += ch_len;
    }
    TemplateContinuationState {
        closes: false,
        expression_depth,
    }
}

fn has_unbalanced_template_delimiter(line: &str) -> bool {
    let mut escaped = false;
    let mut string_quote: Option<char> = None;
    let mut in_template_literal = false;
    let mut in_regex_literal = false;
    let mut in_regex_char_class = false;
    let mut count = 0usize;
    let mut previous_significant: Option<char> = None;
    for (index, ch) in line.char_indices() {
        if in_regex_literal {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '[' {
                in_regex_char_class = true;
            } else if ch == ']' {
                in_regex_char_class = false;
            } else if ch == '/' && !in_regex_char_class {
                in_regex_literal = false;
                previous_significant = Some('/');
            }
            continue;
        }
        if in_template_literal {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '`' {
                count += 1;
                in_template_literal = false;
            }
            continue;
        }
        if let Some(quote) = string_quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == quote {
                string_quote = None;
            }
            continue;
        }
        if escaped {
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if matches!(ch, '"' | '\'') {
            string_quote = Some(ch);
            continue;
        }
        if ch == '/'
            && !line[index..].starts_with("//")
            && !line[index..].starts_with("/*")
            && regex_literal_can_start_after(previous_significant)
        {
            in_regex_literal = true;
            in_regex_char_class = false;
            continue;
        }
        if ch == '`' {
            count += 1;
            in_template_literal = true;
        }
        if !ch.is_whitespace() {
            previous_significant = Some(ch);
        }
    }
    count % 2 == 1
}

fn regex_literal_can_start_after(previous: Option<char>) -> bool {
    previous
        .map(|ch| matches!(ch, '=' | '(' | '[' | '{' | ',' | ':' | ';' | '!' | '?'))
        .unwrap_or(true)
}

fn is_ignored_call_position(line: &str, target_start: usize) -> bool {
    let mut quote: Option<char> = None;
    let mut escaped = false;
    let mut in_regex_literal = false;
    let mut in_regex_char_class = false;
    let mut template_expression_depth = 0i32;
    let mut skip_template_open_brace = false;
    let mut previous_significant: Option<char> = None;
    for (index, ch) in line.char_indices() {
        if index >= target_start {
            break;
        }
        if in_regex_literal {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '[' {
                in_regex_char_class = true;
            } else if ch == ']' {
                in_regex_char_class = false;
            } else if ch == '/' && !in_regex_char_class {
                in_regex_literal = false;
                previous_significant = Some('/');
            }
            continue;
        }
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if current_quote == '`' && template_expression_depth > 0 {
                if skip_template_open_brace && ch == '{' {
                    skip_template_open_brace = false;
                    continue;
                }
                skip_template_open_brace = false;
                match ch {
                    '{' => template_expression_depth += 1,
                    '}' => template_expression_depth -= 1,
                    _ => {}
                }
            } else if current_quote == '`' && line[index..].starts_with("${") {
                template_expression_depth = 1;
                skip_template_open_brace = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if line[index..].starts_with("//") {
            return true;
        }
        if ch == '/'
            && !line[index..].starts_with("/*")
            && regex_literal_can_start_after(previous_significant)
        {
            in_regex_literal = true;
            in_regex_char_class = false;
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        if !ch.is_whitespace() {
            previous_significant = Some(ch);
        }
    }
    if in_regex_literal {
        return true;
    }
    match quote {
        Some('`') => template_expression_depth == 0,
        Some(_) => true,
        None => false,
    }
}

fn call_evidence(line: &str, target_start: usize, paren_index: usize) -> String {
    let mut depth = 0;
    for (offset, ch) in line[paren_index..].char_indices() {
        if ch == '(' {
            depth += 1;
        } else if ch == ')' {
            depth -= 1;
            if depth == 0 {
                return line[target_start..paren_index + offset + 1].to_string();
            }
        }
    }
    line[target_start..].trim_end_matches(';').to_string()
}

fn symbol_from_line(line: &str, line_number: usize) -> Option<SymbolRow> {
    let cleaned = line
        .strip_prefix("export default ")
        .or_else(|| line.strip_prefix("export "))
        .unwrap_or(line);
    let without_semicolon = line.trim_end_matches(';');
    let cleaned_without_semicolon = cleaned.trim_end_matches(';');
    if let Some(rest) = cleaned.strip_prefix("async function ") {
        return symbol_row(rest, "function", without_semicolon, line_number);
    }
    if let Some(rest) = cleaned.strip_prefix("function ") {
        return symbol_row(rest, "function", without_semicolon, line_number);
    }
    if let Some(rest) = cleaned.strip_prefix("class ") {
        return symbol_row(rest, "class", without_semicolon, line_number);
    }
    if let Some(rest) = cleaned.strip_prefix("interface ") {
        return symbol_row(rest, "interface", without_semicolon, line_number);
    }
    if let Some(rest) = cleaned.strip_prefix("type ") {
        return symbol_row(rest, "type", without_semicolon, line_number);
    }
    if let Some(rest) = cleaned.strip_prefix("const enum ") {
        return symbol_row(rest, "enum", without_semicolon, line_number);
    }
    if let Some(rest) = cleaned.strip_prefix("enum ") {
        return symbol_row(rest, "enum", without_semicolon, line_number);
    }
    for prefix in ["const ", "let ", "var "] {
        if let Some(rest) = cleaned.strip_prefix(prefix) {
            let kind = if variable_initializer_is_function(rest) {
                "function"
            } else {
                "variable"
            };
            return symbol_row(rest, kind, cleaned_without_semicolon, line_number);
        }
    }
    if let Some(symbol) = multiline_method_symbol_from_line(cleaned_without_semicolon, line_number)
    {
        return Some(symbol);
    }
    method_symbol_from_line(cleaned_without_semicolon, line_number)
}

fn variable_initializer_is_function(text_after_keyword: &str) -> bool {
    let Some(initializer) = variable_initializer(text_after_keyword) else {
        return false;
    };
    initializer.starts_with("function")
        || initializer.starts_with("async function")
        || initializer == "async ("
        || contains_top_level_arrow(initializer)
}

fn variable_initializer(text_after_keyword: &str) -> Option<&str> {
    let (_, initializer) = text_after_keyword.split_once('=')?;
    Some(initializer.trim())
}

fn potential_multiline_function_initializer(initializer: &str) -> bool {
    if initializer.starts_with('(') {
        return true;
    }
    if initializer.starts_with("async <") || initializer.starts_with("async (") {
        return true;
    }
    initializer.starts_with('<') && initializer.trim_end().ends_with('(')
}

fn generic_multiline_function_initializer_requires_arrow(initializer: &str) -> bool {
    initializer == "<" || initializer.starts_with("async <")
}

fn typed_variable_declaration_can_continue_to_arrow(line: &str, name: &str) -> bool {
    let trimmed = line.trim_end();
    if !trimmed.starts_with("const ") || !trimmed.contains(':') || trimmed.contains('=') {
        return false;
    }
    let after_const = trimmed.trim_start_matches("const ").trim_start();
    if !after_const.starts_with(name) {
        return false;
    }
    delimiter_delta(trimmed) > 0
}

fn contains_top_level_arrow(text: &str) -> bool {
    let mut paren_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut brace_depth = 0i32;
    let mut angle_depth = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in text.char_indices() {
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        match ch {
            '(' => paren_depth += 1,
            ')' => paren_depth -= 1,
            '[' => bracket_depth += 1,
            ']' => bracket_depth -= 1,
            '{' => brace_depth += 1,
            '}' => brace_depth -= 1,
            '<' if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 => {
                angle_depth += 1;
            }
            '>' if angle_depth > 0 => {
                angle_depth -= 1;
            }
            '=' if text[index..].starts_with("=>")
                && paren_depth == 0
                && bracket_depth == 0
                && brace_depth == 0 =>
            {
                if angle_depth == 0 {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn symbol_row(
    text_after_keyword: &str,
    kind: &str,
    signature: &str,
    line_number: usize,
) -> Option<SymbolRow> {
    let name = take_identifier(text_after_keyword);
    if name.is_empty() {
        return None;
    }
    Some(SymbolRow {
        kind: kind.to_string(),
        line: line_number,
        name,
        signature: signature.to_string(),
    })
}

fn method_symbol_from_line(line: &str, line_number: usize) -> Option<SymbolRow> {
    let mut search_from = 0;
    while let Some(relative_index) = line[search_from..].find('(') {
        let paren_index = search_from + relative_index;
        let Some((name_start, name)) = identifier_before_paren(line, paren_index) else {
            search_from = paren_index + 1;
            continue;
        };
        if !is_method_name(&name) || !is_method_candidate_start(line, name_start) {
            search_from = paren_index + 1;
            continue;
        }
        let Some(close_paren) = matching_delimiter(line, paren_index, '(', ')') else {
            search_from = paren_index + 1;
            continue;
        };
        let Some(open_brace) = method_body_brace_index(line, close_paren + 1) else {
            search_from = paren_index + 1;
            continue;
        };
        let signature_end = matching_delimiter(line, open_brace, '{', '}')
            .map(|index| index + 1)
            .unwrap_or(line.len());
        return Some(SymbolRow {
            kind: "method".to_string(),
            line: line_number,
            name,
            signature: line[name_start..signature_end].trim().to_string(),
        });
    }
    None
}

fn multiline_method_symbol_from_line(line: &str, line_number: usize) -> Option<SymbolRow> {
    if line.contains("=>") || !line.trim_end().ends_with('(') {
        return None;
    }
    let paren_index = line.find('(')?;
    let before_paren = line[..paren_index].trim_end();
    let before_generic = strip_trailing_generic_parameters(before_paren);
    let (name_start, name) = identifier_at_end(before_generic)?;
    if !is_method_name(&name) || !is_method_candidate_start(before_generic, name_start) {
        return None;
    }
    let prefix = before_generic[..name_start].trim();
    if prefix.is_empty() {
        return None;
    }
    Some(SymbolRow {
        kind: "method".to_string(),
        line: line_number,
        name,
        signature: line.trim().to_string(),
    })
}

fn strip_trailing_generic_parameters(text: &str) -> &str {
    let trimmed = text.trim_end();
    if !trimmed.ends_with('>') {
        return trimmed;
    }
    if let Some((index, '>')) = trimmed.char_indices().next_back() {
        if trimmed[..index].ends_with('=') {
            return trimmed;
        }
    }
    let mut depth = 0i32;
    for (index, ch) in trimmed.char_indices().rev() {
        if ch == '>' {
            if trimmed[..index].ends_with('=') {
                continue;
            }
            depth += 1;
        } else if ch == '<' {
            depth -= 1;
            if depth == 0 {
                return trimmed[..index].trim_end();
            }
        }
    }
    trimmed
}

fn identifier_at_end(text: &str) -> Option<(usize, String)> {
    let bytes = text.as_bytes();
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 {
        let ch = bytes[start - 1] as char;
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' {
            start -= 1;
        } else {
            break;
        }
    }
    if start == end {
        return None;
    }
    Some((start, text[start..end].to_string()))
}

fn identifier_before_paren(line: &str, paren_index: usize) -> Option<(usize, String)> {
    let bytes = line.as_bytes();
    let mut end = paren_index;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
    }
    let mut start = end;
    while start > 0 {
        let ch = bytes[start - 1] as char;
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '$' {
            start -= 1;
        } else {
            break;
        }
    }
    if start == end {
        return None;
    }
    Some((start, line[start..end].to_string()))
}

fn is_method_name(name: &str) -> bool {
    !name.is_empty()
        && !matches!(
            name,
            "if" | "for" | "while" | "switch" | "catch" | "function" | "return" | "constructor"
        )
}

fn variable_symbols_from_line(
    line: &str,
    line_number: usize,
    primary_symbol: Option<&SymbolRow>,
) -> Vec<SymbolRow> {
    let mut symbols = Vec::new();
    for (keyword_start, keyword) in variable_keyword_positions(line) {
        let after_keyword = &line[keyword_start + keyword.len()..];
        for name in variable_declaration_names(after_keyword) {
            if primary_symbol
                .map(|symbol| symbol.line == line_number && symbol.name == name)
                .unwrap_or(false)
                || symbols.iter().any(|symbol: &SymbolRow| symbol.name == name)
            {
                continue;
            }
            symbols.push(SymbolRow {
                kind: "variable".to_string(),
                line: line_number,
                name,
                signature: variable_declaration_signature(line, keyword_start),
            });
        }
    }
    if let Some(rest) = line.trim_start().strip_prefix(',') {
        for name in variable_declaration_continuation_names(rest) {
            if primary_symbol
                .map(|symbol| symbol.line == line_number && symbol.name == name)
                .unwrap_or(false)
                || symbols.iter().any(|symbol: &SymbolRow| symbol.name == name)
            {
                continue;
            }
            symbols.push(SymbolRow {
                kind: "variable".to_string(),
                line: line_number,
                name,
                signature: variable_declaration_continuation_signature(rest),
            });
        }
    }
    for name in catch_binding_names(line) {
        if primary_symbol
            .map(|symbol| symbol.line == line_number && symbol.name == name)
            .unwrap_or(false)
            || symbols.iter().any(|symbol| symbol.name == name)
        {
            continue;
        }
        symbols.push(SymbolRow {
            kind: "variable".to_string(),
            line: line_number,
            name,
            signature: catch_binding_signature(line),
        });
    }
    symbols
}

fn variable_keyword_positions(line: &str) -> Vec<(usize, &'static str)> {
    let mut positions = Vec::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for (index, ch) in line.char_indices() {
        if let Some(current_quote) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if line[index..].starts_with("//") {
            break;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            continue;
        }
        for keyword in ["const", "let", "var"] {
            if line[index..].starts_with(keyword)
                && is_identifier_boundary(line, index, index + keyword.len())
                && !previous_token_is_as(line, index)
            {
                let after_keyword = line[index + keyword.len()..].trim_start();
                if keyword == "const" && after_keyword.starts_with("enum ") {
                    continue;
                }
                positions.push((index, keyword));
            }
        }
    }
    positions
}

fn previous_token_is_as(line: &str, index: usize) -> bool {
    line[..index]
        .split_whitespace()
        .next_back()
        .map(|token| token == "as")
        .unwrap_or(false)
}

fn is_identifier_boundary(line: &str, start: usize, end: usize) -> bool {
    let before = line[..start].chars().next_back();
    let after = line[end..].chars().next();
    !before
        .map(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
        .unwrap_or(false)
        && !after
            .map(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '$')
            .unwrap_or(false)
}

fn variable_declaration_signature(line: &str, keyword_start: usize) -> String {
    line[keyword_start..]
        .split([';', ')', ','])
        .next()
        .unwrap_or(&line[keyword_start..])
        .trim()
        .to_string()
}

fn variable_declaration_continuation_signature(rest: &str) -> String {
    rest.split([';', ')', ','])
        .next()
        .unwrap_or(rest)
        .trim()
        .to_string()
}

fn variable_declaration_names(text_after_keyword: &str) -> Vec<String> {
    top_level_declaration_parts(text_after_keyword)
        .into_iter()
        .filter_map(|part| {
            let name = take_identifier(part.trim_start());
            if name.is_empty() {
                None
            } else {
                Some(name)
            }
        })
        .collect()
}

fn variable_declaration_continuation_names(text_after_comma: &str) -> Vec<String> {
    top_level_declaration_parts(text_after_comma)
        .into_iter()
        .filter_map(|part| {
            let trimmed = part.trim_start();
            let name = take_identifier(trimmed);
            if name.is_empty() {
                return None;
            }
            let suffix = trimmed[name.len()..].trim_start();
            if suffix.starts_with(':') {
                return None;
            }
            Some(name)
        })
        .collect()
}

fn top_level_declaration_parts(text: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut paren_depth = 0i32;
    let mut bracket_depth = 0i32;
    let mut brace_depth = 0i32;
    let mut angle_depth = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in text.chars() {
        if let Some(current_quote) = quote {
            current.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == current_quote {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'' | '`') {
            quote = Some(ch);
            current.push(ch);
            continue;
        }
        match ch {
            '(' => {
                paren_depth += 1;
                current.push(ch);
            }
            ')' => {
                if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 && angle_depth == 0 {
                    break;
                }
                paren_depth -= 1;
                current.push(ch);
            }
            '[' => {
                bracket_depth += 1;
                current.push(ch);
            }
            ']' => {
                bracket_depth -= 1;
                current.push(ch);
            }
            '{' => {
                brace_depth += 1;
                current.push(ch);
            }
            '}' => {
                brace_depth -= 1;
                current.push(ch);
            }
            '<' if paren_depth == 0 && bracket_depth == 0 && brace_depth == 0 => {
                angle_depth += 1;
                current.push(ch);
            }
            '>' if angle_depth > 0 => {
                angle_depth -= 1;
                current.push(ch);
            }
            ';' if paren_depth == 0
                && bracket_depth == 0
                && brace_depth == 0
                && angle_depth == 0 =>
            {
                break
            }
            ',' if paren_depth == 0
                && bracket_depth == 0
                && brace_depth == 0
                && angle_depth == 0 =>
            {
                parts.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        parts.push(current.trim().to_string());
    }
    parts
}

fn catch_binding_names(line: &str) -> Vec<String> {
    let mut names = Vec::new();
    let mut search_from = 0;
    while let Some(relative_index) = line[search_from..].find("catch") {
        let catch_index = search_from + relative_index;
        search_from = catch_index + "catch".len();
        if !is_identifier_boundary(line, catch_index, catch_index + "catch".len()) {
            continue;
        }
        if line[..catch_index]
            .chars()
            .next_back()
            .map(|ch| ch == '.')
            .unwrap_or(false)
        {
            continue;
        }
        let after_catch = line[search_from..].trim_start();
        let Some(after_paren) = after_catch.strip_prefix('(') else {
            continue;
        };
        let name = take_identifier(after_paren.trim_start());
        if !name.is_empty() {
            names.push(name);
        }
    }
    names
}

fn catch_binding_signature(line: &str) -> String {
    line.trim()
        .split('{')
        .next()
        .unwrap_or(line.trim())
        .trim()
        .to_string()
}

fn is_method_candidate_start(line: &str, name_start: usize) -> bool {
    let prefix = line[..name_start].trim();
    if prefix.is_empty() {
        return true;
    }
    if prefix
        .chars()
        .next_back()
        .map(|ch| matches!(ch, '{' | ',' | ';'))
        .unwrap_or(false)
    {
        return true;
    }
    prefix.split_whitespace().all(|part| {
        matches!(
            part,
            "async"
                | "public"
                | "private"
                | "protected"
                | "static"
                | "override"
                | "readonly"
                | "abstract"
        )
    })
}

fn method_body_brace_index(line: &str, start: usize) -> Option<usize> {
    let suffix = &line[start..];
    let brace_offset = suffix.find('{')?;
    let before_brace = suffix[..brace_offset].trim();
    if !(before_brace.is_empty() || before_brace.starts_with(':')) {
        return None;
    }
    if before_brace.contains("=>") || before_brace.contains('?') {
        return None;
    }
    Some(start + brace_offset)
}

fn matching_delimiter(line: &str, open_index: usize, open: char, close: char) -> Option<usize> {
    let mut depth = 0i32;
    for (offset, ch) in line[open_index..].char_indices() {
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
            if depth == 0 {
                return Some(open_index + offset);
            }
        }
    }
    None
}

fn import_from_line(line: &str, line_number: usize) -> Option<ImportRow> {
    if line.starts_with("import ") {
        let module = string_after_marker(line, " from ").or_else(|| first_string_literal(line))?;
        let imported = import_binding(line);
        return Some(ImportRow {
            edge_kind: "import".to_string(),
            imported,
            line: line_number,
            raw: line.to_string(),
            to_ref: module,
        });
    }
    if line.starts_with("export ") && line.contains(" from ") {
        let module = string_after_marker(line, " from ")?;
        let exported = line
            .split(" from ")
            .next()
            .unwrap_or("")
            .trim_start_matches("export")
            .trim()
            .strip_prefix("type ")
            .unwrap_or_else(|| {
                line.split(" from ")
                    .next()
                    .unwrap_or("")
                    .trim_start_matches("export")
                    .trim()
            })
            .trim()
            .to_string();
        return Some(ImportRow {
            edge_kind: "export".to_string(),
            imported: exported,
            line: line_number,
            raw: line.to_string(),
            to_ref: module,
        });
    }
    if line.contains("require(") {
        let module = first_string_literal(line.split("require(").nth(1).unwrap_or(""))?;
        return Some(ImportRow {
            edge_kind: "import".to_string(),
            imported: String::new(),
            line: line_number,
            raw: format!("require({})", javascript_quote(&module)),
            to_ref: module,
        });
    }
    None
}

fn starts_multiline_import_declaration(line: &str) -> bool {
    if line.contains(" from ") || first_string_literal(line).is_some() {
        return false;
    }
    if let Some(rest) = line.strip_prefix("import ") {
        let rest = rest.strip_prefix("type ").unwrap_or(rest).trim();
        return rest.contains('{') || rest.ends_with(',');
    }
    if let Some(rest) = line.strip_prefix("export ") {
        let rest = rest.strip_prefix("type ").unwrap_or(rest).trim();
        return rest.starts_with('{');
    }
    false
}

fn import_declaration_complete(line: &str) -> bool {
    line.contains(" from ") && first_string_literal(line).is_some()
}

fn decorator_route_from_line(line: &str, line_number: usize) -> Option<DecoratorRoute> {
    let rest = line.strip_prefix('@')?;
    let callee = take_identifier(rest);
    let method = callee.to_lowercase();
    if !["all", "delete", "get", "patch", "post", "put"].contains(&method.as_str()) {
        return None;
    }
    Some(DecoratorRoute {
        callee,
        line: line_number,
        method: method.to_uppercase(),
        route: first_string_literal(rest).unwrap_or_else(|| "/".to_string()),
    })
}

fn import_binding(line: &str) -> String {
    let before_from = line
        .split(" from ")
        .next()
        .unwrap_or(line)
        .trim_start_matches("import")
        .trim();
    let before_from = before_from
        .strip_prefix("type ")
        .unwrap_or(before_from)
        .trim();
    if before_from.starts_with(['"', '\'']) {
        return String::new();
    }
    let mut names = Vec::new();
    if before_from.starts_with('{') && before_from.ends_with('}') {
        names.extend(named_import_bindings(before_from));
    } else if let Some((default_import, named_imports)) = before_from.split_once(',') {
        let default_import = default_import.trim();
        if !default_import.is_empty() {
            names.push(default_import.to_string());
        }
        names.extend(named_import_bindings(named_imports));
    } else if !before_from.is_empty() {
        names.push(before_from.trim_end_matches(';').to_string());
    }
    names.join(", ")
}

fn named_import_bindings(text: &str) -> Vec<String> {
    let trimmed = text.trim();
    let inner = trimmed.trim_matches(|ch| ch == '{' || ch == '}');
    if inner.trim().is_empty() && trimmed.starts_with('{') && trimmed.ends_with('}') {
        return vec!["{}".to_string()];
    }
    inner
        .split(',')
        .map(|part| {
            part.trim()
                .strip_prefix("type ")
                .unwrap_or(part.trim())
                .trim()
        })
        .map(|part| part.split(" as ").last().unwrap_or("").trim())
        .filter(|part| !part.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn route_from_line(line: &str, line_number: usize) -> Option<RouteRow> {
    let (_, after_receiver) = route_call_parts(line)?;
    let method = after_receiver.split('(').next()?.to_lowercase();
    if !["all", "delete", "get", "patch", "post", "put"].contains(&method.as_str()) {
        return None;
    }
    let args = after_receiver.split_once('(')?.1;
    let arguments = top_level_call_arguments(args);
    let route = string_literal_argument(arguments.first()?)?;
    let handler = arguments
        .get(1)
        .map(|argument| one_line_unbounded(argument.trim()))
        .unwrap_or_default();
    Some(RouteRow {
        handler,
        line: line_number,
        method: method.to_uppercase(),
        route,
    })
}

fn route_call_parts(line: &str) -> Option<(&'static str, &str)> {
    for receiver in ["app", "router", "server"] {
        let mut search_from = 0usize;
        while let Some(relative_start) = line[search_from..].find(receiver) {
            let start = search_from + relative_start;
            let after_receiver = start + receiver.len();
            let before = line[..start].chars().next_back();
            let after = line[after_receiver..].chars().next();
            let before_is_boundary = before.is_none_or(|ch| {
                !ch.is_ascii_alphanumeric() && ch != '_' && ch != '$' && ch != '.'
            });
            if before_is_boundary && after == Some('.') {
                return Some((receiver, &line[after_receiver + 1..]));
            }
            search_from = after_receiver;
        }
    }
    None
}

fn top_level_call_arguments(args: &str) -> Vec<String> {
    let mut arguments = Vec::new();
    let mut current = String::new();
    let mut depth = 0i32;
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in args.chars() {
        if let Some(quote_char) = quote {
            current.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == quote_char {
                quote = None;
            }
            continue;
        }
        match ch {
            '"' | '\'' | '`' => {
                quote = Some(ch);
                current.push(ch);
            }
            '(' | '[' | '{' => {
                depth += 1;
                current.push(ch);
            }
            ')' if depth == 0 => {
                if !current.trim().is_empty() || !arguments.is_empty() {
                    arguments.push(current.trim().to_string());
                }
                break;
            }
            ')' | ']' | '}' => {
                if depth > 0 {
                    depth -= 1;
                }
                current.push(ch);
            }
            ',' if depth == 0 => {
                arguments.push(current.trim().to_string());
                current.clear();
            }
            _ => current.push(ch),
        }
    }
    if !current.trim().is_empty() && quote.is_none() {
        let trimmed = current.trim().trim_end_matches(';').trim();
        if arguments.last().map(|argument| argument.as_str()) != Some(trimmed) {
            arguments.push(trimmed.to_string());
        }
    }
    arguments
}

fn string_literal_argument(argument: &str) -> Option<String> {
    let trimmed = argument.trim();
    let quote = trimmed.chars().next()?;
    if quote != '"' && quote != '\'' && quote != '`' {
        return None;
    }
    if quote == '`' && trimmed.contains("${") {
        return None;
    }
    let mut value = String::new();
    let mut escaped = false;
    let mut consumed_bytes = quote.len_utf8();
    for ch in trimmed[quote.len_utf8()..].chars() {
        consumed_bytes += ch.len_utf8();
        if escaped {
            match ch {
                'n' => value.push('\n'),
                'r' => value.push('\r'),
                't' => value.push('\t'),
                'b' => value.push('\u{0008}'),
                'f' => value.push('\u{000c}'),
                'v' => value.push('\u{000b}'),
                '0' => value.push('\0'),
                _ => value.push(ch),
            }
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == quote {
            return if trimmed[consumed_bytes..].trim().is_empty() {
                Some(value)
            } else {
                None
            };
        }
        value.push(ch);
    }
    None
}

fn take_identifier(text: &str) -> String {
    text.chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '$')
        .collect()
}

fn string_after_marker(line: &str, marker: &str) -> Option<String> {
    first_string_literal(line.split_once(marker).map(|(_, rest)| rest).unwrap_or(""))
}

fn first_string_literal(text: &str) -> Option<String> {
    let quote_index = text.find(['"', '\''])?;
    let quote = text.as_bytes()[quote_index] as char;
    let rest = &text[quote_index + 1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn one_line(text: &str) -> String {
    let mut output = String::with_capacity(text.len().min(240));
    let mut pending_space = false;
    let mut chars = 0usize;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if chars > 0 {
                pending_space = true;
            }
            continue;
        }
        if pending_space {
            if chars >= 240 {
                break;
            }
            output.push(' ');
            chars += 1;
            pending_space = false;
        }
        if chars >= 240 {
            break;
        }
        output.push(ch);
        chars += 1;
    }
    output
}

fn one_line_unbounded(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut pending_space = false;
    for ch in text.chars() {
        if ch.is_whitespace() {
            if !output.is_empty() {
                pending_space = true;
            }
            continue;
        }
        if pending_space {
            output.push(' ');
            pending_space = false;
        }
        output.push(ch);
    }
    output
}

fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

fn stable_fts_rowid(parts: &[&str]) -> i64 {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part.as_bytes());
        hasher.update([0]);
    }
    let digest = hasher.finalize();
    let mut value = 0_i64;
    for byte in &digest[..6] {
        value = value * 256 + i64::from(*byte);
    }
    value + 1
}

fn file_fts_rowid(file_path: &str) -> i64 {
    stable_fts_rowid(&["file", file_path])
}

fn timestamp_placeholder() -> String {
    "native-rust-helper".to_string()
}

fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn javascript_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_extraction_handles_unicode_regex_receivers() {
        let line = r#"const hasCanonicalSignal = /\b(prd|brief|spec|requirements|roadmap|architecture|api|data model|policy|scope|goal|goals|user|users|persona|scenario|success)\b|정본|요구사항|기획|범위|목표|사용자|시나리오|성공/.test(haystack);"#;
        let calls = calls_from_line(line, None, false);
        assert!(calls.iter().any(|call| call.target.ends_with(".test")));
    }

    #[test]
    fn call_extraction_keeps_chained_call_receivers() {
        let line = "expect(page.getByTestId('batch-variation-panel')).toBeVisible();";
        let calls = calls_from_line(line, None, false);
        assert!(calls
            .iter()
            .any(|call| call.target
                == "expect(page.getByTestId('batch-variation-panel')).toBeVisible"));
        let awaited = calls_from_line("await expect(page).toHaveURL(/\\/login$/);", None, false);
        assert!(awaited
            .iter()
            .any(|call| call.target == "expect(page).toHaveURL"));
        assert!(!awaited
            .iter()
            .any(|call| call.target == "await expect(page).toHaveURL"));
        let generic = calls_from_line(
            "const [value, setValue] = useState<string | null>(null);",
            None,
            false,
        );
        assert!(generic.iter().any(|call| call.target == "useState"));
        let typed_arrow = "const baseProject = (overrides: Partial<Project> = {}): Project => ({";
        let typed_arrow_symbol = symbol_from_line(typed_arrow, 1);
        assert!(
            !calls_from_line(typed_arrow, typed_arrow_symbol.as_ref(), false)
                .iter()
                .any(|call| call.target == "Partial")
        );
        let generic_chain = calls_from_line(
            "vi .fn<(v: BatchVariation) => Promise<{ ok: boolean; code?: string }>>() .mockResolvedValue({ ok: true });",
            None,
            false,
        );
        assert!(generic_chain.iter().any(|call| call.target == "vi .fn"));
        assert!(generic_chain.iter().any(|call| call.target
            == "vi .fn<(v: BatchVariation) => Promise<{ ok: boolean; code?: string }>>() .mockResolvedValue"));
        let new_chain = calls_from_line(
            "const stamp = new Date('2026-05-18').toISOString();",
            None,
            false,
        );
        assert!(new_chain
            .iter()
            .any(|call| call.target == "new Date('2026-05-18').toISOString"));
        let higher_order = calls_from_line(
            "it.each(SUPPORTED_LOCALES)('locale=%s', async (locale) => {});",
            None,
            false,
        );
        assert!(higher_order.iter().any(|call| call.target == "it.each"));
        assert!(higher_order
            .iter()
            .any(|call| call.target == "it.each(SUPPORTED_LOCALES)"));
        let regex_flags =
            calls_from_line("if (/^oklch\\(/i.test(trimmed)) return raw;", None, false);
        assert!(regex_flags
            .iter()
            .any(|call| call.target == "/^oklch\\(/i.test"));
        assert!(!regex_flags.iter().any(|call| call.target == "i.test"));
        let regex_quantifier = calls_from_line("return /^#[0-9a-f]{8}$/.test(hex);", None, false);
        assert!(regex_quantifier
            .iter()
            .any(|call| call.target == "/^#[0-9a-f]{8}$/.test"));
        assert!(!regex_quantifier
            .iter()
            .any(|call| call.target == "8}$/.test"));
        let regex_after_and = calls_from_line(
            "const blue = tokens.filter((t) => t.name.startsWith('blue-') && /^blue-\\d{3}$/.test(t.name));",
            None,
            false,
        );
        assert!(regex_after_and
            .iter()
            .any(|call| call.target == "/^blue-\\d{3}$/.test"));
        assert!(!regex_after_and
            .iter()
            .any(|call| call.target == "3}$/.test"));
        let regex_after_arrow = calls_from_line(
            "const bluePalette = tokens.filter((t) => /^blue-\\d{3}$/.test(t.name));",
            None,
            false,
        );
        assert!(regex_after_arrow
            .iter()
            .any(|call| call.target == "/^blue-\\d{3}$/.test"));
        assert!(calls_from_line(
            "const DIM_VALUE = /^(-?\\d*\\.?\\d+)(px|rem|em)$/;",
            None,
            false
        )
        .is_empty());
        let spread = calls_from_line(
            "...fillRow('basic'), ...Object.keys(input.components)",
            None,
            false,
        );
        assert!(spread.iter().any(|call| call.target == "fillRow"));
        assert!(spread.iter().any(|call| call.target == "Object.keys"));
        assert!(calls_from_line(
            "...(input.name !== undefined && { name: input.name })",
            None,
            false
        )
        .is_empty());
    }

    #[test]
    fn call_extraction_keeps_spaced_multiline_chain_receivers() {
        let expression = "client .from('projects') .select('id') .eq('user_id', user.id) .single()";
        let calls = top_level_property_calls_from_expression(expression);
        assert!(calls.iter().any(|call| call.target == "client .from"));
        assert!(calls
            .iter()
            .any(|call| call.target == "client .from('projects') .select"));
        assert!(calls
            .iter()
            .any(|call| call.target == "client .from('projects') .select('id') .eq"));
        assert!(calls.iter().any(|call| call.target
            == "client .from('projects') .select('id') .eq('user_id', user.id) .single"));
    }

    #[test]
    fn call_extraction_skips_dangling_multiline_chain_suffixes() {
        assert!(calls_from_line(").toContainText('ok');", None, false).is_empty());
        let expression = "expect( target, `message`, ) .toContainText('ok')";
        let calls = top_level_property_calls_from_expression(expression);
        assert_eq!(
            calls.last().map(|call| call.target.as_str()),
            Some("expect( target, `message`, ) .toContainText")
        );
    }

    #[test]
    fn call_extraction_skips_comments_strings_and_async_keywords() {
        assert!(calls_from_line("// W1 (A27)", None, false).is_empty());
        assert!(calls_from_line(
            "const css = `color: var(--x); filter: blur(1px);`;",
            None,
            false,
        )
        .is_empty());
        let calls = calls_from_line(
            "test('x', async ({ page }) => page.goto('/'));",
            None,
            false,
        );
        assert!(calls.iter().any(|call| call.target == "test"));
        assert!(calls.iter().any(|call| call.target == "page.goto"));
        assert!(!calls.iter().any(|call| call.target == "async"));
        let describe_calls = calls_from_line("describe('.get()', function(){", None, false);
        assert!(describe_calls.iter().any(|call| call.target == "describe"));
        assert!(!describe_calls.iter().any(|call| call.target == "'.get"));
        assert!(calls_from_line("}).join('')", None, false).is_empty());
        let negated = calls_from_line("if (!fs.statSync(file).isDirectory()) return", None, false);
        assert!(negated.iter().any(|call| call.target == "fs.statSync"));
        assert!(negated
            .iter()
            .any(|call| call.target == "fs.statSync(file).isDirectory"));
        assert!(!negated
            .iter()
            .any(|call| call.target == "!fs.statSync(file).isDirectory"));
    }

    #[test]
    fn call_extraction_skips_type_member_signatures() {
        assert!(calls_from_line(
            "findById(id: string): Promise<Project | null>;",
            None,
            false
        )
        .is_empty());
        assert!(calls_from_line(
            "update(id: string, data: Partial<Pick<Project, 'name'>>): Promise<Project>;",
            None,
            false,
        )
        .is_empty());
        let calls = calls_from_line("repo.findById(id);", None, false);
        assert!(calls.iter().any(|call| call.target == "repo.findById"));
    }

    #[test]
    fn call_extraction_normalizes_returned_chains_and_void_expressions() {
        let returned = calls_from_line("return (data ?? []).map(this.toEntity);", None, false);
        assert!(returned.iter().any(|call| {
            call.target == "(data ?? []).map" && call.evidence == "(data ?? []).map(this.toEntity)"
        }));
        assert!(!returned
            .iter()
            .any(|call| call.target == "return (data ?? []).map"));
        assert!(!calls_from_line("void (async () => {", None, false)
            .iter()
            .any(|call| call.target == "void"));
    }

    #[test]
    fn call_extraction_keeps_template_expression_calls() {
        let calls = calls_from_line(
            "log.push(`size: ${formatBytes(result.total)} / ${Math.max(1, limit)}`);",
            None,
            false,
        );
        assert!(calls.iter().any(|call| call.target == "log.push"));
        assert!(calls.iter().any(|call| call.target == "formatBytes"));
        assert!(calls.iter().any(|call| call.target == "Math.max"));
        assert!(calls_from_line("const text = `formatBytes(value)`;", None, false).is_empty());
    }

    #[test]
    fn extraction_keeps_multiline_template_expression_calls() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/render.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "function render(value: string): string {\n  return `<section>\n    <h1>${escapeHtml(`task: ${value}`)}</h1>\n    <p>${formatMetricValue('a', 1)}</p>\n  </section>`;\n}\n",
        );
        assert!(extracted.edges.iter().any(|row| row.source_kind == "symbol"
            && row.source == "render"
            && row.line == 3
            && row.target == "escapeHtml"));
        assert!(extracted.edges.iter().any(|row| row.source_kind == "symbol"
            && row.source == "render"
            && row.line == 4
            && row.target == "formatMetricValue"));
    }

    #[test]
    fn extraction_keeps_bare_multiline_call_chains() {
        let file = ManifestFile {
            language: "javascript".to_string(),
            mtime_ms: 0.0,
            path: "test/acceptance/auth.js".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "request(app)\n  .get('/login')\n  .set('Cookie', getCookie(res))\n  .expect(200, done)\nnext()\n",
        );
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call"
                && row.line == 1
                && row.source_kind == "file"
                && row.source == "test/acceptance/auth.js"
                && row.target == "request"
        }));
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call" && row.line == 1 && row.target == "request(app) .get"
        }));
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call" && row.line == 1 && row.target == "request(app) .get('/login') .set"
        }));
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call"
                && row.line == 1
                && row.target
                    == "request(app) .get('/login') .set('Cookie', getCookie(res)) .expect"
        }));
    }

    #[test]
    fn extraction_keeps_bare_multiline_call_chains_inside_callbacks() {
        let file = ManifestFile {
            language: "javascript".to_string(),
            mtime_ms: 0.0,
            path: "test/acceptance/auth.js".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "var app = require('../../examples/auth')\nvar request = require('supertest')\n\nfunction getCookie(res) {\n  return res.headers['set-cookie'][0].split(';')[0];\n}\n\ndescribe('auth', function(){\n  describe('GET /',function(){\n    it('should redirect to /login', function(done){\n      request(app)\n      .get('/')\n      .expect('Location', '/login')\n      .expect(302, done)\n    })\n  })\n",
        );
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call" && row.line == 11 && row.target == "request(app) .get"
        }));
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call" && row.line == 11 && row.target == "request(app) .get('/') .expect"
        }));
        assert!(extracted.edges.iter().any(|row| {
            row.kind == "call"
                && row.line == 11
                && row.target == "request(app) .get('/') .expect('Location', '/login') .expect"
        }));
    }

    #[test]
    fn extraction_deduplicates_multiline_property_call_start() {
        let file = ManifestFile {
            language: "javascript".to_string(),
            mtime_ms: 0.0,
            path: "src/highlight.js".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "window.highlight = function (code, language) {\n  return highlighter.codeToHtml(code, {\n    lang: language,\n    theme: 'light',\n  });\n}\n",
        );
        let duplicate_count = extracted
            .edges
            .iter()
            .filter(|row| row.kind == "call" && row.target == "highlighter.codeToHtml")
            .count();
        assert_eq!(duplicate_count, 1);
    }

    #[test]
    fn extraction_keeps_multiline_function_context_for_calls() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/functions.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "export function checkBundleSizeCli(\n  input: CheckInput,\n): CheckResult {\n  const log: string[] = [];\n  log.push('ok');\n  return { log };\n}\n\nconst handleSubmit = async (\n  event: Event,\n): Promise<void> => {\n  event.preventDefault();\n};\n",
        );
        assert!(extracted.edges.iter().any(|row| row.source_kind == "symbol"
            && row.source == "checkBundleSizeCli"
            && row.target == "log.push"));
        assert!(extracted.edges.iter().any(|row| row.source_kind == "symbol"
            && row.source == "handleSubmit"
            && row.target == "event.preventDefault"));
    }

    #[test]
    fn extraction_ignores_string_braces_when_closing_contexts() {
        assert_eq!(brace_delta("const dollarIdx = tpl.indexOf('${');"), 0);
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/context.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "function extractStaticPrefixes(content: string): string[] {\n  const dollarIdx = content.indexOf('${');\n  if (dollarIdx === -1) return [];\n  return [];\n}\ndescribe('gate', () => {\n  expect(1).toBe(1);\n});\n",
        );
        assert!(extracted
            .edges
            .iter()
            .any(|row| row.source_kind == "file" && row.line == 6 && row.target == "describe"));
        assert!(extracted.edges.iter().any(|row| row.source_kind == "file"
            && row.line == 7
            && row.target == "expect(1).toBe"));
        assert!(!extracted.edges.iter().any(|row| {
            row.source == "extractStaticPrefixes"
                && (row.target == "describe" || row.target == "expect(1).toBe")
        }));
    }

    #[test]
    fn extraction_keeps_spread_calls_inside_multiline_initializers() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/spread.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "export function mergeFlatRecord(\n  base: Record<string, unknown>,\n  local: Record<string, unknown>,\n): void {\n  const keys = new Set<string>([\n    ...Object.keys(base),\n    ...Object.keys(local),\n  ]);\n  console.log(keys);\n}\n",
        );
        assert!(extracted.edges.iter().any(|row| row.source_kind == "symbol"
            && row.source == "mergeFlatRecord"
            && row.target == "Object.keys"
            && row.line == 6));
        assert!(extracted.edges.iter().any(|row| row.source_kind == "symbol"
            && row.source == "mergeFlatRecord"
            && row.target == "Object.keys"
            && row.line == 7));
    }

    #[test]
    fn extraction_does_not_duplicate_arrow_callback_calls_on_parent_line() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/thunk.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "export const deleteProject = createAsyncThunk('project/delete', (id: string) =>\n  repo.delete(id).then(() => id),\n);\n",
        );
        assert!(extracted
            .edges
            .iter()
            .any(|row| row.line == 1 && row.target == "createAsyncThunk"));
        assert!(extracted
            .edges
            .iter()
            .any(|row| row.line == 2 && row.target == "repo.delete"));
        assert!(extracted
            .edges
            .iter()
            .any(|row| row.line == 2 && row.target == "repo.delete(id).then"));
        assert!(!extracted
            .edges
            .iter()
            .any(|row| row.line == 1 && row.target.starts_with("repo.delete")));
    }

    #[test]
    fn import_binding_matches_typescript_import_clause_names() {
        assert_eq!(
            import_binding(
                "import { createClient, type SupabaseClient } from '@supabase/supabase-js';"
            ),
            "createClient, SupabaseClient"
        );
        assert_eq!(
            import_binding(
                "import projectReducer, { hydrateActiveProject } from './slices/projectSlice';"
            ),
            "projectReducer, hydrateActiveProject"
        );
        assert_eq!(
            import_binding("import type { TypedUseSelectorHook } from 'react-redux';"),
            "TypedUseSelectorHook"
        );
        assert_eq!(import_binding("import './setup';"), "");
    }

    #[test]
    fn variable_symbol_kind_uses_top_level_arrow_only() {
        let nested_arrow = symbol_from_line(
            "const rootHTML = await page.evaluate(() => document.body);",
            1,
        )
        .expect("symbol from nested-arrow initializer");
        assert_eq!(nested_arrow.kind, "variable");

        let top_level_arrow = symbol_from_line("const loadRoot = async () => document.body;", 1)
            .expect("symbol from top-level arrow initializer");
        assert_eq!(top_level_arrow.kind, "function");

        let generic_arrow_type = symbol_from_line(
            "const onSetChange = vi.fn<(set: BatchVariationSet) => void>();",
            1,
        )
        .expect("symbol from generic function type argument");
        assert_eq!(generic_arrow_type.kind, "variable");

        let multiline_arrow = symbol_from_line("const handleSubmit = async (", 1)
            .expect("symbol from multiline arrow initializer");
        assert_eq!(multiline_arrow.kind, "function");

        let parenthesized_jsx = symbol_from_line("const dialogTree = (", 1)
            .expect("symbol from parenthesized initializer");
        assert_eq!(parenthesized_jsx.kind, "variable");

        let const_enum =
            symbol_from_line("const enum PreprocessLang {", 1).expect("symbol from const enum");
        assert_eq!(const_enum.kind, "enum");
        assert_eq!(const_enum.name, "PreprocessLang");
        assert!(
            variable_symbols_from_line("const enum PreprocessLang {", 1, Some(&const_enum))
                .is_empty()
        );
    }

    #[test]
    fn extraction_promotes_multiline_arrow_initializers_to_functions() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/multiline-arrows.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "const getCssAssetDirname = (\n  cssAssetName: string,\n) => {\n  path.join(cssAssetName);\n};\n\nconst createExecHandlers = <T extends (...args: any) => any>(\n  handler: T,\n) => {\n  handler();\n};\n\nconst setResolveOptions = <\n  T extends keyof ResolveOptions,\n>(\n  key: T,\n) => {\n  setOption(key);\n};\n\nconst sirvOptions = ({\n  config,\n}: {\n  config: ResolvedConfig\n}): Options => {\n  return { dev: true }\n};\n\nconst UrlRewritePostcssPlugin: PostCSS.PluginCreator<{\n  resolver: CssUrlResolver\n}> = (opts) => {\n  return opts.resolver\n};\n\nconst urlEmitTasks: Array<{\n  cssAssetName: string\n  originalFileName: string\n}> = []\n\nconst dialogTree = (\n  <Dialog />\n);\nconst code = (\n  await transformWithEsbuild(input)\n).code\nexpect(code).toBe('ok')\nconst after = 1;\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "getCssAssetDirname" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "createExecHandlers" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "setResolveOptions" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "sirvOptions" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "UrlRewritePostcssPlugin" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "urlEmitTasks" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "dialogTree" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "code" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "after" && row.kind == "variable"));
        assert!(extracted.edges.iter().any(|row| {
            row.source_kind == "symbol"
                && row.source == "getCssAssetDirname"
                && row.target == "path.join"
        }));
        assert!(extracted
            .edges
            .iter()
            .any(|row| row.source_kind == "file" && row.target == "expect(code).toBe"));
    }

    #[test]
    fn extraction_skips_template_literal_code_examples() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/templates.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "const examples = [{\n  code: `export interface ButtonProps {\nexport default function Button() {\n  return null;\n}\n`,\n}];\n",
        );
        assert!(!extracted
            .symbols
            .iter()
            .any(|row| row.name == "Button" || row.name == "ButtonProps"));
    }

    #[test]
    fn extraction_keeps_scanning_after_pragma_template_initializers() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/pragma-template.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "const eslintTypeAwareConfig =\n  /* js */ `export default defineConfig([\n  { files: ['**/*.{ts,tsx}'] },\n])\n`\nconst eslintReactConfig =\n  /* js */ `// eslint.config.js\nexport default []\n`\nfunction afterTemplate() {}\nconst after = 1;\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "eslintTypeAwareConfig" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "eslintReactConfig" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "afterTemplate" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "after" && row.kind == "variable"));
    }

    #[test]
    fn extraction_closes_multiline_template_expressions_before_string_quotes() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/css-template.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "function plugin() {\n  return {\n    handler(id) {\n      throw new Error(\n        `?url is not supported ${JSON.stringify(\n          id,\n        )})`,\n      )\n      return (\n        `import ${JSON.stringify(id)};` +\n        `export default \"__VITE_CSS_URL__${Buffer.from(id).toString(\n          'hex',\n        )}__\"`\n      )\n    },\n    transform(raw, id) {\n      const resolveUrl = (url: string, importer?: string) => idResolver(url, importer)\n      return resolveUrl(raw, id)\n    },\n  }\n}\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "handler" && row.kind == "method"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "transform" && row.kind == "method"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "resolveUrl" && row.kind == "function"));
    }

    #[test]
    fn extraction_skips_multiline_template_literals_after_declaration_line() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/template-fixture.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "const existing = `import React from 'react';\nexport const oldTokens = { primary: '#000' };\nfunction userFn() {}\n`;\nconst result = applyBlockModeSync({ existingSource: existing });\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "existing" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "result" && row.kind == "variable"));
        assert!(!extracted
            .symbols
            .iter()
            .any(|row| row.name == "oldTokens" || row.name == "userFn"));
        assert!(!extracted.imports.iter().any(|row| row.to_ref == "react"));
    }

    #[test]
    fn extraction_closes_template_literals_on_comment_prefixed_lines() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/apply-block-mode.test.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "const existing = `import customLib from 'custom';\n\n/* SLINUP-MANAGED-BEGIN hash=${HASH_OLD} */\nmanaged\n/* SLINUP-MANAGED-END */`;\nconst r = applyBlockModeSync({\n  existingSource: existing,\n});\nconst other = `/* SLINUP-MANAGED-BEGIN hash=${HASH_OLD} */\nmanaged\n/* SLINUP-MANAGED-END */\n\nexport default function MyComponent() {\n  return null;\n}`;\nexpect(r.nextSource).toContain('ok');\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "existing" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "r" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "other" && row.kind == "variable"));
        assert!(!extracted
            .symbols
            .iter()
            .any(|row| row.name == "MyComponent"));
        assert!(extracted.edges.iter().any(|row| {
            row.line == 16
                && row.source_kind == "file"
                && row.target == "expect(r.nextSource).toContain"
        }));
    }

    #[test]
    fn extraction_keeps_scanning_after_quoted_template_literal_contents() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/quoted-template.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "function format(value: string): string {\n  return `\"${value.replace(/\"/g, '\\\\\"')}\"`;\n}\nconst afterTemplate = 1;\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "afterTemplate" && row.kind == "variable"));
    }

    #[test]
    fn extraction_handles_exported_multiline_templates_and_regex_backticks() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/prompt.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "export const SYSTEM_PROMPT = `Use \\`react\\` only.\nfunction ignoredInsidePrompt() {}\n`;\nfunction afterPrompt() {\n  const re = /\\bt\\(`([^`]*)`/g;\n  let match: RegExpExecArray | null;\n  return re.exec('');\n}\nconst afterRegex = 1;\n",
        );
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "SYSTEM_PROMPT" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "afterPrompt" && row.kind == "function"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "match" && row.kind == "variable"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.name == "afterRegex" && row.kind == "variable"));
        assert!(!extracted
            .symbols
            .iter()
            .any(|row| row.name == "ignoredInsidePrompt"));
    }

    #[test]
    fn method_symbol_detection_ignores_chained_calls_with_regex_braces() {
        assert!(symbol_from_line(
            "expect(srcdoc).not.toMatch(/\\.bg-sentinel-skip-backfill\\s*\\{/);",
            1,
        )
        .is_none());
        assert!(symbol_from_line(
            "constructor(private readonly repo: ProjectRepository) {}",
            1,
        )
        .is_none());
        assert!(
            symbol_from_line("async execute(projectId: string): Promise<Project[]> {", 1,)
                .is_some_and(|row| row.kind == "method" && row.name == "execute")
        );
        assert!(
            symbol_from_line("private toEntity(row: Record<string, unknown>): Token {", 1,)
                .is_some_and(|row| row.kind == "method" && row.name == "toEntity")
        );
        assert!(symbol_from_line("async generate<TOutput = unknown>(", 1,)
            .is_some_and(|row| row.kind == "method" && row.name == "generate"));
    }

    #[test]
    fn variable_symbol_detection_covers_for_and_catch_bindings() {
        let for_symbols = variable_symbols_from_line(
            "for (var s, i = 1, n = arguments.length; i < n; i++) for (const item of list) set.add(item);",
            7,
            None,
        );
        assert!(for_symbols
            .iter()
            .any(|row| row.name == "s" && row.line == 7));
        assert!(for_symbols
            .iter()
            .any(|row| row.name == "i" && row.line == 7));
        assert!(for_symbols
            .iter()
            .any(|row| row.name == "n" && row.line == 7));
        assert!(for_symbols
            .iter()
            .any(|row| row.name == "item" && row.line == 7));

        let continuation_symbols =
            variable_symbols_from_line("  , request = require('supertest')", 5, None);
        assert!(continuation_symbols
            .iter()
            .any(|row| row.name == "request" && row.line == 5));
        let continuation_symbols = variable_symbols_from_line("    , app = express();", 11, None);
        assert!(continuation_symbols
            .iter()
            .any(|row| row.name == "app" && row.line == 11));
        assert!(variable_symbols_from_line("  , loki: [repos[1]]", 67, None).is_empty());

        let catch_symbols = variable_symbols_from_line("} catch (cause) {", 9, None);
        assert_eq!(catch_symbols.len(), 1);
        assert_eq!(catch_symbols[0].name, "cause");
        assert!(variable_symbols_from_line(
            "await action().catch(async () => recover());",
            10,
            None,
        )
        .is_empty());
        assert!(variable_symbols_from_line(
            "} as const satisfies Record<string, string>;",
            11,
            None,
        )
        .is_empty());

        let primary = SymbolRow {
            kind: "variable".to_string(),
            line: 12,
            name: "map".to_string(),
            signature: "const map: Record<string, number> = {};".to_string(),
        };
        assert!(variable_symbols_from_line(
            "const map: Record<string, number> = {};",
            12,
            Some(&primary),
        )
        .is_empty());
    }

    #[test]
    fn extraction_collects_multiline_import_declarations() {
        let file = ManifestFile {
            language: "typescript".to_string(),
            mtime_ms: 0.0,
            path: "src/app.ts".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "import {\n  createClient,\n  type SupabaseClient,\n} from '@supabase/supabase-js';\nexport type {\n  TimelineEvent,\n} from '@/timeline';\nimport {\n  Aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa,\n  Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb,\n  Cccccccccccccccccccccccccccccc,\n  Dddddddddddddddddddddddddddddd,\n  Eeeeeeeeeeeeeeeeeeeeeeeeeeeeee,\n  Ffffffffffffffffffffffffffffff,\n  Gggggggggggggggggggggggggggg,\n  Hhhhhhhhhhhhhhhhhhhhhhhhhhhhhh,\n  Iiiiiiiiiiiiiiiiiiiiiiiiiiiiii,\n  Jjjjjjjjjjjjjjjjjjjjjjjjjjjj,\n} from './long-import';\n",
        );
        assert!(extracted.imports.iter().any(|row| {
            row.to_ref == "@supabase/supabase-js"
                && row.imported == "createClient, SupabaseClient"
                && row.line == 1
        }));
        assert!(extracted
            .imports
            .iter()
            .any(|row| row.to_ref == "@/timeline"
                && row.imported == "{ TimelineEvent, }"
                && row.line == 5));
        assert!(extracted.imports.iter().any(|row| {
            row.to_ref == "./long-import"
                && row.imported.contains("Jjjjjjjjjjjjjjjjjjjjjjjjjjjj")
                && row.line == 8
        }));
    }

    #[test]
    fn route_handler_keeps_function_expression_arguments() {
        let route = route_from_line(
            "app.get('/', function(req, res){ res.send(users.map(function(user){ return user.name; }).join('')); })",
            7,
        )
        .expect("route from function expression");
        assert_eq!(route.method, "GET");
        assert_eq!(route.route, "/");
        assert_eq!(
            route.handler,
            "function(req, res){ res.send(users.map(function(user){ return user.name; }).join('')); }"
        );
    }

    #[test]
    fn route_handler_keeps_nested_call_argument() {
        let route = route_from_line("app.get('/users', format('./users'))", 40)
            .expect("route from nested call argument");
        assert_eq!(route.method, "GET");
        assert_eq!(route.route, "/users");
        assert_eq!(route.handler, "format('./users')");
    }

    #[test]
    fn route_detection_finds_nested_receiver_calls() {
        let route = route_from_line("assert.equal(app.get('etag fn'), fn)", 51)
            .expect("nested app.get route-like call");
        assert_eq!(route.method, "GET");
        assert_eq!(route.route, "etag fn");
        assert_eq!(route.handler, "");
    }

    #[test]
    fn route_detection_requires_first_argument_string_literal() {
        assert!(route_from_line(
            "app.get(['/user/:user/poke', '/user/:user/pokes'], function (req, res) {})",
            662,
        )
        .is_none());
        assert!(route_from_line("router.get('/thing' + i, handler)", 98).is_none());
    }

    #[test]
    fn route_detection_decodes_escaped_string_literals() {
        let route = route_from_line(
            r#"app.get('/:user\\(:op\\)', function (req, res) { res.end('ok'); })"#,
            649,
        )
        .expect("escaped route string");
        assert_eq!(route.route, r#"/:user\(:op\)"#);
    }

    #[test]
    fn extraction_skips_block_comment_routes() {
        let file = ManifestFile {
            language: "javascript".to_string(),
            mtime_ms: 0.0,
            path: "src/app.js".to_string(),
            profile: "typescript-ast".to_string(),
            size: 0,
        };
        let extracted = extract_javascript_like(
            &file,
            "/*\napp.all('/api/*', function(req, res, next){ next(); });\n*/\napp.get('/ok', handler);\n",
        );
        assert_eq!(extracted.routes.len(), 1);
        assert_eq!(extracted.routes[0].route, "/ok");
    }

    #[test]
    fn python_light_extracts_symbols_imports_and_edges() {
        let file = ManifestFile {
            language: "python".to_string(),
            mtime_ms: 0.0,
            path: "src/app.py".to_string(),
            profile: "python-light".to_string(),
            size: 0,
        };
        let extracted = extract_python_light(
            &file,
            "import os, sys\nfrom flask import Flask, request\n\nclass App:\n    pass\n\ndef create_app(name, debug=False):\n    return App()\n",
        );
        assert!(extracted.symbols.iter().any(|row| {
            row.kind == "class" && row.name == "App" && row.signature == "class App"
        }));
        assert!(extracted.symbols.iter().any(|row| {
            row.kind == "function"
                && row.name == "create_app"
                && row.signature == "def create_app(name, debug=False)"
        }));
        assert!(extracted.imports.iter().any(|row| {
            row.to_ref == "os, sys" && row.imported.is_empty() && row.raw == "import os, sys"
        }));
        assert!(extracted
            .imports
            .iter()
            .any(|row| { row.to_ref == "flask" && row.imported == "Flask, request" }));
        assert_eq!(extracted.imports.len(), extracted.edges.len());
    }

    #[test]
    fn go_light_extracts_symbols_imports_and_edges() {
        let file = ManifestFile {
            language: "go".to_string(),
            mtime_ms: 0.0,
            path: "cmd/app/main.go".to_string(),
            profile: "go-light".to_string(),
            size: 0,
        };
        let extracted = extract_go_light(
            &file,
            "package main\n\nimport \"fmt\"\nimport alias \"example.com/pkg\"\nimport (\n    \"net/http\"\n    _ \"embed\"\n)\n\ntype Server struct{}\nconst port = 8080\nvar defaultName = \"app\"\nfunc NewServer(name string) *Server { return &Server{} }\nfunc (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {}\n",
        );
        assert!(extracted.symbols.iter().any(|row| {
            row.kind == "type" && row.name == "Server" && row.signature == "type Server struct"
        }));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.kind == "constant" && row.name == "port"));
        assert!(extracted
            .symbols
            .iter()
            .any(|row| row.kind == "variable" && row.name == "defaultName"));
        assert!(extracted.symbols.iter().any(|row| {
            row.kind == "function"
                && row.name == "NewServer"
                && row.signature == "func NewServer(name string)"
        }));
        assert!(extracted.symbols.iter().any(|row| {
            row.kind == "method"
                && row.name == "ServeHTTP"
                && row.signature == "func (...) ServeHTTP(w http.ResponseWriter, r *http.Request)"
        }));
        assert!(extracted
            .imports
            .iter()
            .any(|row| row.to_ref == "fmt" && row.imported.is_empty()));
        assert!(extracted
            .imports
            .iter()
            .any(|row| row.to_ref == "example.com/pkg" && row.imported == "alias"));
        assert!(extracted
            .imports
            .iter()
            .any(|row| row.to_ref == "embed" && row.imported == "_"));
        assert_eq!(extracted.imports.len(), extracted.edges.len());
    }

    #[test]
    fn config_extracts_package_json_and_key_value_rows() {
        let package_file = ManifestFile {
            language: "config".to_string(),
            mtime_ms: 0.0,
            path: "package.json".to_string(),
            profile: "config".to_string(),
            size: 0,
        };
        let package = extract_config(
            &package_file,
            r#"{"scripts":{"test":"node --test"},"dependencies":{"express":"^4.0.0"},"devDependencies":{"typescript":"^5.0.0"}}"#,
        );
        assert!(package
            .configs
            .iter()
            .any(|row| row.key == "script:test" && row.value == "node --test" && row.line == 1));
        assert!(package
            .configs
            .iter()
            .any(|row| row.key == "dependency:express" && row.value == "^4.0.0"));
        assert!(package
            .configs
            .iter()
            .any(|row| row.key == "devDependency:typescript" && row.value == "^5.0.0"));

        let config_file = ManifestFile {
            language: "config".to_string(),
            mtime_ms: 0.0,
            path: ".env.example".to_string(),
            profile: "config".to_string(),
            size: 0,
        };
        let config = extract_config(
            &config_file,
            "# ignored\nAPP_NAME = Project Librarian\nnested.key: value\nowners:\n  - platform\nempty:\n",
        );
        assert!(config
            .configs
            .iter()
            .any(|row| row.key == "APP_NAME" && row.value == "Project Librarian" && row.line == 2));
        assert!(config
            .configs
            .iter()
            .any(|row| row.key == "nested.key" && row.value == "value" && row.line == 3));
        assert!(config
            .configs
            .iter()
            .any(|row| row.key == "owners" && row.value == "- platform" && row.line == 4));
        assert!(!config.configs.iter().any(|row| row.key == "empty"));
    }

    #[test]
    fn generic_light_extracts_cross_language_symbols_imports_and_edges() {
        fn file(language: &str, profile: &str, path: &str) -> ManifestFile {
            ManifestFile {
                language: language.to_string(),
                mtime_ms: 0.0,
                path: path.to_string(),
                profile: profile.to_string(),
                size: 0,
            }
        }

        fn assert_symbol(extracted: &Extracted, kind: &str, name: &str) {
            assert!(
                extracted
                    .symbols
                    .iter()
                    .any(|row| row.kind == kind && row.name == name),
                "missing {kind} symbol {name}"
            );
        }

        fn assert_import(extracted: &Extracted, to_ref: &str) {
            assert!(
                extracted.imports.iter().any(|row| row.to_ref == to_ref),
                "missing import {to_ref}"
            );
            assert_eq!(extracted.imports.len(), extracted.edges.len());
        }

        let rust = extract_generic_light(
            &file("rust", "rust-light", "src/lib.rs"),
            "use crate::core::Thing;\npub struct Widget {}\nimpl Widget {}\nimpl<T> Trait<T> for () {}\nimpl<T: Trait<Assoc = Self>> Trait for Generics<T> {}\nimpl_copy_clone!(Thing);\ngenerate! { impl<> Waiter {} }\npub async fn run_job() {}\n",
            GenericLightLanguage::Rust,
        );
        assert_symbol(&rust, "struct", "Widget");
        assert_symbol(&rust, "impl", "Widget");
        assert_symbol(&rust, "impl", "Trait");
        assert_symbol(&rust, "impl", "Generics");
        assert_symbol(&rust, "function", "run_job");
        assert!(!rust.symbols.iter().any(|row| row.name == "_copy_clone"));
        assert!(!rust.symbols.iter().any(|row| row.name == "Waiter"));
        assert_import(&rust, "crate::core::Thing");

        let java = extract_generic_light(
            &file("java", "java-light", "src/Controller.java"),
            "import java.util.List;\n@GetMapping(\"/owners\")\npublic class Controller {\n  @Override public String label() { return \"controller\"; }\n  builder.append(\"x\", value);\n}\n",
            GenericLightLanguage::Java,
        );
        assert_symbol(&java, "class", "Controller");
        assert_symbol(&java, "method", "label");
        assert!(!java.symbols.iter().any(|row| row.name == "GetMapping"));
        assert!(!java.symbols.iter().any(|row| row.name == "append"));
        assert_import(&java, "java.util.List");

        let php = extract_generic_light(
            &file("php", "php-light", "src/Action.php"),
            "<?php\nuse App\\Service;\nclass Action {\n  public function run() {}\n}\nfunction helper() {}\n",
            GenericLightLanguage::Php,
        );
        assert_symbol(&php, "class", "Action");
        assert_symbol(&php, "method", "run");
        assert_symbol(&php, "function", "helper");
        assert_import(&php, "App\\Service");

        let kotlin = extract_generic_light(
            &file("kotlin", "kotlin-light", "src/Worker.kt"),
            "import kotlinx.coroutines.Job\nclass Worker\n@Test fun annotatedRun() {}\nfun Worker.runJob(): Job = Job().also { it.cancel() }\nobject Jobs\n",
            GenericLightLanguage::Kotlin,
        );
        assert_symbol(&kotlin, "class", "Worker");
        assert_symbol(&kotlin, "function", "annotatedRun");
        assert_symbol(&kotlin, "function", "runJob");
        assert_symbol(&kotlin, "object", "Jobs");
        assert!(!kotlin.symbols.iter().any(|row| row.name == "cancel"));
        assert_import(&kotlin, "kotlinx.coroutines.Job");

        let swift = extract_generic_light(
            &file("swift", "swift-light", "Sources/Event.swift"),
            "import Foundation\nstruct Event {}\nprotocol Emitter {}\nfunc emit() {}\n",
            GenericLightLanguage::Swift,
        );
        assert_symbol(&swift, "struct", "Event");
        assert_symbol(&swift, "protocol", "Emitter");
        assert_symbol(&swift, "function", "emit");
        assert_import(&swift, "Foundation");

        let c = extract_generic_light(
            &file("c", "c-light", "src/health.c"),
            "#include <stdio.h>\nstruct Health { int ok; };\nint check_health(void) { return 1; }\n",
            GenericLightLanguage::C,
        );
        assert_symbol(&c, "struct", "Health");
        assert_symbol(&c, "function", "check_health");
        assert_import(&c, "stdio.h");

        let cpp = extract_generic_light(
            &file("cpp", "cpp-light", "src/engine.cpp"),
            "#include \"engine.hpp\"\nusing namespace std;\nnamespace Core {}\nclass Engine {};\nvoid tick() {}\n",
            GenericLightLanguage::Cpp,
        );
        assert_symbol(&cpp, "namespace", "Core");
        assert_symbol(&cpp, "class", "Engine");
        assert_symbol(&cpp, "function", "tick");
        assert_import(&cpp, "engine.hpp");
        assert_import(&cpp, "std");

        let csharp = extract_generic_light(
            &file("csharp", "csharp-light", "src/Service.cs"),
            "using System.Text;\npublic struct Payload {}\npublic class Service {\n  public void Handle() {}\n}\n",
            GenericLightLanguage::Csharp,
        );
        assert_symbol(&csharp, "struct", "Payload");
        assert_symbol(&csharp, "class", "Service");
        assert_symbol(&csharp, "method", "Handle");
        assert_import(&csharp, "System.Text");
    }

    #[test]
    fn sqlite_direct_text_binding_accepts_embedded_nul() {
        let database_path = std::env::temp_dir().join(format!(
            "project-librarian-indexer-nul-{}.sqlite",
            std::process::id()
        ));
        let database_path = database_path.to_string_lossy().into_owned();
        let _ = fs::remove_file(&database_path);
        let database = SqliteConnection::open(&database_path).expect("open sqlite test db");
        database
            .exec("CREATE TABLE values_with_nul (value TEXT NOT NULL)")
            .expect("create test table");
        let statement = database
            .prepare("INSERT INTO values_with_nul (value) VALUES (?)")
            .expect("prepare insert");
        statement
            .bind_text(1, "before\0after")
            .expect("bind embedded nul text");
        statement.run().expect("insert embedded nul text");
        drop(statement);
        drop(database);
        let _ = fs::remove_file(&database_path);
    }

    #[test]
    fn source_text_reader_replaces_invalid_utf8() {
        let source_path = std::env::temp_dir().join(format!(
            "project-librarian-indexer-invalid-utf8-{}.js",
            std::process::id()
        ));
        fs::write(&source_path, b"const ok = 1;\nconst broken = '\xff';\n")
            .expect("write invalid utf8 fixture");
        let text = read_source_text_lossy(&source_path).expect("read invalid utf8 fixture");
        assert!(text.contains("const ok = 1;"));
        assert!(text.contains('\u{fffd}'));
        assert_eq!(text.split('\n').count(), 3);
        let _ = fs::remove_file(&source_path);
    }
}
