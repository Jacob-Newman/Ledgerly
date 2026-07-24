import json
import unittest
from pathlib import Path

from ledgerly_api.analyzer import analyze_uploads


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str) -> tuple[str, bytes]:
    path = FIXTURES / name
    return name, path.read_bytes()


class AnalyzerTests(unittest.TestCase):
    def test_chase_and_amex_payment_is_excluded(self) -> None:
        result = analyze_uploads(
            [
                fixture("chase_checking_1234.csv"),
                fixture("amex_9876.csv"),
            ]
        )
        transfers = [
            tx
            for tx in result["transactions"]
            if "payment" in tx["description"].lower()
            or "american express" in tx["description"].lower()
        ]
        self.assertEqual(len(transfers), 2)
        self.assertTrue(all(tx["excluded"] for tx in transfers))
        self.assertEqual(len({tx["transfer_group_id"] for tx in transfers}), 1)
        self.assertEqual(result["summary"]["spend"], 263.27)

    def test_overlapping_upload_is_deduplicated(self) -> None:
        first = analyze_uploads([fixture("chase_checking_1234.csv")])
        second = analyze_uploads(
            [fixture("chase_checking_1234.csv")],
            json.dumps(first["transactions"]),
        )
        self.assertEqual(second["imports"][0]["rows_added"], 0)
        self.assertEqual(second["imports"][0]["duplicates_ignored"], 3)
        self.assertEqual(second["summary"]["transaction_count"], 3)

    def test_amex_purchase_sign_is_normalized_as_expense(self) -> None:
        result = analyze_uploads([fixture("amex_9876.csv")])
        trader_joes = next(
            tx for tx in result["transactions"] if "TRADER" in tx["description"]
        )
        self.assertEqual(trader_joes["amount"], -78.54)
        self.assertEqual(trader_joes["category"], "Groceries")

    def test_positive_credit_card_purchases_are_expenses(self) -> None:
        result = analyze_uploads(
            [fixture("generic_credit_positive.csv")],
            account_types_json=json.dumps(
                {"generic_credit_positive.csv": "credit"}
            ),
        )
        purchases = [
            transaction
            for transaction in result["transactions"]
            if not transaction["excluded"]
        ]
        self.assertTrue(all(transaction["amount"] < 0 for transaction in purchases))
        self.assertEqual(result["summary"]["spend"], 113.55)
        self.assertEqual(result["summary"]["income"], 0)


if __name__ == "__main__":
    unittest.main()
