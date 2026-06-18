from summary import get_billing_summary


def ledger_entries():
    summary = get_billing_summary()
    return [{"account_id": summary["account_id"], "amount_cents": summary["balance_cents"]}]
