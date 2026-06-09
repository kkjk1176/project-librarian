export interface AuditEvent {
  actor: string;
  action: string;
  subject: string;
}

export function auditEvent(): AuditEvent {
  return {
    actor: "system",
    action: "benchmark",
    subject: "mixed-monorepo",
  };
}
