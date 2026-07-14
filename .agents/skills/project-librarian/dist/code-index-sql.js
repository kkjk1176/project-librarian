"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReadOnlySql = isReadOnlySql;
function isReadOnlySql(sql) {
    const trimmed = sql.trim().toLowerCase();
    if (!/^(select|with)\b/.test(trimmed) || /;\s*\S/.test(trimmed))
        return false;
    return !/\b(attach|alter|create|delete|detach|drop|insert|pragma|reindex|replace|update|vacuum)\b/.test(trimmed);
}
