"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.containsLikePattern = containsLikePattern;
exports.shouldUseFtsSearchForScale = shouldUseFtsSearchForScale;
exports.searchFiles = searchFiles;
exports.searchSymbols = searchSymbols;
const code_index_file_policy_1 = require("../code-index-file-policy");
function escapeLikeTerm(term) {
    return term.replace(/[\\%_]/g, (match) => `\\${match}`);
}
function containsLikePattern(term) {
    return `%${escapeLikeTerm(term)}%`;
}
function prefixLikePattern(term) {
    return `${escapeLikeTerm(term)}%`;
}
function ftsTokens(term) {
    return Array.from(new Set(term.match(/[\p{L}\p{N}_]+/gu) ?? []));
}
function ftsPrefixQuery(term) {
    const tokens = ftsTokens(term);
    return tokens.slice(0, 8).map((token) => `"${token.replace(/"/g, "\"\"")}"*`).join(" AND ");
}
function indexedFileCount(database) {
    const row = database.prepare("SELECT count(*) AS count FROM files").all()[0] ?? {};
    return Number(row.count ?? 0);
}
function shouldUseFtsSearchForScale(term, fileCount) {
    const tokens = Array.from(new Set(term.match(/[\p{L}\p{N}_]+/gu) ?? []));
    if (tokens.length === 0)
        return false;
    if (tokens.length > 1)
        return true;
    return fileCount >= code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD;
}
function shouldUseFtsSearch(database, term) {
    const tokens = ftsTokens(term);
    if (tokens.length === 0)
        return false;
    if (tokens.length > 1)
        return true;
    return indexedFileCount(database) >= code_index_file_policy_1.SMALL_REPO_FILE_THRESHOLD;
}
function stringValue(row, key) {
    const value = row[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function addRankedRow(rowsByKey, row, key, score) {
    const current = rowsByKey.get(key);
    if (!current || score > current.score)
        rowsByKey.set(key, { row, score });
}
function rankedRows(rowsByKey, limit, stableKeys) {
    return Array.from(rowsByKey.values())
        .sort((left, right) => {
        const scoreDelta = right.score - left.score;
        if (scoreDelta !== 0)
            return scoreDelta;
        for (const key of stableKeys) {
            const compared = stringValue(left.row, key).localeCompare(stringValue(right.row, key));
            if (compared !== 0)
                return compared;
        }
        return 0;
    })
        .slice(0, limit)
        .map((ranked) => ranked.row);
}
function searchFiles(database, term, limit = 25) {
    const normalized = term.trim();
    if (!normalized)
        return [];
    const contains = containsLikePattern(normalized);
    const prefix = prefixLikePattern(normalized);
    const rowsByKey = new Map();
    const exactRows = database.prepare("SELECT path, language, profile, lines, bytes FROM files WHERE path = ? ORDER BY path LIMIT ?").all(normalized, limit);
    exactRows.forEach((row) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 900));
    const prefixRows = database.prepare("SELECT path, language, profile, lines, bytes FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?").all(prefix, limit);
    prefixRows.forEach((row) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 750));
    const ftsQuery = shouldUseFtsSearch(database, normalized) ? ftsPrefixQuery(normalized) : "";
    if (ftsQuery) {
        const ftsRows = database.prepare(`
      SELECT files.path, files.language, files.profile, files.lines, files.bytes
      FROM files_fts
      JOIN files ON files.fts_rowid = files_fts.rowid
      WHERE files_fts MATCH ?
      ORDER BY bm25(files_fts, 8.0, 1.0, 1.0, 0.25), files.path
      LIMIT ?
    `).all(ftsQuery, limit);
        ftsRows.forEach((row, index) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 650 - index));
    }
    const containsRows = database.prepare("SELECT path, language, profile, lines, bytes FROM files WHERE path LIKE ? ESCAPE '\\' ORDER BY path LIMIT ?").all(contains, limit);
    containsRows.forEach((row) => addRankedRow(rowsByKey, row, stringValue(row, "path"), 500));
    return rankedRows(rowsByKey, limit, ["path"]);
}
function symbolKey(row) {
    return [
        stringValue(row, "file_path"),
        stringValue(row, "line"),
        stringValue(row, "kind"),
        stringValue(row, "name"),
        stringValue(row, "signature"),
    ].join("\u0000");
}
function searchSymbols(database, term, limit = 50) {
    const normalized = term.trim();
    if (!normalized)
        return [];
    const contains = containsLikePattern(normalized);
    const prefix = prefixLikePattern(normalized);
    const rowsByKey = new Map();
    const exactRows = database.prepare(`
    SELECT name, kind, file_path, line, signature
    FROM symbols
    WHERE name = ? OR signature = ?
    ORDER BY file_path, line
    LIMIT ?
  `).all(normalized, normalized, limit);
    exactRows.forEach((row) => addRankedRow(rowsByKey, row, symbolKey(row), 1000));
    const prefixRows = database.prepare(`
    SELECT name, kind, file_path, line, signature
    FROM symbols
    WHERE name LIKE ? ESCAPE '\\' OR signature LIKE ? ESCAPE '\\'
    ORDER BY file_path, line
    LIMIT ?
  `).all(prefix, prefix, limit);
    prefixRows.forEach((row) => addRankedRow(rowsByKey, row, symbolKey(row), 850));
    const ftsQuery = shouldUseFtsSearch(database, normalized) ? ftsPrefixQuery(normalized) : "";
    if (ftsQuery) {
        const ftsRows = database.prepare(`
      SELECT symbols.name, symbols.kind, symbols.file_path, symbols.line, symbols.signature
      FROM symbols_fts
      JOIN symbols
        ON symbols.name = symbols_fts.name
       AND symbols.kind = symbols_fts.kind
       AND symbols.file_path = symbols_fts.file_path
       AND symbols.signature = symbols_fts.signature
      WHERE symbols_fts MATCH ?
      ORDER BY bm25(symbols_fts, 8.0, 1.0, 4.0, 2.0), symbols.file_path, symbols.line
      LIMIT ?
    `).all(ftsQuery, limit);
        ftsRows.forEach((row, index) => addRankedRow(rowsByKey, row, symbolKey(row), 700 - index));
    }
    const containsRows = database.prepare(`
    SELECT name, kind, file_path, line, signature
    FROM symbols
    WHERE name LIKE ? ESCAPE '\\' OR signature LIKE ? ESCAPE '\\' OR file_path LIKE ? ESCAPE '\\'
    ORDER BY file_path, line
    LIMIT ?
  `).all(contains, contains, contains, limit);
    containsRows.forEach((row) => addRankedRow(rowsByKey, row, symbolKey(row), 500));
    return rankedRows(rowsByKey, limit, ["file_path", "line", "kind", "name", "signature"]);
}
