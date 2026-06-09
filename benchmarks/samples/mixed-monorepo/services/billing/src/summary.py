from dataclasses import dataclass


@dataclass
class BillingSummary:
    account_id: str
    balance_cents: int


def get_billing_summary(account_id: str = "benchmark") -> BillingSummary:
    return BillingSummary(account_id=account_id, balance_cents=4200)
