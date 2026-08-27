import React, { useState, useEffect, useRef } from "react";
import { parseTransactionsCSV, parseDebtsCSV } from "../lib/csv";
import { gbp, totalIncome } from "../lib/finance";
import { Card, NumberInput } from "../components/ui";
import { hasAccounts, getHouseholdId } from "../lib/storage";
import { supabase } from "../lib/supabaseClient";
import { BankConnectPanel } from "./BankConnectPanel";
import { API_BASE } from "../lib/apiBase";

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}



export function PensionReaderTab({ onUseInPension, pensions = [] }) {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState("idle"); // idle | reading | done | error
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [applied, setApplied] = useState(false);
  const [targetPotId, setTargetPotId] = useState("new");
  const inputRef = useRef(null);

  const pickFile = (f) => {
    if (!f) return;
    const isPdf = f.type === "application/pdf";
    const isImage = f.type.startsWith("image/");
    if (!isPdf && !isImage) {
      setStatus("error");
      setErrorMsg("Please choose a PDF or a photo (JPG/PNG).");
      return;
    }
    setFile(f);
    setStatus("idle");
    setResult(null);
    setApplied(false);
  };

  const analyze = async () => {
    if (!file) return;
    setStatus("reading");
    setErrorMsg("");
    try {
      const base64 = await fileToBase64(file);
      const fileKind = file.type === "application/pdf" ? "pdf" : "image";
      const resp = await fetch(`${API_BASE}/api/analyze-pension`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileBase64: base64, mediaType: file.type, fileKind }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      if (data.couldNotRead) {
        setStatus("error");
        setErrorMsg(data.summary || "Couldn't read this document. Try a clearer photo or the original PDF.");
        return;
      }
      setResult(data);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong reading the document.");
    }
  };

  const reset = () => {
    setFile(null);
    setStatus("idle");
    setResult(null);
    setErrorMsg("");
    setApplied(false);
    setTargetPotId("new");
    if (inputRef.current) inputRef.current.value = "";
  };

  const useInPension = () => {
    if (!result) return;
    onUseInPension(result, targetPotId);
    setApplied(true);
  };

  return (
    <>
      <div className="wmg-section-title">Make sense of your pension in seconds</div>
      <div className="wmg-section-desc">
        Upload any pension statement — a PDF, or just a photo if it's on paper — and get a plain-English breakdown of
        what it means for you: current value, fees, and what it's likely to be worth by retirement. It's something
        none of the big budgeting apps offer. Nothing is saved unless you choose to use the numbers in your Pension
        tab.
      </div>

      {status !== "done" && (
        <Card>
          <div
            className="wmg-reader-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,image/*"
              className="wmg-reader-input"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {file ? (
              <div className="wmg-reader-filename">
                <i className="ti ti-file-check" aria-hidden="true" /> {file.name}
              </div>
            ) : (
              <>
                <div className="wmg-reader-dropzone-title">Tap to choose a file, or drag one here</div>
                <div className="wmg-reader-dropzone-sub">PDF, JPG or PNG</div>
              </>
            )}
          </div>

          {status === "error" && <div className="wmg-reader-error">{errorMsg}</div>}

          <button className="wmg-btn-primary wmg-reader-analyze" disabled={!file || status === "reading"} onClick={analyze}>
            {status === "reading" ? "Reading your document…" : "Read this document"}
          </button>
        </Card>
      )}

      {status === "done" && result && (
        <>
          <Card className="wmg-reader-summary-card">
            <div className="wmg-reader-doc-type">{result.documentType}{result.provider ? ` — ${result.provider}` : ""}</div>
            {result.asOfDate && <div className="wmg-sub" style={{ marginBottom: 12 }}>As of {result.asOfDate}</div>}
            <p style={{ marginTop: result.asOfDate ? 0 : 8 }}>{result.summary}</p>
          </Card>

          <div className="wmg-chip-row">
            {result.currentValue != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Current value</div><div className="wmg-chip-value">{gbp(result.currentValue)}</div></div>
            )}
            {result.monthlyContribution != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Monthly contribution</div><div className="wmg-chip-value">{gbp(result.monthlyContribution)}</div></div>
            )}
            {result.annualFeePercent != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Annual fee</div><div className="wmg-chip-value">{result.annualFeePercent}%</div></div>
            )}
            {result.projectedValue != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Projected value</div><div className="wmg-chip-value">{gbp(result.projectedValue)}</div></div>
            )}
            {result.projectedIncome != null && (
              <div className="wmg-chip">
                <div className="wmg-chip-label">Projected income ({result.projectedIncomeFrequency || "—"})</div>
                <div className="wmg-chip-value">{gbp(result.projectedIncome)}</div>
              </div>
            )}
            {result.retirementAge != null && (
              <div className="wmg-chip"><div className="wmg-chip-label">Assumed retirement age</div><div className="wmg-chip-value">{result.retirementAge}</div></div>
            )}
          </div>

          <Card className={`wmg-insight-card wmg-insight-${result.verdict.tone === "good" ? "sage" : result.verdict.tone === "caution" ? "rust" : "gold"}`}>
            <span className={`wmg-insight-icon-badge tone-${result.verdict.tone === "good" ? "sage" : result.verdict.tone === "caution" ? "rust" : "gold"}`}>
              {result.verdict.tone === "good" ? "✓" : result.verdict.tone === "caution" ? "!" : "i"}
            </span>
            <p>{result.verdict.text}</p>
          </Card>

          {onUseInPension && result.currentValue != null && !applied && (
            <Card style={{ marginTop: 12 }}>
              <div className="wmg-field-label">Where should these numbers go?</div>
              <select
                className="wmg-input"
                value={targetPotId}
                onChange={(e) => setTargetPotId(e.target.value)}
              >
                <option value="new">Add as a new pension pot{result.provider ? ` (${result.provider})` : ""}</option>
                {pensions.map((p) => (
                  <option key={p.id} value={p.id}>Update "{p.name}"</option>
                ))}
              </select>
            </Card>
          )}

          <div className="wmg-reader-actions">
            {onUseInPension && result.currentValue != null && !applied && (
              <button className="wmg-btn-primary" onClick={useInPension}>Use these numbers in my Pension tab</button>
            )}
            {applied && <div className="wmg-reader-applied">✓ Added to your Pension tab</div>}
            <button className="wmg-onboard-skip" onClick={reset}>Read another document</button>
          </div>
        </>
      )}

      <div className="wmg-footnote" style={{ marginTop: 20 }}>
        This reads the document you upload using AI and does its best to extract accurate figures, but it can make
        mistakes — always check important numbers against the original document. This isn't financial advice.
      </div>
    </>
  );
}



