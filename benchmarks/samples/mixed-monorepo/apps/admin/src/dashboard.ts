import { getBillingSummary } from "../../../services/billing/src/summary";
import { auditEvent } from "../../../packages/audit/src/events";

export function renderAdminDashboard() {
  const summary = getBillingSummary();
  auditEvent({ type: "admin.dashboard.viewed", accountId: summary.accountId });
  return {
    accountId: summary.accountId,
    balanceCents: summary.balanceCents,
  };
}
