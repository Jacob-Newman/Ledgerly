import {
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  FileCheck2,
  FileText,
  Home,
  Landmark,
  LockKeyhole,
  LogOut,
  Menu,
  PiggyBank,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  Trash2,
  TrendingDown,
  UploadCloud,
  Utensils,
  WalletCards,
  X,
  Zap,
} from "lucide-react";
import {
  CATEGORY_ORDER,
  emptyResult,
  summarize,
  type AccountTypeChoice,
  type AnalysisResult,
  type Category,
  type ImportRecord,
  type Transaction,
} from "./types";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthScreen } from "./AuthScreen";
import { isSupabaseConfigured, supabase } from "./lib/supabase";

type View = "overview" | "transactions" | "imports";

const CATEGORY_COLORS: Record<string, string> = {
  Housing: "#173d33",
  Groceries: "#809b80",
  Dining: "#dfa221",
  Transportation: "#71948a",
  Travel: "#dfd2b8",
  Shopping: "#b56e4b",
  Utilities: "#ef5b2a",
  Health: "#a5a66a",
  Entertainment: "#b27aa2",
  Education: "#638195",
  Fees: "#8d756a",
  Income: "#4f7d68",
  Transfers: "#77877b",
  Other: "#aaa397",
};

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const exactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

type QueuedFile = {
  file: File;
  accountType: AccountTypeChoice;
};

function suggestedAccountType(filename: string): AccountTypeChoice {
  const normalized = filename.toLowerCase();
  if (normalized.includes("saving")) return "savings";
  if (
    normalized.includes("checking") ||
    normalized.includes("bank") ||
    normalized.includes("deposit")
  ) {
    return "checking";
  }
  return "credit";
}

function categoryIcon(category: string) {
  const props = { size: 19, strokeWidth: 1.8 };
  if (category === "Groceries") return <ShoppingBasket {...props} />;
  if (category === "Dining") return <Utensils {...props} />;
  if (category === "Utilities") return <Zap {...props} />;
  if (category === "Housing") return <Building2 {...props} />;
  if (category === "Transfers") return <ArrowLeftRight {...props} />;
  if (category === "Income") return <CircleDollarSign {...props} />;
  return <ReceiptText {...props} />;
}

function SummaryCard({
  label,
  value,
  note,
  icon,
  tone,
}: {
  label: string;
  value: number;
  note: string;
  icon: ReactNode;
  tone: "spend" | "income" | "saved";
}) {
  return (
    <article className={`summary-card ${tone}`}>
      <div>
        <p>{label}</p>
        <strong>{currency.format(value)}</strong>
        <span>{note}</span>
      </div>
      <div className="summary-icon">{icon}</div>
    </article>
  );
}

function TransactionRow({
  transaction,
  compact = false,
  onCategoryChange,
}: {
  transaction: Transaction;
  compact?: boolean;
  onCategoryChange?: (id: string, category: Category) => void;
}) {
  return (
    <div className={`transaction-row ${compact ? "compact" : ""}`}>
      <div
        className="category-icon"
        style={{
          color: CATEGORY_COLORS[transaction.category],
          background: `${CATEGORY_COLORS[transaction.category]}18`,
        }}
      >
        {categoryIcon(transaction.category)}
      </div>
      <div className="transaction-copy">
        <strong>{transaction.description}</strong>
        <span>
          {dateFormatter.format(new Date(`${transaction.date}T00:00:00Z`))}
          {!compact && ` · ${transaction.account_name}`}
        </span>
      </div>
      <div className="transaction-amount">
        <strong className={transaction.amount > 0 ? "positive" : ""}>
          {transaction.amount > 0 ? "+" : ""}
          {exactCurrency.format(transaction.amount)}
        </strong>
        {transaction.excluded ? (
          <span className="matched-badge" title={transaction.exclusion_reason || undefined}>
            <Check size={12} strokeWidth={2.5} />
            Matched · excluded
          </span>
        ) : onCategoryChange && transaction.amount < 0 ? (
          <label className="category-select-label">
            <span className="sr-only">Category for {transaction.description}</span>
            <select
              value={transaction.category}
              onChange={(event) =>
                onCategoryChange(transaction.id, event.target.value as Category)
              }
            >
              {CATEGORY_ORDER.filter((category) => category !== "Income").map((category) => (
                <option key={category}>{category}</option>
              ))}
            </select>
            <ChevronDown size={13} aria-hidden="true" />
          </label>
        ) : (
          <span style={{ color: CATEGORY_COLORS[transaction.category] }}>
            {transaction.category}
          </span>
        )}
      </div>
    </div>
  );
}

