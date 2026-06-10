"use strict";

function parseJsonlLines(content) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        const wrapped = new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
        wrapped.cause = error;
        throw wrapped;
      }
    });
}

function numberValue(value) {
  return Number.isFinite(value) ? value : 0;
}

function usageFromEvent(event) {
  if (event && typeof event === "object" && event.usage && typeof event.usage === "object") {
    return event.usage;
  }
  if (event && typeof event === "object" && event.message && event.message.usage && typeof event.message.usage === "object") {
    return event.message.usage;
  }
  if (event && typeof event === "object" && event.item && event.item.usage && typeof event.item.usage === "object") {
    return event.item.usage;
  }
  if (event && typeof event === "object" && event.response && event.response.usage && typeof event.response.usage === "object") {
    return event.response.usage;
  }
  return null;
}

function eventType(event) {
  if (!event || typeof event !== "object") return "unknown";
  if (typeof event.type === "string") return event.type;
  if (typeof event.event === "string") return event.event;
  return "unknown";
}

function modelFromEvent(event) {
  if (!event || typeof event !== "object") return "";
  if (typeof event.model === "string") return event.model;
  if (event.message && typeof event.message.model === "string") return event.message.model;
  if (event.item && typeof event.item.model === "string") return event.item.model;
  if (event.response && typeof event.response.model === "string") return event.response.model;
  return "";
}

