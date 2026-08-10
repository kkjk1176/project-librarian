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
exports.indexConfigs = indexConfigs;
const path = __importStar(require("node:path"));
const shared_1 = require("./shared");
function indexConfigs(file, insertConfig) {
    if (path.basename(file.path) === "package.json") {
        try {
            const parsed = JSON.parse(file.text);
            for (const [name, value] of Object.entries(parsed.scripts ?? {}))
                insertConfig.run(`script:${name}`, value, file.path, 1);
            for (const [name, value] of Object.entries(parsed.dependencies ?? {}))
                insertConfig.run(`dependency:${name}`, value, file.path, 1);
            for (const [name, value] of Object.entries(parsed.devDependencies ?? {}))
                insertConfig.run(`devDependency:${name}`, value, file.path, 1);
        }
        catch {
            insertConfig.run("parse-error", "package.json is not valid JSON", file.path, 1);
        }
        return;
    }
    (0, shared_1.insertMatches)(file, /^\s*([A-Za-z0-9_.-]+)\s*[:=]\s*(.+)$/gm, (match, line) => {
        insertConfig.run(match[1] ?? "", (match[2] ?? "").trim(), file.path, line);
    });
}
