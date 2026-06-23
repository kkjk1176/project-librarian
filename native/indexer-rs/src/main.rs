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
        let value = cstring(value, "SQLite text value")?;
        let status =
            unsafe { sqlite3_bind_text(self.raw, index, value.as_ptr(), -1, sqlite_transient()) };
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

fn extract_javascript_like(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    let mut context_stack: Vec<ContextFrame> = Vec::new();
    let mut pending_decorator_routes: Vec<DecoratorRoute> = Vec::new();
    let mut pending_call: Option<PendingCallExpression> = None;
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = one_line(raw_line);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(route) = decorator_route_from_line(trimmed, line_number) {
            pending_decorator_routes.push(route);
            continue;
        }
        let current_context = context_stack
            .last()
            .map(|frame| frame.name.clone())
            .unwrap_or_default();
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
        update_context_stack(&mut context_stack, line_symbol.as_ref(), trimmed);
    }
    extracted
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
    line.chars().fold(0, |total, ch| {
        total
            + match ch {
                '{' => 1,
                '}' => -1,
                _ => 0,
            }
    })
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

fn call_target_before_paren(line: &str, paren_index: usize) -> Option<(usize, String)> {
    let bytes = line.as_bytes();
    let mut end = paren_index;
    while end > 0 && bytes[end - 1].is_ascii_whitespace() {
        end -= 1;
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
    if line[start..end].starts_with('.') {
        start = property_receiver_start(line, start);
    }
    Some((start, line[start..end].to_string()))
}

fn property_receiver_start(line: &str, dot_start: usize) -> usize {
    let bytes = line.as_bytes();
    let mut start = dot_start;
    while start > 0 {
        let previous = bytes[start - 1] as char;
        if previous.is_whitespace() || matches!(previous, '=' | '(' | ',' | '?' | ':' | ';' | '{') {
            break;
        }
        start -= 1;
    }
    start
}

fn should_skip_call_target(
    line: &str,
    target_start: usize,
    target: &str,
    declared_symbol: Option<&SymbolRow>,
) -> bool {
    if target.starts_with('.')
        || target.starts_with("].")
        || target == "require"
        || matches!(
            target,
            "if" | "for" | "while" | "switch" | "catch" | "function" | "class" | "new"
        )
    {
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
            let kind = if cleaned.contains("=>") || cleaned.contains("function") {
                "function"
            } else {
                "variable"
            };
            return symbol_row(rest, kind, cleaned_without_semicolon, line_number);
        }
    }
    method_symbol_from_line(cleaned_without_semicolon, line_number)
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
            "if" | "for" | "while" | "switch" | "catch" | "function" | "return"
        )
}

fn is_method_candidate_start(line: &str, name_start: usize) -> bool {
    line[..name_start]
        .chars()
        .rev()
        .find(|ch| !ch.is_whitespace())
        .map(|ch| matches!(ch, '{' | ',' | ';'))
        .unwrap_or(true)
}

fn method_body_brace_index(line: &str, start: usize) -> Option<usize> {
    let suffix = &line[start..];
    let brace_offset = suffix.find('{')?;
    let before_brace = suffix[..brace_offset].trim();
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
    if before_from.starts_with('{') && before_from.ends_with('}') {
        return before_from
            .trim_matches(|ch| ch == '{' || ch == '}')
            .split(',')
            .map(|part| part.trim().split(" as ").last().unwrap_or("").trim())
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(", ");
    }
    before_from.trim_end_matches(';').to_string()
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