function timestampValue(value) {
  if (Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  if (typeof value !== "string" || !value.trim()) return NaN;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return timestampValue(numeric);
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function eventTimestampMs(event) {
  if (!event || typeof event !== "object") return NaN;
  for (const key of ["timestamp", "time", "created_at", "createdAt", "completed_at", "completedAt"]) {
    const value = timestampValue(event[key]);
    if (Number.isFinite(value)) return value;
  }
  if (event.item && typeof event.item === "object") {
    for (const key of ["timestamp", "time", "created_at", "createdAt", "completed_at", "completedAt"]) {
      const value = timestampValue(event.item[key]);
      if (Number.isFinite(value)) return value;
    }
  }
  return NaN;
}

// Tool-output bytes (A4): Codex JSONL captures command/tool stdout+stderr in the
// `aggregated_output` string field of a `command_execution` item, populated on the
// `item.completed` event (the `item.started` event carries an empty in-progress
// string). We count the UTF-8 byte length of that field on COMPLETED command/tool
// items only, so a started/completed pair is never double counted. This exactly
// reproduces the published per-run tool-output volumes in the canonical trace
// analysis (medium with-condition 73,487 bytes, large control 168,751 bytes, etc.).
// We also accept the generic `output`/`stdout`/`result` string fields on a
// command/tool item or event as a forward-compatible fallback, but never sum more
// than one field for the same event. No field present means zero bytes, not a guess.
const TOOL_OUTPUT_FIELDS = ["aggregated_output", "output", "stdout", "result"];

function toolOutputTextForEvent(event) {
  if (!event || typeof event !== "object") return null;
  const classification = classifyEvent(event);
  if (!classification.isCommand && !classification.isTool) return null;
  // Only count the terminal (completed) event of a started/completed pair.
  if (isStartEvent(event) && !isCompletionEvent(event)) return null;
  const carriers = [event.item, event.call, event];
  for (const carrier of carriers) {
    if (!carrier || typeof carrier !== "object") continue;
    for (const field of TOOL_OUTPUT_FIELDS) {
      const value = carrier[field];
      if (typeof value === "string") return value;
    }
  }
  return null;
}

function classifyEvent(event) {
  const type = eventType(event).toLowerCase();
  const name = typeof event?.name === "string" ? event.name.toLowerCase() : "";
  const itemType = typeof event?.item?.type === "string" ? event.item.type.toLowerCase() : "";
  const toolName = typeof event?.tool === "string" ? event.tool.toLowerCase() : "";
  const callType = typeof event?.call?.type === "string" ? event.call.type.toLowerCase() : "";
  const subtype = typeof event?.subtype === "string" ? event.subtype.toLowerCase() : "";
  const combined = [type, name, itemType, toolName, callType, subtype].filter(Boolean).join(" ");

  return {
    isTurn: Boolean(usageFromEvent(event)) || combined.includes("turn"),
    isCommand: combined.includes("command") || combined.includes("exec") || combined.includes("shell"),
    isTool: combined.includes("tool") || combined.includes("function_call"),
    isMcp: combined.includes("mcp"),
    isPlan: combined.includes("plan") || combined.includes("update_plan"),
    isFileChange: combined.includes("file_change") || combined.includes("patch") || combined.includes("apply_patch"),
    isError: combined.includes("error") || event?.error,
  };
}

function isStartEvent(event) {
  const type = eventType(event).toLowerCase();
  const subtype = typeof event?.subtype === "string" ? event.subtype.toLowerCase() : "";
  const status = typeof event?.status === "string" ? event.status.toLowerCase() : "";
  const combined = [type, subtype, status].filter(Boolean).join(" ");
  return combined.includes("started") || combined.includes("start") || combined.includes("begin") || combined.includes("running");
}

function isCompletionEvent(event) {
  const type = eventType(event).toLowerCase();
  const subtype = typeof event?.subtype === "string" ? event.subtype.toLowerCase() : "";
  const status = typeof event?.status === "string" ? event.status.toLowerCase() : "";
  const combined = [type, subtype, status].filter(Boolean).join(" ");
  return combined.includes("completed") || combined.includes("complete") || combined.includes("finished") || combined.includes("failed") || combined.includes("end") || combined.includes("output") || combined.includes("result");
}

function isInvocationEvent(event) {
  return isStartEvent(event) || !isCompletionEvent(event);
}

// A provider turn/request boundary that has completed. Codex emits `turn.completed`
// (and historically `turn.ended`) once per `codex exec` request. We match a turn
// type combined with a completion marker, OR a usage-bearing turn event (the
// `turn.completed` payload carries `usage`). This is narrower than isCompletionEvent
// on purpose: command/tool completions and message outputs are not request units.
function isTurnCompletionEvent(event) {
  if (!event || typeof event !== "object") return false;
  const type = eventType(event).toLowerCase();
  if (!type.includes("turn")) return false;
  return isCompletionEvent(event) || Boolean(usageFromEvent(event));
}

function textFromValue(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(textFromValue).filter(Boolean).join("\n");
  if (!value || typeof value !== "object") return "";
  if (typeof value.text === "string") return value.text;
  if (typeof value.content === "string") return value.content;
  if (Array.isArray(value.content)) return textFromValue(value.content);
  if (typeof value.message === "string") return value.message;
  if (value.message && typeof value.message === "object") return textFromValue(value.message);
  return "";
}

function finalTextFromEvents(events) {
  const candidates = [];
  for (const event of events) {
    const type = eventType(event).toLowerCase();
    const itemType = typeof event?.item?.type === "string" ? event.item.type.toLowerCase() : "";
    if (type.includes("assistant") || type.includes("message") || type.includes("turn.completed") || itemType.includes("message")) {
      const text = textFromValue(event.message) || textFromValue(event.item) || textFromValue(event.response) || textFromValue(event);
      if (text) candidates.push(text);
    }
  }
  return candidates.at(-1) || "";
}

function isResponseTextEvent(event) {
  const type = eventType(event).toLowerCase();
  const itemType = typeof event?.item?.type === "string" ? event.item.type.toLowerCase() : "";
  if (!(type.includes("assistant") || type.includes("message") || itemType.includes("agent_message") || itemType.includes("message"))) return false;
  return Boolean(textFromValue(event.message) || textFromValue(event.item) || textFromValue(event.response) || textFromValue(event));
}

function mergeUsage(target, usage) {
  target.input_tokens += numberValue(usage.input_tokens);
  target.cached_input_tokens += numberValue(usage.cached_input_tokens);
  target.output_tokens += numberValue(usage.output_tokens);
  target.reasoning_output_tokens += numberValue(usage.reasoning_output_tokens);
  target.total_tokens += numberValue(usage.total_tokens);
}

function summarizeEvents(events, timing = {}) {
  const models = [...new Set(events.map(modelFromEvent).filter(Boolean))];
  const eventTimestamps = events.map(eventTimestampMs).filter(Number.isFinite);
  const firstEventTimestamp = eventTimestamps.length > 0 ? Math.min(...eventTimestamps) : NaN;
  const firstResponseTimestamp = Number.isFinite(firstEventTimestamp)
    ? events.map((event) => isResponseTextEvent(event) ? eventTimestampMs(event) : NaN).filter(Number.isFinite).at(0)
    : NaN;
  const metrics = {
    input_tokens: 0,
    cached_input_tokens: 0,
    uncached_input_tokens: 0,
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    tool_output_bytes: 0,
    request_count_estimate: 0,
    wall_ms: numberValue(timing.wall_ms),
    first_response_ms: 0,
    tokens_per_second: 0,
    codex_turn_count: 0,
    jsonl_event_count: events.length,
    command_event_count: 0,
    command_invocation_count: 0,
    tool_event_count: 0,
    tool_invocation_count: 0,
    mcp_event_count: 0,
    mcp_invocation_count: 0,
    plan_event_count: 0,
    file_change_event_count: 0,
    error_event_count: 0,
    event_type_counts: {},
    unknown_event_types: [],
    model: models.length === 1 ? models[0] : "",
    models,
    final_text: finalTextFromEvents(events),
    unavailable_event_fields: [],
  };

  // request_count_estimate source (A4): the count of provider turn-completion
  // events (`turn.completed`/`turn.ended`), which are the request/turn boundaries
  // a non-interactive `codex exec` emits (one per provider request). We count
  // completed turn boundaries rather than usage-bearing events so the estimate
  // stays a turn/request signal even if a provider stops attaching usage. If the
  // JSONL exposes no turn-boundary event at all, the field is recorded as
  // unavailable below rather than guessed from command/tool counts.
  let turnCompletionEventCount = 0;
  for (const event of events) {
    const type = eventType(event);
    metrics.event_type_counts[type] = (metrics.event_type_counts[type] || 0) + 1;
    if (type === "unknown") metrics.unknown_event_types.push(type);

    const usage = usageFromEvent(event);
    if (usage) {
      metrics.codex_turn_count += 1;
      mergeUsage(metrics, usage);
    }

    if (isTurnCompletionEvent(event)) turnCompletionEventCount += 1;

    const toolOutputText = toolOutputTextForEvent(event);
    if (toolOutputText !== null) metrics.tool_output_bytes += Buffer.byteLength(toolOutputText, "utf8");

    const classification = classifyEvent(event);
    if (classification.isCommand) metrics.command_event_count += 1;
    if (classification.isTool) metrics.tool_event_count += 1;
    if (classification.isMcp) metrics.mcp_event_count += 1;
    if (classification.isPlan) metrics.plan_event_count += 1;
    if (classification.isCommand && isInvocationEvent(event)) metrics.command_invocation_count += 1;
    if (classification.isTool && isInvocationEvent(event)) metrics.tool_invocation_count += 1;
    if (classification.isMcp && isInvocationEvent(event)) metrics.mcp_invocation_count += 1;
    if (classification.isFileChange) metrics.file_change_event_count += 1;
    if (classification.isError) metrics.error_event_count += 1;
  }

  if (metrics.total_tokens === 0) {
    metrics.total_tokens = metrics.input_tokens + metrics.output_tokens;
  }

  // Uncached input (A4) = input_tokens - cached_input_tokens. Cached input that
  // exceeds total input is corrupt usage data, not a clampable edge: fail loudly so
  // a malformed transcript never silently produces a zero-floored derived field.
  // Equal cached/input (a fully cached resend) legitimately yields zero.
  if (metrics.cached_input_tokens > metrics.input_tokens) {
    throw new Error(`corrupt usage: cached_input_tokens (${metrics.cached_input_tokens}) exceeds input_tokens (${metrics.input_tokens})`);
  }
  metrics.uncached_input_tokens = metrics.input_tokens - metrics.cached_input_tokens;

  // request_count_estimate from completed turn boundaries (see isTurnCompletionEvent).
  metrics.request_count_estimate = turnCompletionEventCount;

  if (metrics.wall_ms > 0) {
    metrics.tokens_per_second = Math.round((metrics.output_tokens / (metrics.wall_ms / 1000)) * 1000) / 1000;
  }
  if (Number.isFinite(firstEventTimestamp) && Number.isFinite(firstResponseTimestamp)) {
    metrics.first_response_ms = Math.max(0, Math.round((firstResponseTimestamp - firstEventTimestamp) * 1000) / 1000);
  }

  if (metrics.command_event_count > 0 && metrics.command_invocation_count === 0) {
    metrics.command_invocation_count = metrics.command_event_count;
  }
  if (metrics.tool_event_count > 0 && metrics.tool_invocation_count === 0) {
    metrics.tool_invocation_count = metrics.tool_event_count;
  }
  if (metrics.mcp_event_count > 0 && metrics.mcp_invocation_count === 0) {
    metrics.mcp_invocation_count = metrics.mcp_event_count;
  }

  if (events.length > 0 && !events.some((event) => usageFromEvent(event))) {
    metrics.unavailable_event_fields.push("usage");
  }
  // No turn-boundary event means the provider exposed nothing usable to estimate
  // the request count from; record it as unavailable rather than guessing (A4).
  if (events.length > 0 && turnCompletionEventCount === 0) {
    metrics.unavailable_event_fields.push("request_count");
  }
  if (events.length > 0 && !metrics.final_text) {
    metrics.unavailable_event_fields.push("final_text");
  }
  if (events.length > 0 && metrics.models.length === 0) {
    metrics.unavailable_event_fields.push("model");
  }
  if (events.length > 0 && !Number.isFinite(firstResponseTimestamp)) {
    metrics.unavailable_event_fields.push("first_response_latency");
  }
  if (metrics.models.length > 1) {
    metrics.unavailable_event_fields.push("single_model");
  }

  return metrics;
}

function summarizeJsonl(content, timing = {}) {
  return summarizeEvents(parseJsonlLines(content), timing);
}

module.exports = {
  classifyEvent,
  eventTimestampMs,
  finalTextFromEvents,
  isTurnCompletionEvent,
  modelFromEvent,
  parseJsonlLines,
  summarizeEvents,
  summarizeJsonl,
  toolOutputTextForEvent,
};
