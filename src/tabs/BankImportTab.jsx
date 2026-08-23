import React, { useState, useEffect, useRef } from "react";
import { parseTransactionsCSV, parseDebtsCSV } from "../lib/csv";
import { gbp } from "../lib/finance";
import { Card } from "../components/ui";

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
      const resp = await fetch("/api/analyze-pension", {
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



export function ImportTab({ profile, addBulkItems, onApplyImportedSpending }) {
  const [mode, setMode] = useState("transactions"); // transactions | debts

  const readFileText = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read the file."));
      reader.readAsText(file);
    });

  return (
    <>
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
        <TransactionsImport profile={profile} onApplyImportedSpending={onApplyImportedSpending} readFileText={readFileText} />
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


export function TransactionsImport({ profile, onApplyImportedSpending, readFileText }) {
  const inputRef = useRef(null);
  const [status, setStatus] = useState("idle"); // idle | parsed | categorizing | reviewing | error
  const [errorMsg, setErrorMsg] = useState("");
  const [parsedTx, setParsedTx] = useState(null);
  const [progress, setProgress] = useState("");
  const [categoryTotals, setCategoryTotals] = useState(null);
  const [incomeEstimate, setIncomeEstimate] = useState(null);
  const [applied, setApplied] = useState(false);

  const pickFile = async (f) => {
    if (!f) return;
    setErrorMsg("");
    setApplied(false);
    setCategoryTotals(null);
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
      setStatus("parsed");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Could not read this file.");
    }
  };

  const categorize = async () => {
    if (!parsedTx) return;
    setStatus("categorizing");
    setErrorMsg("");
    const categories = profile.expenseCategories.map((c) => c.name);
    const batchSize = 150;
    const results = new Array(parsedTx.length).fill(null);
    try {
      for (let start = 0; start < parsedTx.length; start += batchSize) {
        const batch = parsedTx.slice(start, start + batchSize);
        setProgress(`Categorising ${start + 1}–${Math.min(start + batchSize, parsedTx.length)} of ${parsedTx.length}…`);
        const resp = await fetch("/api/categorize-transactions", {
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

      const dates = parsedTx.map((t) => t.date.getTime());
      const minDate = Math.min(...dates);
      const maxDate = Math.max(...dates);
      const spanDays = Math.max(1, (maxDate - minDate) / (1000 * 60 * 60 * 24));
      const spanMonths = Math.max(spanDays / 30, 1 / 30);

      const totals = {};
      let incomeTotal = 0;
      parsedTx.forEach((t, i) => {
        const r = results[i];
        if (!r) return;
        if (r.isIncome) {
          if (t.amount > 0) incomeTotal += t.amount;
          return;
        }
        if (r.category) {
          totals[r.category] = (totals[r.category] || 0) + Math.abs(t.amount);
        }
      });
      const monthlyTotals = {};
      Object.entries(totals).forEach(([cat, sum]) => {
        monthlyTotals[cat] = Math.round(sum / spanMonths);
      });

      setCategoryTotals(monthlyTotals);
      setIncomeEstimate(incomeTotal > 0 ? Math.round(incomeTotal / spanMonths) : null);
      setStatus("reviewing");
    } catch (e) {
      setStatus("error");
      setErrorMsg(e.message || "Something went wrong categorising these transactions.");
    }
  };

  const updateCategoryTotal = (cat, value) => {
    setCategoryTotals((prev) => ({ ...prev, [cat]: Number(value) || 0 }));
  };

  const apply = () => {
    onApplyImportedSpending(categoryTotals, incomeEstimate);
    setApplied(true);
  };

  const reset = () => {
    setStatus("idle");
    setErrorMsg("");
    setParsedTx(null);
    setCategoryTotals(null);
    setIncomeEstimate(null);
    setApplied(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <>
      {(status === "idle" || status === "error" || status === "parsed") && (
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
          <button className="wmg-btn-primary wmg-reader-analyze" disabled={!parsedTx} onClick={categorize}>
            Categorise these transactions
          </button>
        </Card>
      )}

      {status === "categorizing" && <Card>{progress || "Categorising…"}</Card>}

      {status === "reviewing" && categoryTotals && (
        <>
          {incomeEstimate != null && (
            <Card>
              <div className="wmg-chip">
                <div className="wmg-chip-label">Estimated monthly income (from this file)</div>
                <div className="wmg-chip-value">
                  <input
                    type="number"
                    value={incomeEstimate}
                    onChange={(e) => setIncomeEstimate(Number(e.target.value) || 0)}
                    style={{ width: 100 }}
                  />
                </div>
              </div>
            </Card>
          )}

          <Card>
            <div className="wmg-sub" style={{ marginBottom: 8 }}>
              Suggested monthly spending by category — check these before applying
            </div>
            {Object.keys(categoryTotals).length === 0 && <p>No spending could be matched to your categories.</p>}
            {Object.entries(categoryTotals).map(([cat, amount]) => (
              <div key={cat} className="wmg-chip-row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <span>{cat}</span>
                <input type="number" value={amount} onChange={(e) => updateCategoryTotal(cat, e.target.value)} style={{ width: 90 }} />
              </div>
            ))}
          </Card>

          <div className="wmg-reader-actions">
            {!applied && (
              <button className="wmg-btn-primary" onClick={apply}>
                Apply to my budget
              </button>
            )}
            {applied && <div className="wmg-reader-applied">✓ Added to your budget</div>}
            <button className="wmg-onboard-skip" onClick={reset}>
              Import another file
            </button>
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
                <input type="number" value={r.balance} onChange={(e) => updateRow(i, "balance", e.target.value)} style={{ width: 90 }} />
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


