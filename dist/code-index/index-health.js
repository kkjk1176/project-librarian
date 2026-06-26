"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.inspectCodeIndexHealth = inspectCodeIndexHealth;
exports.formatCodeIndexHealthRemediation = formatCodeIndexHealthRemediation;
const fs = __importStar(require("node:fs"));
function safeDiscoverCodeFiles(discoverCodeFiles, scopes) {
    try {
        return discoverCodeFiles(scopes).length;
    }
    catch {
        return null;
    }
}
function safeScalar(database, sql, param) {
    try {
        const rows = typeof param === "string" ? database.prepare(sql).all(param) : database.prepare(sql).all();
        const value = rows[0]?.value;
        return typeof value === "string" || typeof value === "number" ? String(value) : "";
    }
    catch {
        return "";
    }
}
function tableNames(database) {
    try {
        return database.prepare("SELECT name AS value FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name")
            .all()
            .map((row) => String(row.value))
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
function readScopes(scopesJson, scopesText, fallback) {
    if (scopesJson) {
        try {
            const parsed = JSON.parse(scopesJson);
            if (Array.isArray(parsed) && parsed.every((scope) => typeof scope === "string"))
                return parsed;
        }
        catch {
            // Fall back to legacy comma-separated metadata below.
        }
    }
    const scopes = scopesText.split(",").map((scope) => scope.trim()).filter(Boolean);
    return scopes.length > 0 ? scopes : fallback;
}
function rebuildCommand(indexableFiles, smallRepoThreshold, options = {}) {
    const parts = ["project-librarian", "--code-index", options.schemaMigration ? "--code-index-migrate" : "--code-index-full"];
    if (indexableFiles !== null && indexableFiles < smallRepoThreshold)
        parts.push("--acknowledge-small-repo");
    return parts.join(" ");
}
function baseHealth(options, status, message, indexableFiles) {
    return {
        database_path: options.relativePath,
        expected_schema_version: options.expectedSchemaVersion,
        found_schema_version: "",
        indexed_files: null,
        indexable_files: indexableFiles,
        message,
        parser_mode: "",
        recommended_rebuild_command: rebuildCommand(indexableFiles, options.smallRepoThreshold),
        scopes: options.defaultScopes,
        status,
        tables: [],
        updated_at: "",
    };
}
function inspectCodeIndexHealth(options) {
    if (!fs.existsSync(options.absolutePath)) {
        const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, options.defaultScopes);
        return baseHealth(options, "missing", `missing code evidence index: ${options.relativePath}`, indexableFiles);
    }
    let database;
    try {
        database = options.openDatabase(options.absolutePath);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, options.defaultScopes);
        return baseHealth(options, "unreadable", `code evidence index is not readable: ${message}`, indexableFiles);
    }
    try {
        database.exec("PRAGMA query_only = ON");
        const tables = tableNames(database);
        const foundSchemaVersion = safeScalar(database, "SELECT value FROM meta WHERE key = ?", "schema_version");
        const updatedAt = safeScalar(database, "SELECT value FROM meta WHERE key = ?", "updated_at");
        const parserMode = safeScalar(database, "SELECT value FROM meta WHERE key = ?", "parser_mode");
        const scopes = readScopes(safeScalar(database, "SELECT value FROM meta WHERE key = ?", "scopes_json"), safeScalar(database, "SELECT value FROM meta WHERE key = ?", "scopes"), options.defaultScopes);
        const indexedFilesText = tables.includes("files") ? safeScalar(database, "SELECT count(*) AS value FROM files") : "";
        const indexedFiles = indexedFilesText ? Number(indexedFilesText) : null;
        const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, scopes.length > 0 ? scopes : options.defaultScopes);
        const compatible = foundSchemaVersion === options.expectedSchemaVersion;
        const schemaMigration = Boolean(foundSchemaVersion) && !compatible;
        return {
            database_path: options.relativePath,
            expected_schema_version: options.expectedSchemaVersion,
            found_schema_version: foundSchemaVersion,
            indexed_files: indexedFiles !== null && Number.isFinite(indexedFiles) ? indexedFiles : null,
            indexable_files: indexableFiles,
            message: compatible
                ? `code evidence index is compatible: schema ${foundSchemaVersion}`
                : `code evidence index schema version ${foundSchemaVersion || "(missing)"} is incompatible with ${options.expectedSchemaVersion}`,
            parser_mode: parserMode,
            recommended_rebuild_command: rebuildCommand(indexableFiles, options.smallRepoThreshold, { schemaMigration }),
            scopes,
            status: compatible ? "compatible" : "incompatible_schema",
            tables,
            updated_at: updatedAt,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const indexableFiles = safeDiscoverCodeFiles(options.discoverCodeFiles, options.defaultScopes);
        return baseHealth(options, "unreadable", `code evidence index is not readable: ${message}`, indexableFiles);
    }
    finally {
        database.close();
    }
}
function formatCodeIndexHealthRemediation(health) {
    return [
        health.message,
        `database: ${health.database_path}`,
        `status: ${health.status}`,
        `expected_schema_version: ${health.expected_schema_version}`,
        `found_schema_version: ${health.found_schema_version || "(missing)"}`,
        `rebuild: ${health.recommended_rebuild_command}`,
    ].join("\n");
}
