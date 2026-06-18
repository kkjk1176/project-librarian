export type AdminRole = "owner" | "billing" | "support";

export function canViewBilling(role: AdminRole): boolean {
  return role === "owner" || role === "billing";
}

export function canReplayAudit(role: AdminRole): boolean {
  return role === "owner";
}