export function ImportTab({ profile, addBulkItems, onApplyImportedSpending, onBankSyncApplied, onDiscardPendingSync, hasConnectedBank, onBankAccountsChanged, onSubscriptionsDetected, onUseAsSavings, onSubscriptionsPossiblyStopped }) {
  const [mode, setMode] = useState("transactions"); // transactions | debts
  // Bank connecting needs a signed-in household to attach the connection
  // to — null until resolved (or permanently null if accounts aren't
  // configured at all, per hasAccounts below).
  const [householdId, setHouseholdId] = useState(null);

  useEffect(() => {
    if (!hasAccounts) return;
    getHouseholdId()
      .then(setHouseholdId)
      .catch(() => setHouseholdId(null));
  }, []);

  const readFileText = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsText(file);
    });

  return (
    <>
      {hasAccounts && householdId && (
        <div style={{ marginBottom: 20 }}>
          <BankConnectPanel
            householdId={householdId}
            onAccountsChanged={onBankAccountsChanged}
            onUseAsSavings={onUseAsSavings}
            savingsBalance={profile.savings.balance}
          />
        </div>
      )}

      <div className="wmg-section-title">Import from a bank export</div>
      <div className="wmg-section-desc">
        Upload a CSV exported from your bank's statements page — or a simple debts list — instead of typing
        everything in by hand. Nothing is saved until you review and choose to apply it.
      </div>

      <div className="wmg-chip-row" style={{ marginBottom: 16 }}>
        <button className={mode === "transactions" ? "wmg-btn-primary" : "wmg-onboard-skip"} onClick={() => setMode("transactions")}>
          Transactions
        </button>
        <button className={mode === "debts" ? "wmg-btn-primary" : "wmg-onboard-skip"} onClick={() => setMode("debts")}>
          Debts
        </button>
      </div>

      {mode === "transactions" ? (
        <TransactionsImport
          profile={profile}
          onApplyImportedSpending={onApplyImportedSpending}
          readFileText={readFileText}
          hasConnectedBank={hasConnectedBank}
          pendingBankSync={profile.pendingBankSync}
          onBankSyncApplied={onBankSyncApplied}
          onDiscardPendingSync={onDiscardPendingSync}
          onSubscriptionsDetected={onSubscriptionsDetected}
          onSubscriptionsPossiblyStopped={onSubscriptionsPossiblyStopped}
        />
      ) : (
        <DebtsImport addBulkItems={addBulkItems} readFileText={readFileText} />
      )}

      <div className="wmg-footnote" style={{ marginTop: 20 }}>
        {mode === "transactions"
          ? "Transaction descriptions are sent to Claude (Anthropic) to help match them to your categories. No account numbers, sort codes, or balances are included."
          : "Nothing is saved until you review the rows below and choose to add them."}{" "}
        This isn't financial advice — always check the totals before applying them.
      </div>
    </>
  );
}


