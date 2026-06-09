import { auditEvent } from "../../../packages/audit/src/events";
import { getBillingSummary } from "../../../services/billing/src/summary";

export function registerAdminRoutes(app: { get: (route: string, handler: unknown) => void }) {
  app.get("/admin/audit", auditEvent);
  app.get("/admin/billing", getBillingSummary);
}
