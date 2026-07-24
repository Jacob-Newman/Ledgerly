export type AccountType = "checking" | "savings" | "credit";
export type AccountTypeChoice = AccountType;

export type Category =
  | "Housing"
  | "Groceries"
  | "Dining"
  | "Transportation"
  | "Travel"
  | "Shopping"
  | "Utilities"
  | "Health"
  | "Entertainment"
  | "Education"
  | "Fees"
  | "Income"
  | "Transfers"
  | "Other";

export type Transaction = {
  id: string;
  institution: string;
  account_id: string;
  account_name: string;
  account_type: AccountType;
  date: string;
  description: string;
  amount: number;
  category: Category;
  import_file: string;
  excluded: boolean;
  exclusion_reason: string | null;
  transfer_group_id: string | null;
};

export type ImportRecord = {
  filename: string;
  institution: string;
  account_name: string;
  account_type: AccountType;
  rows_read: number;
  rows_added: number;
  duplicates_ignored: number;
};

export type AnalysisResult = {
  summary: {
    spend: number;
    income: number;
    saved: number;
    categories: { name: string; amount: number; percent: number }[];
    transaction_count: number;
    excluded_count: number;
  };
  transactions: Transaction[];
  imports: ImportRecord[];
  supported_formats: string[];
};

export const CATEGORY_ORDER: Category[] = [
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
];

export const SUPPORTED_FORMATS = [
  "Chase checking and savings",
  "Chase credit cards",
  "American Express credit cards",
  "Generic Date/Description/Amount CSV",
];

export function emptyResult(): AnalysisResult {
  return {
    summary: {
      spend: 0,
      income: 0,
      saved: 0,
      categories: [],
      transaction_count: 0,
      excluded_count: 0,
    },
    transactions: [],
    imports: [],
    supported_formats: SUPPORTED_FORMATS,
  };
}

export function summarize(transactions: Transaction[]) {
  const included = transactions.filter((transaction) => !transaction.excluded);
  const expenses = included.filter((transaction) => transaction.amount < 0);
  const income = included.filter(
    (transaction) =>
      transaction.amount > 0 &&
      ["checking", "savings"].includes(transaction.account_type),
  );
  const spend =
    Math.round(
      expenses.reduce((total, transaction) => total - transaction.amount, 0) * 100,
    ) / 100;
  const incomeTotal =
    Math.round(
      income.reduce((total, transaction) => total + transaction.amount, 0) * 100,
    ) / 100;
  const categoryTotals = new Map<string, number>();
  for (const transaction of expenses) {
    categoryTotals.set(
      transaction.category,
      (categoryTotals.get(transaction.category) || 0) - transaction.amount,
    );
  }
  const categories = [...categoryTotals.entries()]
    .map(([name, amount]) => ({
      name,
      amount: Math.round(amount * 100) / 100,
      percent: spend ? Math.round((amount / spend) * 1000) / 10 : 0,
    }))
    .sort((left, right) => right.amount - left.amount);
  return {
    spend,
    income: incomeTotal,
    saved: Math.round((incomeTotal - spend) * 100) / 100,
    categories,
    transaction_count: transactions.length,
    excluded_count: transactions.filter((transaction) => transaction.excluded).length,
  };
}