function ImportModal({
  open,
  onClose,
  onImported,
  existingTransactions,
}: {
  open: boolean;
  onClose: () => void;
  onImported: (result: AnalysisResult) => Promise<void>;
  existingTransactions: Transaction[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<QueuedFile[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const addFiles = (incoming: File[]) => {
    const csvs = incoming.filter((file) => file.name.toLowerCase().endsWith(".csv"));
    setFiles((current) => {
      const keys = new Set(
        current.map(({ file }) => `${file.name}:${file.size}`),
      );
      return [
        ...current,
        ...csvs
          .filter((file) => !keys.has(`${file.name}:${file.size}`))
          .map((file) => ({
            file,
            accountType: suggestedAccountType(file.name),
          })),
      ];
    });
    if (csvs.length !== incoming.length) setError("Only CSV exports can be imported.");
    else setError(null);
  };

  const analyze = async () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    files.forEach(({ file }) => form.append("files", file));
    form.append(
      "account_types",
      JSON.stringify(
        Object.fromEntries(
          files.map(({ file, accountType }) => [file.name, accountType]),
        ),
      ),
    );
    if (existingTransactions.length) {
      form.append("existing", JSON.stringify(existingTransactions));
    }
    try {
      const response = await fetch("/api/analyze", { method: "POST", body: form });
      const body = (await response.json()) as AnalysisResult & { detail?: string };
      if (!response.ok) throw new Error(body.detail || "Could not analyze those statements.");
      await onImported(body as AnalysisResult);
      setFiles([]);
      onClose();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not analyze those statements.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="import-title">
      <button className="modal-scrim" onClick={onClose} aria-label="Close import dialog" />
      <section className="import-modal">
        <div className="modal-heading">
          <div>
            <span className="eyebrow">SESSION IMPORT</span>
            <h2 id="import-title">Bring your statements together</h2>
            <p>
              Add exports from Chase, American Express, or any CSV with date,
              description, and amount columns.
            </p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <button
          className={`drop-zone ${dragging ? "dragging" : ""}`}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            addFiles(Array.from(event.dataTransfer.files));
          }}
        >
          <input
            ref={inputRef}
            hidden
            multiple
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => addFiles(Array.from(event.target.files || []))}
          />
          <span className="upload-mark">
            <UploadCloud size={28} />
          </span>
          <strong>Drop CSV statements here</strong>
          <span>or click to choose multiple files</span>
          <small>Up to 10 MB per file · nothing is stored</small>
        </button>

        {files.length > 0 && (
          <div className="file-queue">
            <div className="file-queue-title">
              <strong>{files.length} statement{files.length === 1 ? "" : "s"} ready</strong>
              <button onClick={() => setFiles([])}>Clear</button>
            </div>
            {files.map(({ file, accountType }, index) => (
              <div className="queued-file" key={`${file.name}:${file.size}`}>
                <FileCheck2 size={18} />
                <div>
                  <strong>{file.name}</strong>
                  <span>{(file.size / 1024).toFixed(1)} KB</span>
                </div>
                <label className="account-type-select">
                  <span>Treat as</span>
                  <select
                    value={accountType}
                    onChange={(event) =>
                      setFiles((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                accountType: event.target
                                  .value as AccountTypeChoice,
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="credit">Credit card</option>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                  </select>
                </label>
                <button
                  onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && <div className="import-error">{error}</div>}

        <div className="modal-security">
          <ShieldCheck size={18} />
          <p>
            CSV files are analyzed for this import and then discarded. Ledgerly
            never asks for bank credentials or stores the original file.
          </p>
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={!files.length || busy} onClick={analyze}>
            {busy ? <span className="spinner" /> : <Sparkles size={17} />}
            {busy ? "Analyzing…" : "Analyze statements"}
          </button>
        </div>
      </section>
    </div>
  );
}

export default function HomePage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured);
  const [loadingLedger, setLoadingLedger] = useState(false);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [data, setData] = useState<AnalysisResult>(() => emptyResult());
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [showExcluded, setShowExcluded] = useState(true);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setAuthReady(true);
      }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setData(emptyResult());
      return;
    }
    let active = true;
    setLoadingLedger(true);
    setPersistenceError(null);
    void Promise.all([
      supabase.from("transactions").select("*").order("date", { ascending: false }),
      supabase.from("imports").select("filename,institution,account_name,account_type,rows_read,rows_added,duplicates_ignored").order("created_at", { ascending: false }),
    ]).then(([transactionsResult, importsResult]) => {
      if (!active) return;
      if (transactionsResult.error || importsResult.error) {
        setPersistenceError(transactionsResult.error?.message || importsResult.error?.message || "Could not load your saved data.");
      } else {
        const transactions = (transactionsResult.data || []) as Transaction[];
        const imports = (importsResult.data || []) as ImportRecord[];
        setData({ ...emptyResult(), transactions, imports, summary: summarize(transactions) });
      }
      setLoadingLedger(false);
    });
    return () => { active = false; };
  }, [session]);

  const filteredTransactions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return data.transactions.filter((transaction) => {
      const queryMatch =
        !normalizedQuery ||
        transaction.description.toLowerCase().includes(normalizedQuery) ||
        transaction.account_name.toLowerCase().includes(normalizedQuery);
      const categoryMatch =
        categoryFilter === "All categories" || transaction.category === categoryFilter;
      const excludedMatch = showExcluded || !transaction.excluded;
      return queryMatch && categoryMatch && excludedMatch;
    });
  }, [categoryFilter, data.transactions, query, showExcluded]);

  const selectView = (next: View) => {
    setView(next);
    setMobileNavOpen(false);
  };

  const handleImported = async (result: AnalysisResult) => {
    if (!session) throw new Error("Sign in before importing statements.");
    setPersistenceError(null);
    const transactionRows = result.transactions.map((transaction) => ({
      ...transaction,
      user_id: session.user.id,
      updated_at: new Date().toISOString(),
    }));
    const importsRows = result.imports.map((item) => ({ ...item, user_id: session.user.id }));
    const { error: transactionError } = await supabase
      .from("transactions")
      .upsert(transactionRows, { onConflict: "user_id,id" });
    if (transactionError) throw new Error(transactionError.message);
    const { error: importsError } = await supabase.from("imports").insert(importsRows);
    if (importsError) throw new Error(importsError.message);
    setData((current) => ({
      ...result,
      imports: [...current.imports, ...result.imports],
    }));
    setView("overview");
  };

  const recategorize = async (id: string, category: Category) => {
    if (!session) return;
    const { error } = await supabase
      .from("transactions")
      .update({ category, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      setPersistenceError(error.message);
      return;
    }
    setData((current) => {
      const transactions = current.transactions.map((transaction) =>
        transaction.id === id ? { ...transaction, category } : transaction,
      );
      return { ...current, transactions, summary: summarize(transactions) };
    });
  };

  const recent = data.transactions.slice(0, 4);
  const importedRows = data.imports.reduce((sum, item) => sum + item.rows_added, 0);
  const duplicateRows = data.imports.reduce(
    (sum, item) => sum + item.duplicates_ignored,
    0,
  );

  const clearLedger = async () => {
    if (!session) return;
    setPersistenceError(null);
    const [transactionsResult, importsResult] = await Promise.all([
      supabase.from("transactions").delete().eq("user_id", session.user.id),
      supabase.from("imports").delete().eq("user_id", session.user.id),
    ]);
    const error = transactionsResult.error || importsResult.error;
    if (error) {
      setPersistenceError(error.message);
      return;
    }
    setData(emptyResult());
  };

  if (!isSupabaseConfigured) {
    return <main className="auth-shell"><section className="auth-card"><div className="auth-mark"><LockKeyhole size={21} /></div><h1>Configuration needed</h1><p>Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> to <code>.env.local</code>, then restart the dev server.</p></section></main>;
  }
  if (!authReady) return <main className="auth-shell"><p>Loading Ledgerly…</p></main>;
  if (!session) return <AuthScreen />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNavOpen ? "open" : ""}`}>
        <div className="brand">
          <span>Ledgerly</span>
          <small>{session.user.email || "Private budget workspace"}</small>
        </div>
        <nav aria-label="Primary navigation">
          <button className={view === "overview" ? "active" : ""} onClick={() => selectView("overview")}>
            <Home size={19} />
            Overview
          </button>
          <button
            className={view === "transactions" ? "active" : ""}
            onClick={() => selectView("transactions")}
          >
            <ReceiptText size={19} />
            Transactions
            <span className="nav-count">{data.summary.transaction_count}</span>
          </button>
          <button className={view === "imports" ? "active" : ""} onClick={() => selectView("imports")}>
            <ArrowDownToLine size={19} />
            Imports
          </button>
        </nav>
        <button className="sign-out-button" onClick={() => void supabase.auth.signOut()}>
          <LogOut size={17} /> Sign out
        </button>
        <div className="sidebar-card">
          <LockKeyhole size={18} />
          <strong>Private by design</strong>
          <p>Your saved transactions are visible only to your account.</p>
        </div>
      </aside>

      {mobileNavOpen && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNavOpen(false)}
          aria-label="Close navigation"
        />
      )}

      <main className="workspace">
        <div className="mobile-header">
          <button className="icon-button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation">
            <Menu size={21} />
          </button>
          <span>Ledgerly</span>
          <button className="icon-button accent" onClick={() => setImportOpen(true)} aria-label="Import statements">
            <UploadCloud size={19} />
          </button>
        </div>

        <header className="workspace-header">
          <div>
            <span className="eyebrow">{view.toUpperCase()}</span>
            <h1>
              {view === "overview"
                ? "Your spending, clearly organized"
                : view === "transactions"
                  ? "Every transaction, in context"
                  : "Statement imports"}
            </h1>
            <p>
              {view === "overview"
                ? "A clear view of where your money went, without connecting a bank."
                : view === "transactions"
                  ? "Search, review, and adjust categories for this session."
                  : "Review the statements analyzed in this browser session."}
            </p>
          </div>
          <button className="import-button" onClick={() => setImportOpen(true)}>
            <UploadCloud size={19} />
            Import statements
          </button>
        </header>

        {loadingLedger && <p className="persistence-status">Loading your saved budget…</p>}
        {persistenceError && <p className="persistence-status error">{persistenceError}</p>}

        {view === "overview" && (
          <>
            <section className="summary-grid" aria-label="Budget summary">
              <SummaryCard
                label="Spend"
                value={data.summary.spend}
                note={`${data.summary.transaction_count - data.summary.excluded_count} included transactions`}
                icon={<TrendingDown size={25} />}
                tone="spend"
              />
              <SummaryCard
                label="Income"
                value={data.summary.income}
                note="Checking and savings deposits"
                icon={<WalletCards size={25} />}
                tone="income"
              />
              <SummaryCard
                label="Net saved"
                value={data.summary.saved}
                note={
                  data.summary.income
                    ? `${Math.round((data.summary.saved / data.summary.income) * 100)}% of income`
                    : "Import income to calculate"
                }
                icon={<PiggyBank size={25} />}
                tone="saved"
              />
            </section>

            <section className="dashboard-grid">
              <article className="panel category-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">BREAKDOWN</span>
                    <h2>Spending by category</h2>
                  </div>
                    <span className="period-chip">All saved data</span>
                </div>
                {data.summary.categories.length ? (
                  <>
                    <div className="stacked-bar" aria-label="Spending distribution">
                      {data.summary.categories.map((category) => (
                        <span
                          key={category.name}
                          title={`${category.name}: ${category.percent}%`}
                          style={{
                            width: `${category.percent}%`,
                            background: CATEGORY_COLORS[category.name],
                          }}
                        />
                      ))}
                    </div>
                    <div className="category-table">
                      <div className="category-table-head">
                        <span>Category</span>
                        <span>Amount</span>
                        <span>% of spend</span>
                      </div>
                      {data.summary.categories.slice(0, 7).map((category) => (
                        <div className="category-line" key={category.name}>
                          <span>
                            <i style={{ background: CATEGORY_COLORS[category.name] }} />
                            {category.name}
                          </span>
                          <strong>{currency.format(category.amount)}</strong>
                          <span>{category.percent.toFixed(1)}%</span>
                        </div>
                      ))}
                      <div className="category-total">
                        <span>Total</span>
                        <strong>{currency.format(data.summary.spend)}</strong>
                        <span>100%</span>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="empty-state">
                    <span><ReceiptText size={25} /></span>
                    <h3>No spending yet</h3>
                    <p>Import a statement to build your category breakdown.</p>
                    <button onClick={() => setImportOpen(true)}>Import CSVs</button>
                  </div>
                )}
              </article>

              <article className="panel recent-panel">
                <div className="panel-heading">
                  <div>
                    <span className="eyebrow">LATEST ACTIVITY</span>
                    <h2>Recent transactions</h2>
                  </div>
                  <button className="text-button" onClick={() => setView("transactions")}>
                    View all <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="recent-list">
                  {recent.length ? (
                    recent.map((transaction) => (
                      <TransactionRow compact key={transaction.id} transaction={transaction} />
                    ))
                  ) : (
                    <div className="empty-state compact-empty">
                      <h3>No transactions</h3>
                      <p>Your imported activity will appear here.</p>
                    </div>
                  )}
                </div>
                {data.summary.excluded_count > 0 && (
                  <div className="matching-note">
                    <ShieldCheck size={17} />
                    <span>
                      <strong>{data.summary.excluded_count} transfer entries excluded.</strong>
                      Equal and opposite account movements are not counted as spending.
                    </span>
                  </div>
                )}
              </article>
            </section>
          </>
        )}

        {view === "transactions" && (
          <section className="panel transactions-panel">
            <div className="transaction-toolbar">
              <label className="search-field">
                <Search size={17} />
                <span className="sr-only">Search transactions</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search merchant or account"
                />
              </label>
              <label className="filter-select">
                <span className="sr-only">Filter by category</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option>All categories</option>
                  {CATEGORY_ORDER.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
                <ChevronDown size={15} />
              </label>
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={showExcluded}
                  onChange={(event) => setShowExcluded(event.target.checked)}
                />
                <span />
                Show excluded
              </label>
            </div>
            <div className="table-summary">
              <span>
                {filteredTransactions.length} of {data.transactions.length} transactions
              </span>
                <span>Category edits save automatically</span>
            </div>
            <div className="full-transaction-list">
              {filteredTransactions.length ? (
                filteredTransactions.map((transaction) => (
                  <TransactionRow
                    key={transaction.id}
                    transaction={transaction}
                    onCategoryChange={transaction.excluded ? undefined : recategorize}
                  />
                ))
              ) : (
                <div className="empty-state">
                  <span><Search size={24} /></span>
                  <h3>No matching transactions</h3>
                  <p>Try a broader search or another category.</p>
                </div>
              )}
            </div>
          </section>
        )}

        {view === "imports" && (
          <section className="imports-layout">
            <article className="panel import-summary-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">CURRENT SESSION</span>
                  <h2>Import summary</h2>
                </div>
              </div>
              <div className="import-stats">
                <div>
                  <FileText size={19} />
                  <strong>{data.imports.length}</strong>
                  <span>Statements</span>
                </div>
                <div>
                  <ReceiptText size={19} />
                  <strong>{importedRows}</strong>
                  <span>Rows added</span>
                </div>
                <div>
                  <ShieldCheck size={19} />
                  <strong>{duplicateRows}</strong>
                  <span>Duplicates skipped</span>
                </div>
              </div>
              <div className="privacy-explainer">
                <LockKeyhole size={21} />
                <div>
                    <strong>Your data is saved privately</strong>
                    <p>
                      CSV files are analyzed and discarded. Transactions and category edits
                      are saved to your private Ledgerly workspace.
                  </p>
                </div>
              </div>
              <button
                className="clear-button"
                disabled={!data.transactions.length && !data.imports.length}
                onClick={() => void clearLedger()}
              >
                <Trash2 size={16} />
                Clear this session
              </button>
            </article>

            <article className="panel statement-list-panel">
              <div className="panel-heading">
                <div>
                  <span className="eyebrow">FILES</span>
                  <h2>Analyzed statements</h2>
                </div>
                <button className="text-button" onClick={() => setImportOpen(true)}>
                  Add more <ArrowUpRight size={15} />
                </button>
              </div>
              {data.imports.length ? (
                <div className="statement-list">
                  {data.imports.map((item, index) => (
                    <div className="statement-row" key={`${item.filename}:${index}`}>
                      <span className="statement-icon">
                        {item.account_type === "credit" ? (
                          <WalletCards size={20} />
                        ) : (
                          <Landmark size={20} />
                        )}
                      </span>
                      <div>
                        <strong>{item.filename}</strong>
                        <span>
                          {item.account_name} · {item.rows_read} source rows
                        </span>
                      </div>
                      <div className="statement-result">
                        <strong>{item.rows_added} added</strong>
                        <span>{item.duplicates_ignored} duplicates</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <span><ArrowDownToLine size={24} /></span>
                  <h3>No statements imported</h3>
                  <p>Add a CSV statement to begin this session.</p>
                  <button onClick={() => setImportOpen(true)}>Choose statements</button>
                </div>
              )}
            </article>
          </section>
        )}

      <footer className="session-footer">
          <LockKeyhole size={15} />
          Your original CSV files are never stored.
        </footer>
      </main>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported}
        existingTransactions={data.transactions}
      />
    </div>
  );
}
