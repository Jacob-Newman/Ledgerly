from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import uuid
from collections import defaultdict
from dataclasses import asdict, dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Iterable


CATEGORY_ORDER = [
    "Housing",
    "Groceries",
    "Dining",
    "Transportation",
    "Travel",
    "Shopping",
    "Utilities",
    "Health",
    "Entertainment",
    "Education",
    "Fees",
    "Income",
    "Transfers",
    "Other",
]

CATEGORY_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Housing", ("rent", "mortgage", "property management", "apartment")),
    (
        "Groceries",
        (
            "trader joe",
            "whole foods",
            "market basket",
            "stop & shop",
            "stop and shop",
            "wegmans",
            "hannaford",
            "aldi",
            "costco",
            "grocery",
            "supermarket",
        ),
    ),
    (
        "Dining",
        (
            "restaurant",
            "doordash",
            "uber eats",
            "grubhub",
            "starbucks",
            "dunkin",
            "mcdonald",
            "chipotle",
            "cafe",
            "pizza",
        ),
    ),
    (
        "Transportation",
        (
            "shell",
            "exxon",
            "mobil",
            "sunoco",
            "uber",
            "lyft",
            "parking",
            "toll",
            "mta",
            "gas station",
        ),
    ),
    (
        "Travel",
        (
            "airlines",
            "airways",
            "jetblue",
            "delta",
            "united",
            "southwest",
            "hotel",
            "airbnb",
            "hertz",
            "avis",
            "expedia",
        ),
    ),
    (
        "Shopping",
        (
            "amazon",
            "target",
            "walmart",
            "best buy",
            "home depot",
            "etsy",
            "merchandise",
            "retail",
        ),
    ),
    (
        "Utilities",
        (
            "national grid",
            "spectrum",
            "verizon",
            "at&t",
            "utility",
            "electric",
            "internet",
            "water bill",
        ),
    ),
    (
        "Health",
        (
            "walgreens",
            "cvs",
            "pharmacy",
            "medical",
            "dental",
            "hospital",
            "health",
        ),
    ),
    (
        "Entertainment",
        (
            "netflix",
            "spotify",
            "hulu",
            "cinema",
            "movie",
            "steam",
            "playstation",
            "xbox",
        ),
    ),
    ("Education", ("university", "college", "tuition", "textbook", "coursera")),
    ("Fees", ("fee", "interest charge", "late charge", "annual membership")),
]

TRANSFER_TERMS = (
    "payment thank you",
    "autopay payment",
    "card payment",
    "credit card payment",
    "online payment",
    "mobile payment",
    "payment received",
    "american express epay",
    "amex epay",
    "chase credit crd",
    "transfer to",
    "transfer from",
    "internal transfer",
    "online transfer",
    "zelle payment to",
)

INCOME_TERMS = (
    "direct deposit",
    "payroll",
    "salary",
    "interest paid",
    "ach credit",
)


@dataclass
class Transaction:
    id: str
    institution: str
    account_id: str
    account_name: str
    account_type: str
    date: str
    description: str
    amount: float
    category: str
    import_file: str
    excluded: bool = False
    exclusion_reason: str | None = None
    transfer_group_id: str | None = None


@dataclass
class ImportRecord:
    filename: str
    institution: str
    account_name: str
    account_type: str
    rows_read: int
    rows_added: int
    duplicates_ignored: int


def _clean_header(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lstrip("\ufeff")).lower()


def _parse_money(value: str | None) -> Decimal:
    raw = (value or "").strip()
    if not raw:
        return Decimal("0")
    negative_parentheses = raw.startswith("(") and raw.endswith(")")
    cleaned = re.sub(r"[^0-9.\-+]", "", raw)
    if not cleaned or cleaned in {"-", "+", ".", "-.", "+."}:
        return Decimal("0")
    try:
        amount = Decimal(cleaned)
    except InvalidOperation as exc:
        raise ValueError(f"Could not parse amount: {value!r}") from exc
    return -abs(amount) if negative_parentheses else amount