export function TransactionsImport({ profile, onApplyImportedSpending, readFileText, hasConnectedBank, pendingBankSync, onBankSyncApplied, onDiscardPendingSync, onSubscriptionsDetected, onSubscriptionsPossiblyStopped }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | parsed | categorizing | reviewing | error
  const [errorMsg, setErrorMsg] = useState("");
  const [parsedTx, setParsedTx] = useState(null);
  const [progress, setProgress] = useState("");
  const [categoryTotals, setCategoryTotals] = useState(null);
  // Named per-merchant items within each category (e.g. "Tesco — £45/mo",
  // "Sainsbury's — £30/mo") built from the actual pulled transactions —
  // null when reviewing a pending overnight sync, since the server-side
  // sync job only stores flat totals, not the individual transactions, so
  // that path still falls back to a single combined line on apply.
  const [categoryItems, setCategoryItems] = useState(null);
  const [incomeEstimate, setIncomeEstimate] = useState(null);
  const [applied, setApplied] = useState(false);
  const [source, setSource] = useState(null); // "csv" | "bank" — which path produced parsedTx, for the summary line only
  // When the current review screen came from an overnight sync rather
  // than a manual pull or CSV, this holds its { fromDate, toDate,
  // syncedAt } — used to advance bank_connections.last_synced_at to the
  // right point on apply, and to show a different summary line.
  const [syncMeta, setSyncMeta] = useState(null);

  // Auto-load a pending overnight sync straight into the review screen —
  // this is the whole point of it being "automatic": no fetch button to
  // press, just a review + apply. Only fires from a clean idle state, so
  // it can't interrupt a CSV file the person is already partway through.
  useEffect(() => {
    if (!pendingBankSync || status !== "idle") return;
    setCategoryTotals(pendingBankSync.categoryTotals);
    setIncomeEstimate(pendingBankSync.incomeEstimate);
    setSyncMeta(pendingBankSync);
    setSource("bank");
    setApplied(false);
    setStatus("reviewing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingBankSync]);

  const pickFile = async (f) => {
    if (!f) return;
    setErrorMsg("");
    setApplied(false);
    setCategoryTotals(null);
    setCategoryItems(null);
    if (!f.name.toLowerCase().endsWith(".csv") && f.type !== "text/csv") {
      setStatus("error");
      setErrorMsg("Please choose a CSV file — most banks let you export one from your statements page.");
      return;
    }
    try {
      const text = await readFileText(f);
      const { transactions, error } = parseTransactionsCSV(text);
      if (error) {
        setStatus("error");
        setErrorMsg(error);
        return;
      }
      setParsedTx(transactions);
      setSource("csv");
      setStatus("parsed");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Could not read this file.");
    }
  };

  // Pulls a one-time transaction history from the household's connected
  // bank (via api/truelayer-transactions) and feeds it into the exact same
  // categorize/review/apply pipeline CSV import already uses — same
  // review-before-save philosophy, just a different source for the rows.
  const importFromBank = async () => {
    setErrorMsg("");
    setApplied(false);
    setCategoryTotals(null);
    setCategoryItems(null);
    setStatus("categorizing");
    setProgress("Fetching transactions from your bank…");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/truelayer-transactions`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await resp.json();
      if (!resp.ok) {
        if (resp.status === 404) {
          throw new Error("No bank connected yet — connect one above first.");
        }
        throw new Error(data.error || "Couldn't fetch transactions from your bank.");
      }
      const transactions = (data.transactions || []).map((t) => ({
        description: t.description,
        amount: t.amount,
        date: new Date(t.date),
      }));
      if (transactions.length === 0) {
        setStatus("error");
        setErrorMsg("No transactions found for your connected bank in the last 90 days.");
        return;
      }
      setParsedTx(transactions);
      setSource("bank");
      // Fire subscription detection alongside categorization — same
      // source data, different question (repetition across the whole
      // history vs. matching each transaction to a category), so this
      // runs independently rather than blocking the review screen on it.
      // A failure here shouldn't stop the actual budget import from
      // working, so it's deliberately swallowed rather than surfaced as
      // the main error state.
      if (onSubscriptionsDetected || onSubscriptionsPossiblyStopped) {
        const existingNames = (profile.subscriptions || []).map((s) => s.name);
        fetch(`${API_BASE}/api/detect-subscriptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: transactions.map((t) => ({ description: t.description, amount: t.amount, date: t.date })),
            existingNames,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            if (Array.isArray(data.suggestions)) onSubscriptionsDetected?.(data.suggestions);
            if (Array.isArray(data.possiblyStopped) && data.possiblyStopped.length > 0 && onSubscriptionsPossiblyStopped) {
              // Match names back to the real, currently-active subscription
              // records (not cancelled already) so the handler can act on
              // the actual entries rather than bare strings.
              const stoppedNames = data.possiblyStopped.map((n) => n.toLowerCase());
              const matches = (profile.subscriptions || []).filter(
                (s) => !s.cancelled && stoppedNames.includes(s.name.toLowerCase())
              );
              if (matches.length > 0) onSubscriptionsPossiblyStopped(matches);
            }
          })
          .catch((e) => console.error("Subscription detection from manual pull failed:", e));
      }
      await categorize(transactions);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong fetching transactions from your bank.");
    }
  };

  // Accepts an explicit transaction list so importFromBank can call this
  // directly with freshly-fetched rows, without waiting on a state update
  // to land first (React state from setParsedTx isn't readable until the
  // next render, so passing the rows straight through avoids a stale read).
  const categorize = async (txsOverride) => {
    const txs = txsOverride || parsedTx;
    if (!txs) return;
    setStatus("categorizing");
    setErrorMsg("");
    const categories = profile.expenseCategories.map((c) => c.name);
    const batchSize = 150;
    const results = new Array(txs.length).fill(null);
    try {
      for (let start = 0; start < txs.length; start += batchSize) {
        const batch = txs.slice(start, start + batchSize);
        setProgress(`Categorising ${start + 1}–${Math.min(start + batchSize, txs.length)} of ${txs.length}…`);
        const resp = await fetch(`${API_BASE}/api/categorize-transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: batch.map((t) => ({ description: t.description, amount: t.amount })),
            categories,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Something went wrong.");
        (data.results || []).forEach((r, i) => {
          results[start + i] = r;
        });
      }

      const dates = txs.map((t) => t.date.getTime());
      const minDate = Math.min(...dates);
      const maxDate = Math.max(...dates);
      const spanDays = Math.max(1, (maxDate - minDate) / (1000 * 60 * 60 * 24));
      const spanMonths = Math.max(spanDays / 30, 1 / 30);

      const totals = {};
      // Groups by category, then by the transaction's own description
      // within that category — e.g. every "TESCO STORES" transaction
      // inside "Groceries" gets summed together under that name, so the
      // review screen (and the applied budget) shows real named
      // merchants instead of one opaque "From bank import" total.
      const itemSums = {}; // { [category]: { [description]: rawSum } }
      let incomeTotal = 0;
      txs.forEach((t, i) => {
        const r = results[i];
        if (!r) return;
        if (r.isIncome) {
          if (t.amount > 0) incomeTotal += t.amount;
          return;
        }
        if (r.category) {
          totals[r.category] = (totals[r.category] || 0) + Math.abs(t.amount);
          const desc = String(t.description || "Unknown").trim();
          if (!itemSums[r.category]) itemSums[r.category] = {};
          itemSums[r.category][desc] = (itemSums[r.category][desc] || 0) + Math.abs(t.amount);
        }
      });
      const monthlyTotals = {};
      Object.entries(totals).forEach(([cat, sum]) => {
        monthlyTotals[cat] = Math.round(sum / spanMonths);
      });
      const monthlyItems = {};
      Object.entries(itemSums).forEach(([cat, byDesc]) => {
        monthlyItems[cat] = Object.entries(byDesc)
          .map(([name, sum]) => ({ id: `${cat}_${name}`.replace(/\s+/g, "_"), name, amount: Math.round(sum / spanMonths) }))
          .filter((it) => it.amount > 0)
          .sort((a, b) => b.amount - a.amount);
      });

      setCategoryTotals(monthlyTotals);
      setCategoryItems(monthlyItems);
      setIncomeEstimate(incomeTotal > 0 ? Math.round(incomeTotal / spanMonths) : totalIncome(profile));
      setStatus("reviewing");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong categorising these transactions.");
    }
  };

  const updateCategoryTotal = (cat, value) => {
    setCategoryTotals((prev) => ({ ...prev, [cat]: Number(value) || 0 }));
  };

  // Editing or removing one merchant's line keeps the category's overall
  // total in sync, since that total is always the sum of its items when
  // items exist — this mirrors how a real budget category's total is
  // just the sum of what's in it, not a separately-tracked number.
  const updateItemAmount = (cat, itemId, value) => {
    setCategoryItems((prev) => {
      const items = (prev[cat] || []).map((it) => (it.id === itemId ? { ...it, amount: Number(value) || 0 } : it));
      setCategoryTotals((t) => ({ ...t, [cat]: items.reduce((s, it) => s + it.amount, 0) }));
      return { ...prev, [cat]: items };
    });
  };

  const removeItem = (cat, itemId) => {
    setCategoryItems((prev) => {
      const items = (prev[cat] || []).filter((it) => it.id !== itemId);
      setCategoryTotals((t) => ({ ...t, [cat]: items.reduce((s, it) => s + it.amount, 0) }));
      return { ...prev, [cat]: items };
    });
  };

  const apply = () => {
    onApplyImportedSpending(categoryTotals, incomeEstimate, categoryItems);
    // Any bank-sourced apply (manual pull or a reviewed overnight sync)
    // advances the sync cursor to "now" (or the sync's own toDate, if
    // this review came from one) — so tonight's/the next sync only
    // covers what's genuinely new, instead of recomputing from scratch
    // over a window that's already been applied.
    if (source === "bank") {
      onBankSyncApplied?.(syncMeta ? syncMeta.toDate : new Date().toISOString());
    }
    setApplied(true);
  };

  // Clears a pending overnight sync without applying it — the cursor is
  // deliberately left untouched, so the next sync just recomputes fresh
  // over the same (or a slightly wider) still-unreviewed window rather
  // than silently losing those days.
  const discardPendingSync = () => {
    onDiscardPendingSync?.();
    reset();
  };

  const reset = () => {
    setStatus("idle");
    setErrorMsg("");
    setParsedTx(null);
    setCategoryTotals(null);
    setCategoryItems(null);
    setIncomeEstimate(null);
    setApplied(false);
    setSource(null);
    setSyncMeta(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      {(status === "idle" || status === "error" || status === "parsed") && hasConnectedBank && (
        <Card className="wmg-bank-pull-card" style={{ marginBottom: 12, textAlign: "center" }}>
          <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Bank connected</div>
          <div className="wmg-sub" style={{ marginBottom: 12 }}>
            Pull in your last 90 days of transactions automatically — no CSV needed.
          </div>
          <button className="wmg-btn-primary" style={{ width: "100%" }} onClick={importFromBank}>
            Pull transactions from my connected bank
          </button>
        </Card>
      )}

      {(status === "idle" || status === "error" || status === "parsed") && (
        <Card>
          {hasConnectedBank && (
            <div className="wmg-sub" style={{ textAlign: "center", marginBottom: 10 }}>Or import from a CSV instead</div>
          )}
          <div
            className="wmg-reader-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="wmg-reader-input"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            {parsedTx ? (
              <div className="wmg-reader-filename">
                <i className="ti ti-file-check" aria-hidden="true" /> {parsedTx.length} transactions found
              </div>
            ) : (
              <>
                <div className="wmg-reader-dropzone-title">Tap to choose a CSV, or drag one here</div>
                <div className="wmg-reader-dropzone-sub">Exported from your bank's statements page</div>
              </>
            )}
          </div>
          {status === "error" && <div className="wmg-reader-error">{errorMsg}</div>}
          <button className="wmg-btn-primary wmg-reader-analyze" disabled={!parsedTx} onClick={() => categorize()}>
            Categorise these transactions
          </button>
        </Card>
      )}

      {status === "categorizing" && <Card>{progress || "Categorising…"}</Card>}

      {status === "reviewing" && categoryTotals && (
        <>
          {syncMeta ? (
            <div className="wmg-sub" style={{ marginBottom: 8 }}>
              Synced automatically overnight — {syncMeta.transactionCount} transaction{syncMeta.transactionCount === 1 ? "" : "s"} from{" "}
              {syncMeta.fromDate} to {syncMeta.toDate}.
            </div>
          ) : (
            source === "bank" && (
              <div className="wmg-sub" style={{ marginBottom: 8 }}>
                Based on the last 90 days from your connected bank.
              </div>
            )
          )}
          <Card className="wmg-income-confirm-card">
            <div className="wmg-sub" style={{ marginBottom: 8, fontWeight: 700 }}>
              Confirm your monthly income
            </div>
            <div className="wmg-sub" style={{ marginBottom: 10 }}>
              {incomeEstimate != null && incomeEstimate !== profile.income
                ? "Based on this pull — bank-detected income can sometimes be off (e.g. transfers between your own accounts), so double-check this before applying."
                : "No income change was detected in this pull — check the figure below is still right before applying."}
            </div>
            <div className="wmg-chip">
              <div className="wmg-chip-label">Monthly income</div>
              <div className="wmg-chip-value">
                <NumberInput
                  value={incomeEstimate ?? profile.income}
                  onChange={(v) => setIncomeEstimate(v || 0)}
                  style={{ width: 100 }}
                />
              </div>
            </div>
          </Card>

          <Card>
            <div className="wmg-sub" style={{ marginBottom: 8 }}>
              Suggested monthly spending by category — check these before applying
            </div>
            {Object.keys(categoryTotals).length === 0 && <p>No spending could be matched to your categories.</p>}
            {Object.entries(categoryTotals).map(([cat, amount]) => {
              const items = categoryItems?.[cat];
              return (
                <div key={cat} style={{ marginBottom: 14 }}>
                  <div className="wmg-chip-row" style={{ justifyContent: "space-between", marginBottom: items?.length ? 6 : 8 }}>
                    <span style={{ fontWeight: 600 }}>{cat}</span>
                    {items?.length ? (
                      <span style={{ fontWeight: 600 }}>{gbp(amount)}/mo</span>
                    ) : (
                      <NumberInput value={amount} onChange={(v) => updateCategoryTotal(cat, v)} style={{ width: 90 }} />
                    )}
                  </div>
                  {items?.length > 0 && (
                    <div style={{ marginLeft: 4 }}>
                      {items.map((it) => (
                        <div key={it.id} className="wmg-chip-row" style={{ justifyContent: "space-between", marginBottom: 4 }}>
                          <span className="wmg-sub" style={{ fontSize: 13 }}>{it.name}</span>
                          <div className="wmg-chip-row" style={{ flexShrink: 0, gap: 6 }}>
                            <NumberInput value={it.amount} onChange={(v) => updateItemAmount(cat, it.id, v)} style={{ width: 80 }} />
                            <button
                              type="button"
                              className="wmg-onboard-skip"
                              style={{ padding: "2px 8px", fontSize: 12 }}
                              onClick={() => removeItem(cat, it.id)}
                              aria-label={`Remove ${it.name}`}
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>

          <div className="wmg-reader-actions">
            {!applied && (
              <button className="wmg-btn-primary" onClick={apply}>
                Apply to my budget
              </button>
            )}
            {applied && <div className="wmg-reader-applied">✓ Added to your budget</div>}
            {syncMeta && !applied ? (
              <button className="wmg-onboard-skip" onClick={discardPendingSync}>
                Discard this sync
              </button>
            ) : (
              <button className="wmg-onboard-skip" onClick={reset}>
                Import another file
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}


export function DebtsImport({ addBulkItems, readFileText }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | reviewing | error | applied
  const [errorMsg, setErrorMsg] = useState("");
  const [rows, setRows] = useState([]);

  const pickFile = async (f) => {
    if (!f) return;
    setErrorMsg("");
    if (!f.name.toLowerCase().endsWith(".csv") && f.type !== "text/csv") {
      setStatus("error");
      setErrorMsg("Please choose a CSV file.");
      return;
    }
    try {
      const text = await readFileText(f);
      const { debts, error } = parseDebtsCSV(text);
      if (error) {
        setStatus("error");
        setErrorMsg(error);
        return;
      }
      setRows(debts);
      setStatus("reviewing");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Could not read this file.");
    }
  };

  const updateRow = (i, field, value) => {
    setRows((prev) =>
      prev.map((r, idx) => (idx === i ? { ...r, [field]: field === "name" || field === "type" ? value : Number(value) || 0 } : r))
    );
  };

  const removeRow = (i) => setRows((prev) => prev.filter((_, idx) => idx !== i));

  const apply = () => {
    const toEntry = (r) => ({
      name: r.name,
      balance: r.balance,
      rate: r.rate,
      payment: r.payment,
      originalBalance: r.balance,
      lastConfirmedAt: new Date().toISOString(),
    });
    const loans = rows.filter((r) => r.type === "loan").map(toEntry);
    const cards = rows.filter((r) => r.type === "card").map(toEntry);
    if (loans.length) addBulkItems("loans", loans);
    if (cards.length) addBulkItems("cards", cards);
    setStatus("applied");
  };

  const reset = () => {
    setStatus("idle");
    setErrorMsg("");
    setRows([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      {(status === "idle" || status === "error") && (
        <Card>
          <div
            className="wmg-reader-dropzone"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pickFile(e.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="wmg-reader-input"
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
            <div className="wmg-reader-dropzone-title">Tap to choose a CSV, or drag one here</div>
            <div className="wmg-reader-dropzone-sub">Columns: Name, Balance, Rate, Payment, Type (loan/card)</div>
          </div>
          {status === "error" && <div className="wmg-reader-error">{errorMsg}</div>}
        </Card>
      )}

      {status === "reviewing" && (
        <>
          <Card>
            <div className="wmg-sub" style={{ marginBottom: 8 }}>
              {rows.length} debts found — check before adding
            </div>
            {rows.map((r, i) => (
              <div key={i} className="wmg-chip-row" style={{ marginBottom: 8, alignItems: "center" }}>
                <input value={r.name} onChange={(e) => updateRow(i, "name", e.target.value)} style={{ flex: 2 }} />
                <NumberInput value={r.balance} onChange={(v) => updateRow(i, "balance", v)} style={{ width: 90 }} />
                <select value={r.type} onChange={(e) => updateRow(i, "type", e.target.value)}>
                  <option value="loan">Loan</option>
                  <option value="card">Card</option>
                </select>
                <button className="wmg-onboard-skip" onClick={() => removeRow(i)}>
                  Remove
                </button>
              </div>
            ))}
          </Card>
          <div className="wmg-reader-actions">
            <button className="wmg-btn-primary" onClick={apply} disabled={rows.length === 0}>
              Add these debts
            </button>
            <button className="wmg-onboard-skip" onClick={reset}>
              Start over
            </button>
          </div>
        </>
      )}

      {status === "applied" && (
        <Card>
          <div className="wmg-reader-applied">✓ Added to your Debts tab</div>
          <button className="wmg-onboard-skip" style={{ marginTop: 12 }} onClick={reset}>
            Import another file
          </button>
        </Card>
      )}
    </>
  );
}
