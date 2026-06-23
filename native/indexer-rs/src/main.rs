use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};

const ABI_VERSION: u32 = 1;
const ENGINE: &str = "native-rust";
const MODE: &str = "full";
const SCHEMA_VERSION: &str = "4";
const SQLITE_BRIDGE_WARNING: &str = "sqlite3-cli-bridge";

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
    parser_mode: String,
    project_root: String,
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

    let started = std::time::Instant::now();
    let sql = build_sql(&manifest)?;
    write_database_with_sqlite_bridge(&manifest.database_path, &sql)?;
    let counts = collect_counts(&manifest)?;
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
        warnings: vec![SQLITE_BRIDGE_WARNING.to_string()],
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

fn build_sql(manifest: &Manifest) -> Result<String, String> {
    let mut sql = String::new();
    sql.push_str(
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
CREATE INDEX idx_symbols_file ON symbols(file_path);
CREATE INDEX idx_symbols_name ON symbols(name);
CREATE INDEX idx_imports_from ON imports(from_file);
CREATE INDEX idx_routes_path ON routes(route);
CREATE INDEX idx_configs_file ON configs(file_path);
CREATE INDEX idx_edges_source ON edges(source_kind, source);
CREATE INDEX idx_edges_target ON edges(target_kind, target);
CREATE INDEX idx_edges_kind ON edges(kind);
BEGIN;
"#,
    );
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

    for file in &manifest.files {
        let absolute_path = contained_path(&manifest.project_root, &file.path)?;
        let text = fs::read_to_string(&absolute_path)
            .map_err(|error| format!("failed to read {}: {error}", absolute_path.display()))?;
        insert_file(&mut sql, file, &text);
        index_javascript_like(&mut sql, file, &text);
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
    let candidate = root_path.join(relative);
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("invalid file path {relative}: {error}"))?;
    if !canonical.starts_with(&root_path) {
        return Err(format!("manifest file escapes project root: {relative}"));
    }
    Ok(candidate)
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

fn collect_counts(manifest: &Manifest) -> Result<Counts, String> {
    let mut counts = Counts {
        files: manifest.files.len(),
        ..Default::default()
    };
    for file in &manifest.files {
        let text = fs::read_to_string(contained_path(&manifest.project_root, &file.path)?)
            .map_err(|error| format!("failed to read {} for counts: {error}", file.path))?;
        let extracted = extract_javascript_like(file, &text);
        counts.symbols += extracted.symbols.len();
        counts.imports += extracted.imports.len();
        counts.routes += extracted.routes.len();
        counts.edges += extracted.edges.len();
    }
    Ok(counts)
}

fn insert_meta(sql: &mut String, key: &str, value: &str) {
    sql.push_str(&format!(
        "INSERT INTO meta (key, value) VALUES ({}, {});\n",
        sql_string(key),
        sql_string(value)
    ));
}

fn insert_file(sql: &mut String, file: &ManifestFile, text: &str) {
    let lines = if text.is_empty() {
        0
    } else {
        text.split('\n').count()
    };
    sql.push_str(&format!(
        "INSERT INTO files (path, language, profile, kind, bytes, lines, hash, mtime_ms, size) VALUES ({}, {}, {}, 'source', {}, {}, {}, {:.3}, {});\n",
        sql_string(&file.path),
        sql_string(&file.language),
        sql_string(&file.profile),
        file.size,
        lines,
        sql_string(&sha256_hex(text)),
        file.mtime_ms,
        file.size
    ));
    sql.push_str(&format!(
        "INSERT INTO files_fts (path, language, profile, content) VALUES ({}, {}, {}, {});\n",
        sql_string(&file.path),
        sql_string(&file.language),
        sql_string(&file.profile),
        sql_string(text)
    ));
}

fn index_javascript_like(sql: &mut String, file: &ManifestFile, text: &str) {
    let extracted = extract_javascript_like(file, text);
    for symbol in extracted.symbols {
        sql.push_str(&format!(
            "INSERT INTO symbols (name, kind, file_path, line, signature) VALUES ({}, {}, {}, {}, {});\n",
            sql_string(&symbol.name),
            sql_string(&symbol.kind),
            sql_string(&file.path),
            symbol.line,
            sql_string(&symbol.signature)
        ));
        sql.push_str(&format!(
            "INSERT INTO symbols_fts (name, kind, file_path, signature) VALUES ({}, {}, {}, {});\n",
            sql_string(&symbol.name),
            sql_string(&symbol.kind),
            sql_string(&file.path),
            sql_string(&symbol.signature)
        ));
    }
    for import in extracted.imports {
        sql.push_str(&format!(
            "INSERT INTO imports (from_file, to_ref, imported, line, raw) VALUES ({}, {}, {}, {}, {});\n",
            sql_string(&file.path),
            sql_string(&import.to_ref),
            sql_string(&import.imported),
            import.line,
            sql_string(&import.raw)
        ));
    }
    for route in extracted.routes {
        sql.push_str(&format!(
            "INSERT INTO routes (method, route, file_path, line, handler) VALUES ({}, {}, {}, {}, {});\n",
            sql_string(&route.method),
            sql_string(&route.route),
            sql_string(&file.path),
            route.line,
            sql_string(&route.handler)
        ));
    }
    for edge in extracted.edges {
        sql.push_str(&format!(
            "INSERT INTO edges (kind, source_kind, source, target_kind, target, file_path, line, evidence) VALUES ({}, {}, {}, {}, {}, {}, {}, {});\n",
            sql_string(&edge.kind),
            sql_string(&edge.source_kind),
            sql_string(&edge.source),
            sql_string(&edge.target_kind),
            sql_string(&edge.target),
            sql_string(&file.path),
            edge.line,
            sql_string(&edge.evidence)
        ));
    }
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

fn extract_javascript_like(file: &ManifestFile, text: &str) -> Extracted {
    let mut extracted = Extracted::default();
    for (index, raw_line) in text.split('\n').enumerate() {
        let line_number = index + 1;
        let line = one_line(raw_line);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if let Some(symbol) = symbol_from_line(trimmed, line_number) {
            extracted.symbols.push(symbol);
        }
        if let Some(import) = import_from_line(trimmed, line_number) {
            extracted.edges.push(EdgeRow {
                evidence: import.raw.clone(),
                kind: "import".to_string(),
                line: import.line,
                source: file.path.clone(),
                source_kind: "file".to_string(),
                target: import.to_ref.clone(),
                target_kind: "module".to_string(),
            });
            extracted.imports.push(import);
        }
        if let Some(route) = route_from_line(trimmed, line_number) {
            let evidence = trimmed.trim_end_matches(';').to_string();
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
                source: file.path.clone(),
                source_kind: "file".to_string(),
                target: format!(
                    "{}.{}",
                    route_receiver(trimmed).unwrap_or("app"),
                    route.method.to_lowercase()
                ),
                target_kind: "symbol".to_string(),
            });
            extracted.routes.push(route);
        }
    }
    extracted
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
    let name = take_identifier(line);
    if name.is_empty()
        || matches!(
            name.as_str(),
            "if" | "for" | "while" | "switch" | "catch" | "function"
        )
    {
        return None;
    }
    let rest = line[name.len()..].trim_start();
    if !rest.starts_with('(') || !line.contains('{') || line.contains("=>") || line.contains('.') {
        return None;
    }
    Some(SymbolRow {
        kind: "method".to_string(),
        line: line_number,
        name,
        signature: line.to_string(),
    })
}

