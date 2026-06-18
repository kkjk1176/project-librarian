import { getBillingSummary } from "./summary";

export function listInvoices() {
  const summary = getBillingSummary();
  return [
    { id: "inv_001", accountId: summary.accountId, amountCents: summary.balanceCents },
  ];
}
