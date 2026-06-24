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
const MODE: &str = "full";
const SCHEMA_VERSION: &str = "4";
const SQLITE_DIRECT_WARNING: &str = "sqlite3-direct-ffi";
const SQLITE_BRIDGE_WARNING: &str = "sqlite3-cli-bridge";
const ROW_STREAM_WARNING: &str = "row-stream";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum OutputMode {
    RowStream,
    SqliteBridge,
    SqliteDirect,
}

impl OutputMode {
    fn from_manifest(value: Option<&str>) -> Result<Self, String> {
        match value.unwrap_or("sqlite-bridge") {
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
    match output_mode {
        OutputMode::RowStream => write_row_stream(&manifest, &rows)?,
        OutputMode::SqliteBridge => {
            let sql = build_sql(&manifest, &rows)?;
            write_database_with_sqlite_bridge(&manifest.database_path, &sql)?;
        }
        OutputMode::SqliteDirect => write_database_direct(&manifest, &rows)?,
    }
    let counts = rows.counts();
    let summary = Summary {
        engine: ENGINE.to_string(),
        schema_version: manifest.schema_version.clone(),
        mode: MODE.to_string(),
        database: manifest.database_path.clone(),
        files: counts.files,
        native_files: counts.files,
        typescript_files: 0,
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
    if manifest.mode != MODE {
        return Err(format!(
            "unsupported mode: expected {MODE}, got {}",
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
    let mut seen_paths = BTreeSet::new();
    for file in &manifest.files {
        validate_relative_path(&file.path, "file path")?;
        if !seen_paths.insert(file.path.clone()) {
            return Err(format!("duplicate manifest file path: {}", file.path));
        }
        if file.profile != "typescript-ast" {
            return Err(format!(
                "native helper only accepts typescript-ast files, got {} for {}",
                file.profile, file.path
            ));
        }
        if file.language != "javascript" && file.language != "typescript" {
            return Err(format!(
                "native helper only accepts JS/TS languages, got {} for {}",
                file.language, file.path
            ));
        }
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
    for edge in &rows.edges {
        insert_edge_row(&mut sql, edge);
    }
    sql.push_str("COMMIT;\n");
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
    edges: Vec<EdgeIndexRow>,
    files: Vec<FileIndexRow>,
    imports: Vec<ImportIndexRow>,
    routes: Vec<RouteIndexRow>,
    symbols: Vec<SymbolIndexRow>,
}

impl IndexRows {
    fn counts(&self) -> Counts {
        Counts {
            configs: 0,
            edges: self.edges.len(),
            files: self.files.len(),
            imports: self.imports.len(),
            routes: self.routes.len(),
            symbols: self.symbols.len(),
        }
    }

    fn append(&mut self, mut other: IndexRows) {
        self.files.append(&mut other.files);
        self.symbols.append(&mut other.symbols);
        self.imports.append(&mut other.imports);
        self.routes.append(&mut other.routes);
        self.edges.append(&mut other.edges);
    }
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
    if worker_count <= 1 || manifest.files.len() < 1024 {
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
        let text = fs::read_to_string(&absolute_path)
            .map_err(|error| format!("failed to read {}: {error}", absolute_path.display()))?;
        let lines = if text.is_empty() {
            0
        } else {
            text.split('\n').count()
        };
        let hash = sha256_hex(&text);
        let extracted = extract_javascript_like(file, &text);
        rows.files.push(FileIndexRow {
            bytes: file.size,
            content: text,
            hash,
            kind: "source".to_string(),
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
PRAGMA journal_mode = WAL;
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE files (
  path TEXT PRIMARY KEY,
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
        }
        Err(error) => {
            let _ = database.exec("ROLLBACK");
            return Err(error);
        }
    }
    Ok(())
}

fn insert_index_rows_direct(
    database: &SqliteConnection,
    manifest: &Manifest,
    rows: &IndexRows,
) -> Result<(), String> {
    let insert_meta = database.prepare("INSERT INTO meta (key, value) VALUES (?, ?)")?;
    insert_meta.bind_text(1, "created_at")?;
    insert_meta.bind_text(2, &timestamp_placeholder())?;
    insert_meta.run()?;
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

    let insert_file = database.prepare("INSERT INTO files (path, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")?;
    let insert_file_fts = database
        .prepare("INSERT INTO files_fts (path, language, profile, content) VALUES (?, ?, ?, ?)")?;
    for file in &rows.files {
        insert_file.bind_text(1, &file.path)?;
        insert_file.bind_text(2, &file.language)?;
        insert_file.bind_text(3, &file.profile)?;
        insert_file.bind_text(4, &file.kind)?;
        insert_file.bind_int64(5, file.bytes as i64)?;
        insert_file.bind_int64(6, file.lines as i64)?;
        insert_file.bind_text(7, &file.hash)?;
        insert_file.bind_double(8, file.mtime_ms)?;
        insert_file.bind_int64(9, file.size as i64)?;
        insert_file.run()?;

        insert_file_fts.bind_text(1, &file.path)?;
        insert_file_fts.bind_text(2, &file.language)?;
        insert_file_fts.bind_text(3, &file.profile)?;
        insert_file_fts.bind_text(4, &file.content)?;
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
    sql.push_str(&format!(
        "INSERT INTO files (path, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES ({}, {}, {}, 'source', {}, {}, {}, {:.3}, {});\n",
        sql_string(&file.path),
        sql_string(&file.language),
        sql_string(&file.profile),
        file.bytes,
        file.lines,
        sql_string(&file.hash),
        file.mtime_ms,
        file.size
    ));
    sql.push_str(&format!(
        "INSERT INTO files_fts (path, language, profile, content) VALUES ({}, {}, {}, {});\n",
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
    edges: Vec<EdgeRow>,
    imports: Vec<ImportRow>,
    routes: Vec<RouteRow>,
    symbols: Vec<SymbolRow>,
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
    line: usize,
    parts: Vec<String>,
}

struct PendingImportDeclaration {
    line: usize,
    parts: Vec<String>,
}

fn extract_javascript_like(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    let mut context_stack: Vec<ContextFrame> = Vec::new();
    let mut pending_decorator_routes: Vec<DecoratorRoute> = Vec::new();
    let mut pending_call: Option<PendingCallExpression> = None;
    let mut pending_multiline_call_chain: Option<PendingMultilineCallChain> = None;
    let mut pending_context_symbol: Option<String> = None;
    let mut pending_import: Option<PendingImportDeclaration> = None;
    let mut in_template_literal = false;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = one_line(raw_line);
        let trimmed = line.trim();
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
            if has_unbalanced_template_delimiter(trimmed) {
                in_template_literal = false;
            }
            continue;
        }
        if is_comment_line(trimmed) {
            continue;
        }
        if starts_non_declaration_template_literal(trimmed) {
            in_template_literal = true;
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
                    route_receiver(trimmed).unwrap_or("app"),
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
        let pending_continuation_is_property_call = pending_multiline_call_chain.is_some()
            && ((trimmed.starts_with('.') && !trimmed.starts_with("..."))
                || trimmed.starts_with(")."));
        if let Some(chain) = pending_multiline_call_chain.as_mut() {
            chain.parts.push(trimmed.to_string());
            if multiline_statement_complete(&chain.parts) {
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
                pending_multiline_call_chain = None;
            }
        } else if let Some(start) = multiline_property_chain_start(trimmed) {
            pending_multiline_call_chain = Some(PendingMultilineCallChain {
                context: call_context.clone(),
                line: line_number,
                parts: vec![start],
            });
        }
        if !pending_continuation_is_property_call {
            for call in calls_from_line(trimmed, line_symbol.as_ref(), is_route_line) {
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
    extracted
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

fn multiline_statement_complete(parts: &[String]) -> bool {
    parts
        .last()
        .map(|part| part.trim_end().ends_with(';'))
        .unwrap_or(false)
        && delimiter_delta(&parts.join(" ")) <= 0
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

fn starts_non_declaration_template_literal(line: &str) -> bool {
    has_unbalanced_template_delimiter(line)
        && !line.starts_with("const ")
        && !line.starts_with("let ")
        && !line.starts_with("var ")
        && !line.starts_with("export const ")
        && !line.starts_with("export let ")
        && !line.starts_with("export var ")
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
    let Some((_, initializer)) = text_after_keyword.split_once('=') else {
        return false;
    };
    let initializer = initializer.trim();
    initializer.starts_with("function")
        || initializer.starts_with("async function")
        || initializer == "async ("
        || contains_top_level_arrow(initializer)
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
    let receiver = route_receiver(line)?;
    let after_receiver = line.strip_prefix(receiver)?.strip_prefix('.')?;
    let method = after_receiver.split('(').next()?.to_lowercase();
    if !["all", "delete", "get", "patch", "post", "put"].contains(&method.as_str()) {
        return None;
    }
    let args = after_receiver.split_once('(')?.1;
    let route = first_string_literal(args)?;
    let handler = args
        .split(',')
        .nth(1)
        .unwrap_or("")
        .trim()
        .trim_end_matches(';')
        .trim_end_matches(')')
        .trim()
        .to_string();
    Some(RouteRow {
        handler,
        line: line_number,
        method: method.to_uppercase(),
        route,
    })
}

fn route_receiver(line: &str) -> Option<&'static str> {
    ["app", "router", "server"].into_iter().find(|&receiver| {
        line.starts_with(receiver) && line.as_bytes().get(receiver.len()) == Some(&b'.')
    })
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
}
