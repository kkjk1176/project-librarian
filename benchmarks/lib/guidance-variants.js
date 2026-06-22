"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const generatedTemplateSources = {
  startup: "startup",
  index: "index",
};

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeRelativePath(value) {
  if (!value || typeof value !== "string") {
    throw new Error("guidance variant source path must be a non-empty string");
  }
  const normalized = value.split(/[\\/]+/).filter(Boolean).join("/");
  if (!normalized || normalized.startsWith("../") || normalized === ".." || path.isAbsolute(value)) {
    throw new Error(`guidance variant source path must be repository-relative: ${value}`);
  }
  return normalized;
}

function validateGeneratedSource(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("guidance variant generated source must be an object");
  }
  const sourcePath = normalizeRelativePath(raw.path);
  if (!raw.template || typeof raw.template !== "string") {
    throw new Error(`guidance variant generated source ${sourcePath} requires template`);
  }
  if (!Object.prototype.hasOwnProperty.call(generatedTemplateSources, raw.template)) {
    throw new Error(`unknown guidance variant generated source template for ${sourcePath}: ${raw.template}`);
  }
  return {
    path: sourcePath,
    template: raw.template,
  };
}

function assertUniqueSourcePaths(variantId, sources) {
  const seen = new Set();
  for (const source of sources) {
    const sourcePath = typeof source === "string" ? source : source.path;
    if (seen.has(sourcePath)) {
      throw new Error(`guidance variant ${variantId} declares duplicate source path: ${sourcePath}`);
    }
    seen.add(sourcePath);
  }
}

function validateVariant(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("guidance variant must be an object");
  }
  if (!raw.variant_id || typeof raw.variant_id !== "string") {
    throw new Error("guidance variant requires variant_id");
  }
  if (!/^[a-z0-9_.-]+$/.test(raw.variant_id)) {
    throw new Error(`invalid guidance variant_id: ${raw.variant_id}`);
  }
  const sourceFiles = Array.isArray(raw.source_files) ? raw.source_files.map(normalizeRelativePath) : [];
  const generatedSources = Array.isArray(raw.generated_sources) ? raw.generated_sources.map(validateGeneratedSource) : [];
  assertUniqueSourcePaths(raw.variant_id, [...sourceFiles, ...generatedSources]);
  const inlineGuidance = typeof raw.inline_guidance === "string" ? raw.inline_guidance : "";
  if (sourceFiles.length === 0 && generatedSources.length === 0 && inlineGuidance.trim().length === 0) {
    throw new Error(`guidance variant ${raw.variant_id} needs source_files, generated_sources, or inline_guidance`);
  }
  return {
    variant_id: raw.variant_id,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : raw.variant_id,
    agent_surfaces: Array.isArray(raw.agent_surfaces) ? raw.agent_surfaces.map(String) : ["codex"],
    source_files: sourceFiles,
    generated_sources: generatedSources,
    inline_guidance: inlineGuidance,
    notes: typeof raw.notes === "string" ? raw.notes : "",
  };
}

function loadGuidanceVariantFile(filePath) {
  const absolute = path.resolve(filePath);
  const raw = readJson(absolute);
  if (!raw || typeof raw !== "object") throw new Error(`invalid guidance variant file: ${absolute}`);
  if (raw.schema_version !== 1) throw new Error(`unsupported guidance variant schema_version in ${absolute}: ${raw.schema_version}`);
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
    throw new Error(`guidance variant file has no variants: ${absolute}`);
  }
  const variants = raw.variants.map(validateVariant);
  const seen = new Set();
  for (const variant of variants) {
    if (seen.has(variant.variant_id)) throw new Error(`duplicate guidance variant_id: ${variant.variant_id}`);
    seen.add(variant.variant_id);
  }
  return {
    schema_version: raw.schema_version,
    path: absolute,
    variants,
  };
}

function readSourceFiles(root, sourceFiles) {
  return sourceFiles.map((relative) => {
    const absolute = path.join(root, relative);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
      throw new Error(`guidance variant source file missing: ${relative}`);
    }
    const content = fs.readFileSync(absolute, "utf8");
    return {
      path: relative,
      source_type: "file",
      sha256: sha256(content),
      char_count: content.length,
      content,
    };
  });
}

function loadTemplateSource(templateName) {
  const templatesPath = path.resolve(__dirname, "..", "..", "dist", "templates.js");
  const templates = require(templatesPath);
  const exportName = generatedTemplateSources[templateName];
  const content = templates[exportName];
  if (typeof content !== "string" || content.length === 0) {
    throw new Error(`guidance variant generated source template has no string export: ${templateName}`);
  }
  return content;
}

function readGeneratedSources(generatedSources) {
  return generatedSources.map((source) => {
    const content = loadTemplateSource(source.template);
    return {
      path: source.path,
      source_type: "generated_template",
      template: source.template,
      sha256: sha256(content),
      char_count: content.length,
      content,
    };
  });
}

function renderVariantGuidance(variant, sourceContents) {
  const parts = [];
  if (variant.inline_guidance.trim()) {
    parts.push(["# Inline Guidance", variant.inline_guidance.trim()].join("\n\n"));
  }
  for (const source of sourceContents) {
    parts.push([`# Source: ${source.path}`, source.content.trimEnd()].join("\n\n"));
  }
  return `${parts.join("\n\n---\n\n")}\n`;
}

function resolveGuidanceVariant(variant, { root }) {
  const source_contents = [
    ...readSourceFiles(root, variant.source_files),
    ...readGeneratedSources(variant.generated_sources),
  ];
  const guidance_text = renderVariantGuidance(variant, source_contents);
  return {
    ...variant,
    source_contents: source_contents.map(({ content, ...rest }) => rest),
    guidance_text,
    digest: {
      algorithm: "sha256",
      value: sha256(guidance_text),
      char_count: guidance_text.length,
    },
  };
}

function resolveGuidanceVariants({ root, variantsPath, variantIds = [] }) {
  const loaded = loadGuidanceVariantFile(variantsPath);
  const requested = variantIds.length > 0 ? new Set(variantIds) : null;
  const variants = loaded.variants
    .filter((variant) => !requested || requested.has(variant.variant_id))
    .map((variant) => resolveGuidanceVariant(variant, { root }));
  if (requested) {
    const resolved = new Set(variants.map((variant) => variant.variant_id));
    for (const id of requested) {
      if (!resolved.has(id)) throw new Error(`unknown guidance variant: ${id}`);
    }
  }
  return {
    schema_version: loaded.schema_version,
    path: loaded.path,
    variants,
  };
}

function defaultGuidanceVariantsPath(root) {
  return path.join(root, "benchmarks", "guidance-variants", "current.json");
}

module.exports = {
  defaultGuidanceVariantsPath,
  loadGuidanceVariantFile,
  resolveGuidanceVariant,
  resolveGuidanceVariants,
  sha256,
};