def _parse_date(value: str | None) -> date:
    raw = (value or "").strip()
    for pattern in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%m/%d/%Y %H:%M"):
        try:
            return datetime.strptime(raw, pattern).date()
        except ValueError:
            continue
    raise ValueError(f"Could not parse date: {value!r}")


def _normalize_description(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def _description_key(value: str) -> str:
    value = value.lower()
    value = re.sub(r"\b\d{4,}\b", "", value)
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def _last_four(filename: str, rows: list[dict[str, str]]) -> str | None:
    for row in rows[:5]:
        for key in ("account #", "account number", "card number"):
            value = row.get(key, "")
            digits = re.sub(r"\D", "", value)
            if len(digits) >= 4:
                return digits[-4:]
    matches = re.findall(r"(?<!\d)(\d{4})(?!\d)", Path(filename).stem)
    return matches[-1] if matches else None


def _detect_format(
    headers: set[str],
    filename: str,
    account_type_override: str | None = None,
) -> tuple[str, str, str, str]:
    lowered_name = filename.lower()
    if {"transaction date", "post date", "description", "amount"} <= headers:
        return "Chase", "credit", "Chase credit card", "negative_purchase"
    if {"posting date", "description", "amount"} <= headers and (
        "details" in headers or "balance" in headers
    ):
        account_type = "savings" if "saving" in lowered_name else "checking"
        label = "Chase savings" if account_type == "savings" else "Chase checking"
        return "Chase", account_type, label, "bank"
    if {"date", "description", "amount"} <= headers and (
        "card member" in headers or "account #" in headers
    ):
        return "American Express", "credit", "Amex credit card", "positive_purchase"
    if {"date", "description", "amount"} <= headers:
        if account_type_override in {"credit", "checking", "savings"}:
            account_type = account_type_override
        elif any(term in lowered_name for term in ("credit", "card", "amex")):
            account_type = "credit"
        else:
            account_type = "savings" if "saving" in lowered_name else "checking"
        label = "Credit card" if account_type == "credit" else account_type.title()
        convention = "infer_credit" if account_type == "credit" else "bank"
        return "Generic", account_type, label, convention
    raise ValueError(
        "Unsupported CSV columns. Expected a Chase, American Express, or "
        "generic Date/Description/Amount export."
    )


def _credit_sign_convention(
    rows: list[dict[str, str]],
    default: str,
) -> str:
    payment_amounts = [
        _parse_money(row.get("amount"))
        for row in rows
        if any(
            term in (row.get("description") or "").lower()
            for term in TRANSFER_TERMS
        )
        and row.get("amount")
    ]
    if payment_amounts:
        positive_payments = sum(amount > 0 for amount in payment_amounts)
        negative_payments = sum(amount < 0 for amount in payment_amounts)
        return (
            "negative_purchase"
            if positive_payments >= negative_payments
            else "positive_purchase"
        )
    if default != "infer_credit":
        return default
    purchase_amounts = [
        _parse_money(row.get("amount"))
        for row in rows
        if row.get("amount")
        and not any(
            term in (row.get("description") or "").lower()
            for term in TRANSFER_TERMS
        )
    ]
    positive_purchases = sum(amount > 0 for amount in purchase_amounts)
    negative_purchases = sum(amount < 0 for amount in purchase_amounts)
    return (
        "positive_purchase"
        if positive_purchases >= negative_purchases
        else "negative_purchase"
    )


def _canonical_source_category(raw: str, description: str, amount: Decimal) -> str:
    combined = f"{raw} {description}".lower()
    if amount > 0 and any(term in combined for term in INCOME_TERMS):
        return "Income"
    if any(term in combined for term in TRANSFER_TERMS):
        return "Transfers"
    source_rules = {
        "grocer": "Groceries",
        "restaurant": "Dining",
        "transport": "Transportation",
        "travel": "Travel",
        "lodging": "Travel",
        "merchandise": "Shopping",
        "shopping": "Shopping",
        "utility": "Utilities",
        "health": "Health",
        "medical": "Health",
        "entertain": "Entertainment",
        "education": "Education",
        "fee": "Fees",
        "rent": "Housing",
        "home": "Housing",
    }
    for needle, category in source_rules.items():
        if needle in raw.lower():
            return category
    for category, needles in CATEGORY_RULES:
        if any(needle in combined for needle in needles):
            return category
    return "Other"


def _fingerprint(transaction: Transaction) -> str:
    payload = "|".join(
        (
            transaction.institution.lower(),
            transaction.account_id.lower(),
            transaction.date,
            f"{transaction.amount:.2f}",
            _description_key(transaction.description),
        )
    )
    return hashlib.sha256(payload.encode()).hexdigest()


def _transaction_from_json(value: dict[str, Any]) -> Transaction:
    allowed = {field.name for field in Transaction.__dataclass_fields__.values()}
    clean = {key: item for key, item in value.items() if key in allowed}
    return Transaction(**clean)


def parse_csv(
    filename: str,
    content: bytes,
    account_type_override: str | None = None,
) -> tuple[list[Transaction], ImportRecord]:
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("cp1252")
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        raise ValueError(f"{filename} is empty or has no header row.")

    normalized_rows: list[dict[str, str]] = []
    for original in reader:
        normalized_rows.append(
            {
                _clean_header(key): (value or "").strip()
                for key, value in original.items()
                if key is not None
            }
        )
    headers = {_clean_header(header) for header in reader.fieldnames}
    institution, account_type, base_account_name, sign_convention = _detect_format(
        headers,
        filename,
        account_type_override,
    )
    if account_type == "credit":
        sign_convention = _credit_sign_convention(normalized_rows, sign_convention)
    suffix = _last_four(filename, normalized_rows)
    account_name = f"{base_account_name} •{suffix}" if suffix else base_account_name
    account_id = f"{institution}:{account_type}:{suffix or 'default'}"

    transactions: list[Transaction] = []
    for index, row in enumerate(normalized_rows):
        date_value = (
            row.get("transaction date")
            or row.get("posting date")
            or row.get("date")
        )
        description = _normalize_description(
            row.get("description")
            or row.get("appears on your statement as")
            or "Unlabeled transaction"
        )
        if not date_value or not description:
            continue
        parsed_date = _parse_date(date_value)
        raw_amount = _parse_money(row.get("amount"))
        if account_type == "credit" and sign_convention == "positive_purchase":
            amount = -raw_amount
        else:
            amount = raw_amount
        source_category = row.get("category", "")
        category = _canonical_source_category(source_category, description, amount)
        stable_id = hashlib.sha256(
            f"{filename}|{index}|{parsed_date}|{description}|{amount}".encode()
        ).hexdigest()[:16]
        transactions.append(
            Transaction(
                id=stable_id,
                institution=institution,
                account_id=account_id,
                account_name=account_name,
                account_type=account_type,
                date=parsed_date.isoformat(),
                description=description,
                amount=float(amount.quantize(Decimal("0.01"), ROUND_HALF_UP)),
                category=category,
                import_file=filename,
            )
        )

    return transactions, ImportRecord(
        filename=filename,
        institution=institution,
        account_name=account_name,
        account_type=account_type,
        rows_read=len(normalized_rows),
        rows_added=0,
        duplicates_ignored=0,
    )


def _is_transfer_description(description: str) -> bool:
    lowered = description.lower()
    return any(term in lowered for term in TRANSFER_TERMS)


def mark_transfers(transactions: list[Transaction]) -> None:
    unmatched = [
        tx
        for tx in transactions
        if not tx.excluded and abs(tx.amount) > 0 and tx.category == "Transfers"
    ]
    unmatched.sort(key=lambda tx: tx.date)
    used: set[str] = set()

    for tx in unmatched:
        if tx.id in used:
            continue
        tx_date = date.fromisoformat(tx.date)
        candidates: list[tuple[int, Transaction]] = []
        for other in transactions:
            if (
                other.id == tx.id
                or other.id in used
                or other.account_id == tx.account_id
                or other.excluded
                or round(tx.amount + other.amount, 2) != 0
            ):
                continue
            day_gap = abs((date.fromisoformat(other.date) - tx_date).days)
            if day_gap <= 5 and (
                _is_transfer_description(tx.description)
                or _is_transfer_description(other.description)
                or {tx.account_type, other.account_type} >= {"credit", "checking"}
            ):
                candidates.append((day_gap, other))
        if candidates:
            _, other = min(candidates, key=lambda pair: pair[0])
            group_id = uuid.uuid4().hex[:12]
            for matched in (tx, other):
                matched.excluded = True
                matched.category = "Transfers"
                matched.transfer_group_id = group_id
                matched.exclusion_reason = (
                    f"Matched transfer between {tx.account_name} and "
                    f"{other.account_name}"
                )
                used.add(matched.id)
        else:
            tx.excluded = True
            tx.exclusion_reason = "Likely card payment or account transfer"


def _summary(transactions: Iterable[Transaction]) -> dict[str, Any]:
    included = [tx for tx in transactions if not tx.excluded]
    expenses = [tx for tx in included if tx.amount < 0]
    income = [
        tx
        for tx in included
        if tx.amount > 0 and tx.account_type in {"checking", "savings"}
    ]
    spend = round(sum(-tx.amount for tx in expenses), 2)
    income_total = round(sum(tx.amount for tx in income), 2)
    category_totals: dict[str, float] = defaultdict(float)
    for tx in expenses:
        category_totals[tx.category] += -tx.amount
    categories = [
        {
            "name": category,
            "amount": round(category_totals[category], 2),
            "percent": round(
                category_totals[category] / spend * 100 if spend else 0, 1
            ),
        }
        for category in CATEGORY_ORDER
        if category_totals[category] > 0
    ]
    categories.sort(key=lambda item: item["amount"], reverse=True)
    return {
        "spend": spend,
        "income": income_total,
        "saved": round(income_total - spend, 2),
        "categories": categories,
        "transaction_count": len(transactions),
        "excluded_count": sum(tx.excluded for tx in transactions),
    }


def analyze_uploads(
    uploads: list[tuple[str, bytes]],
    existing_json: str | None = None,
    account_types_json: str | None = None,
) -> dict[str, Any]:
    existing: list[Transaction] = []
    if existing_json:
        parsed = json.loads(existing_json)
        existing = [_transaction_from_json(item) for item in parsed]

    seen = {_fingerprint(tx) for tx in existing}
    combined = list(existing)
    imports: list[ImportRecord] = []
    account_types = json.loads(account_types_json) if account_types_json else {}
    if not isinstance(account_types, dict):
        raise ValueError("Account types must be a filename-to-type mapping.")

    for filename, content in uploads:
        account_type_override = account_types.get(filename)
        if account_type_override not in {None, "credit", "checking", "savings"}:
            raise ValueError(f"Unsupported account type for {filename}.")
        parsed_transactions, import_record = parse_csv(
            filename,
            content,
            account_type_override,
        )
        for transaction in parsed_transactions:
            fingerprint = _fingerprint(transaction)
            if fingerprint in seen:
                import_record.duplicates_ignored += 1
                continue
            seen.add(fingerprint)
            combined.append(transaction)
            import_record.rows_added += 1
        imports.append(import_record)

    for transaction in combined:
        if transaction.category == "Transfers":
            transaction.excluded = False
            transaction.exclusion_reason = None
            transaction.transfer_group_id = None
    mark_transfers(combined)
    combined.sort(key=lambda tx: (tx.date, tx.id), reverse=True)

    return {
        "summary": _summary(combined),
        "transactions": [asdict(tx) for tx in combined],
        "imports": [asdict(item) for item in imports],
        "supported_formats": [
            "Chase checking",
            "Chase savings",
            "Chase credit cards",
            "American Express credit cards",
            "Generic Date/Description/Amount CSV",
        ],
    }
