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
exports.extractionProfile = extractionProfile;
exports.createExtractionBackendRegistry = createExtractionBackendRegistry;
const path = __importStar(require("node:path"));
const config_1 = require("./config");
const light_languages_1 = require("./light-languages");
const tree_sitter_1 = require("./tree-sitter");
const typescript_1 = require("./typescript");
function treeSitterProfile(relativePath) {
    const extension = path.extname(relativePath).toLowerCase();
    if ([".ts", ".mts", ".cts"].includes(extension))
        return "tree-sitter-typescript";
    if (extension === ".tsx")
        return "tree-sitter-tsx";
    if ([".js", ".mjs", ".cjs", ".jsx"].includes(extension))
        return "tree-sitter-javascript";
    if (extension === ".py")
        return "tree-sitter-python";
    if (extension === ".go")
        return "tree-sitter-go";
    if ([".c", ".h"].includes(extension))
        return "tree-sitter-c";
    if ([".cc", ".cpp", ".cxx", ".hpp", ".hh", ".hxx"].includes(extension))
        return "tree-sitter-cpp";
    if (extension === ".cs")
        return "tree-sitter-csharp";
    if (extension === ".java")
        return "tree-sitter-java";
    if ([".kt", ".kts"].includes(extension))
        return "tree-sitter-kotlin";
    if (extension === ".php")
        return "tree-sitter-php";
    if (extension === ".rs")
        return "tree-sitter-rust";
    if (extension === ".swift")
        return "tree-sitter-swift";
    return "inventory-only";
}
function extractionProfile(relativePath, language, parserMode) {
    if (language === "config")
        return "config";
    if (parserMode === "tree-sitter")
        return treeSitterProfile(relativePath);
    if (isJavaScriptLikeProfileInput(language))
        return "typescript-ast";
    if (language === "python")
        return "python-light";
    if (language === "go")
        return "go-light";
    if (isGenericLightLanguage(language))
        return light_languages_1.genericLightProfileByLanguage[language];
    return "inventory-only";
}
function isJavaScriptLikeProfileInput(language) {
    return language === "javascript" || language === "typescript";
}
function isGenericLightLanguage(language) {
    return ["c", "cpp", "csharp", "java", "kotlin", "php", "rust", "swift"].includes(language);
}
function createExtractionBackendRegistry(fail) {
    const extractionBackends = [
        {
            id: "typescript-compiler",
            index: typescript_1.indexJavaScriptLike,
            label: "TypeScript compiler API",
            profile: "typescript-ast",
            strength: "structural",
        },
        {
            id: "regex-light",
            index: light_languages_1.indexPythonLight,
            label: "Python lightweight regex",
            profile: "python-light",
            strength: "light",
        },
        {
            id: "regex-light",
            index: light_languages_1.indexGoLight,
            label: "Go lightweight regex",
            profile: "go-light",
            strength: "light",
        },
        ...Object.entries(light_languages_1.genericLightProfileByLanguage).map(([language, profile]) => ({
            id: "regex-light",
            index: (file, statements) => (0, light_languages_1.indexGenericLight)(file, statements, language),
            label: `${language} lightweight regex`,
            profile,
            strength: "light",
        })),
        ...(0, tree_sitter_1.treeSitterBackends)(fail),
        {
            id: "config-key-value",
            index: (file, statements) => (0, config_1.indexConfigs)(file, statements.insertConfig),
            label: "Configuration key/value extractor",
            profile: "config",
            strength: "config",
        },
        {
            id: "inventory-only",
            index: () => undefined,
            label: "Inventory-only file listing",
            profile: "inventory-only",
            strength: "inventory",
        },
    ];
    const extractionBackendsByProfile = new Map(extractionBackends.map((backend) => [backend.profile, backend]));
    return {
        backendForProfile(profile) {
            const backend = extractionBackendsByProfile.get(profile);
            if (!backend)
                fail(`missing extraction backend for profile: ${profile}`);
            return backend;
        },
    };
}
