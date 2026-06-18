import { auditEvent } from "./events";

export function persistAuditEvent(event: { type: string; accountId?: string }) {
  auditEvent(event);
  return { persisted: true, type: event.type };
}