fn import_from_line(line: &str, line_number: usize) -> Option<ImportRow> {
    if line.starts_with("import ") {
        let module = string_after_marker(line, " from ").or_else(|| first_string_literal(line))?;
        let imported = import_binding(line);
        return Some(ImportRow {
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
            imported: exported,
            line: line_number,
            raw: line.to_string(),
            to_ref: module,
        });
    }
    if line.contains("require(") {
        let module = first_string_literal(line.split("require(").nth(1).unwrap_or(""))?;
        return Some(ImportRow {
            imported: String::new(),
            line: line_number,
            raw: format!("require({})", javascript_quote(&module)),
            to_ref: module,
        });
    }
    None
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
    for receiver in ["app", "router", "server"] {
        if line.starts_with(&format!("{receiver}.")) {
            return Some(receiver);
        }
    }
    None
}

fn take_identifier(text: &str) -> String {
    text.chars()
        .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '$')
        .collect()
}

fn string_after_marker(line: &str, marker: &str) -> Option<String> {
    first_string_literal(line.split(marker).nth(1).unwrap_or(""))
}

fn first_string_literal(text: &str) -> Option<String> {
    let quote_index = text.find(['"', '\''])?;
    let quote = text.as_bytes()[quote_index] as char;
    let rest = &text[quote_index + 1..];
    let end = rest.find(quote)?;
    Some(rest[..end].to_string())
}

fn one_line(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

fn sha256_hex(text: &str) -> String {
    let digest = Sha256::digest(text.as_bytes());
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        output.push_str(&format!("{byte:02x}"));
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
