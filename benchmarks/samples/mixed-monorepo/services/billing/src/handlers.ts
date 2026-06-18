import { getBillingSummary } from "./summary";
import { listInvoices } from "./invoice";

export function registerBillingRoutes(app: { get: (route: string, handler: unknown) => void }) {
  app.get("/billing/summary", getBillingSummary);
  app.get("/billing/invoices", listInvoices);
}
