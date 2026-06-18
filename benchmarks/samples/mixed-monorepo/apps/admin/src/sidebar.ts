import { canViewBilling } from "./permissions";

export function adminSidebar(role: "owner" | "billing" | "support") {
  return [
    { label: "Audit", href: "/admin/audit" },
    canViewBilling(role) ? { label: "Billing", href: "/admin/billing" } : null,
  ].filter(Boolean);
}
