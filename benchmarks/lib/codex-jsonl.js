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
    output_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
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

  for (const event of events) {
    const type = eventType(event);
    metrics.event_type_counts[type] = (metrics.event_type_counts[type] || 0) + 1;
    if (type === "unknown") metrics.unknown_event_types.push(type);

    const usage = usageFromEvent(event);
    if (usage) {
      metrics.codex_turn_count += 1;
      mergeUsage(metrics, usage);
    }

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
  finalTextFromEvents,
  modelFromEvent,
  parseJsonlLines,
  summarizeEvents,
  summarizeJsonl,
};
