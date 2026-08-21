import React, { useState, useMemo, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { gbp, monthKey, formatMonthKey, getActiveMode } from "../lib/finance";
import { Card, ProgressBar, InlinePill, CategoryTooltip } from "../components/ui";

export const SUB_AVATAR_TONES = ["brand", "coral", "sage", "gold", "rust"];


export function SubscriptionRow({ sub, index, onEdit, onToggleCancel, onRemove }) {
  const [expanded, setExpanded] = useState(false);
  const tone = SUB_AVATAR_TONES[index % SUB_AVATAR_TONES.length];
  const initial = (sub.name || "?").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className={`wmg-sub-card ${sub.cancelled ? "cancelled" : ""}`}>
      <button type="button" className="wmg-sub-summary" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span className={`wmg-sub-avatar tone-${tone}`}>{initial}</span>
        <span className="wmg-sub-summary-info">
          <span className="wmg-sub-summary-name">{sub.name}</span>
          {sub.cancelled ? (
            <span className="wmg-sub-summary-cancelled">Cancelled</span>
          ) : sub.flagged ? (
            <span className="wmg-flag">Consider cutting</span>
          ) : null}
        </span>
        <span className="wmg-sub-summary-right">
          <span className="wmg-sub-summary-amount">{gbp(sub.amount)}</span>
          <span className="wmg-sub-summary-freq">/month</span>
        </span>
        <span className={`wmg-sub-chevron ${expanded ? "open" : ""}`} aria-hidden="true">›</span>
      </button>

      {expanded && (
        <div className="wmg-sub-edit">
          <input
            className="wmg-input wmg-sub-name-input"
            value={sub.name}
            onChange={(e) => onEdit("name", e.target.value)}
          />
          <div className="wmg-sub-edit-row">
            <input
              className="wmg-input wmg-sub-amount-input"
              type="number"
              value={sub.amount}
              onChange={(e) => onEdit("amount", Number(e.target.value))}
            />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--paper-dim)" }}>
              <input type="checkbox" checked={sub.flagged} onChange={(e) => onEdit("flagged", e.target.checked)} />
              flag
            </label>
          </div>
          <div className="wmg-sub-edit-actions">
            <button
              className={`wmg-toggle-btn ${sub.cancelled ? "is-cancelled" : ""}`}
              onClick={onToggleCancel}
              title={sub.cancelled ? "Bring this back into your monthly total" : "Stops counting it in your total — doesn't cancel it with the actual provider, and you can bring it back anytime"}
            >
              {sub.cancelled ? "Restore" : "Mark cancelled"}
            </button>
            <button
              className="wmg-icon-btn"
              onClick={onRemove}
              aria-label="Remove"
              title="Delete this row completely — use this if you added it by mistake, not for cancelling a subscription you actually have"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}


export const CATEGORY_COLORS = ["#8B5CF6", "#FF9166", "#FFCE6B", "#A6A3D6", "#FF6FA5", "#4FD1C5", "#FF5C7A", "#6C4CE0", "#FF8FA6", "#9C97C4"];

// Common UK household bills — used to nudge anyone entering their bills if
// something obvious looks missing. Matched by loose substring against the
// names of items already in their bill categories, so "Electricity & gas"
// covers both Electricity and Gas, "Home insurance" covers Home, etc.

export const COMMON_BILLS = [
  { name: "Council Tax", match: ["council tax"] },
  { name: "Electricity", match: ["electric"] },
  { name: "Gas", match: ["gas"] },
  { name: "Water", match: ["water"] },
  { name: "Broadband / Internet", match: ["broadband", "internet", "wifi"] },
  { name: "Mobile phone", match: ["mobile", "phone"] },
  { name: "TV Licence", match: ["tv licence", "tv license"] },
  { name: "Home insurance", match: ["home insurance", "buildings insurance", "contents insurance"] },
  { name: "Car insurance", match: ["car insurance"] },
  { name: "Life insurance", match: ["life insurance"] },
];

/* Collapsible expense category card — badge/budget/progress always visible at
   a glance, but the individual line items (the real source of visual clutter
   on this tab) stay hidden until you tap to expand. */

export function CategoryCard({ cat, subtotal, onUpdateCategoryField, onRemoveCategory, onAddItem, onRemoveItem, onUpdateItem }) {
  const [expanded, setExpanded] = useState(false);
  const itemCount = cat.items.length;
  const initial = (cat.name || "?").trim().charAt(0).toUpperCase() || "?";

  // Collapses every item in this category into a single "Total" item holding
  // the combined amount — for anyone who'd rather type one number than
  // itemize each line. Fully reversible: "+ Add item" still works normally
  // afterwards to break it back out.
  const combineIntoTotal = () => {
    if (cat.items.length <= 1) return;
    const total = cat.items.reduce((s, i) => s + Number(i.amount || 0), 0);
    const [first, ...rest] = cat.items;
    onUpdateItem(first.id, "name", "Total");
    onUpdateItem(first.id, "amount", total);
    rest.forEach((i) => onRemoveItem(i.id));
  };

  return (
    <Card className="wmg-cat-card">
      <button type="button" className="wmg-cat-summary-toggle" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        <span className={`wmg-cat-badge tone-${cat.type === "essential" ? "brand" : "coral"}`}>{initial}</span>
        <span className="wmg-cat-summary-name-wrap">
          <span className="wmg-cat-summary-name">{cat.name}</span>
          <span className={`wmg-tag ${cat.type}`}>{cat.type}</span>
        </span>
        <span className={`wmg-sub-chevron ${expanded ? "open" : ""}`} aria-hidden="true">›</span>
      </button>

      <div className="wmg-cat-budget-row">
        <div className="wmg-cat-budget-info">
          <div className="wmg-cat-budget-label">
            <span className={subtotal > cat.budget ? "wmg-cat-budget-over" : ""}>{gbp(subtotal)}</span> of{" "}
            <InlinePill
              value={cat.budget}
              onChange={(v) => onUpdateCategoryField(cat.id, "budget", v)}
              formatter={(v) => gbp(v)}
              ariaLabel={`${cat.name} monthly budget`}
            />{" "}
            budget · {itemCount} {itemCount === 1 ? "item" : "items"}
          </div>
          <ProgressBar value={subtotal} max={cat.budget} tone={subtotal > cat.budget ? "rust" : "sage"} />
        </div>
      </div>

      {expanded && (
        <div className="wmg-cat-edit">
          <div className="wmg-cat-edit-row">
            <InlinePill
              value={cat.name}
              type="text"
              onChange={(v) => onUpdateCategoryField(cat.id, "name", v)}
              ariaLabel="Category name"
              minWidth={100}
            />
            <select
              className="wmg-select wmg-cat-type-select"
              value={cat.type}
              onChange={(e) => onUpdateCategoryField(cat.id, "type", e.target.value)}
            >
              <option value="essential">Essential</option>
              <option value="lifestyle">Lifestyle</option>
            </select>
            <button className="wmg-icon-btn" onClick={onRemoveCategory} aria-label="Remove category">✕</button>
          </div>
          {cat.items.length > 0 && (
            <div className="wmg-item-grid-head">
              <span>Item</span>
              <span style={{ textAlign: "right" }}>Monthly cost</span>
              <span />
            </div>
          )}
          {cat.items.map((item) => (
            <div className="wmg-item-line" key={item.id}>
              <InlinePill
                value={item.name}
                type="text"
                onChange={(v) => onUpdateItem(item.id, "name", v)}
                ariaLabel="Item name"
                fill
              />
              <InlinePill
                value={item.amount}
                onChange={(v) => onUpdateItem(item.id, "amount", v)}
                formatter={(v) => gbp(v)}
                ariaLabel={`${item.name} monthly cost`}
                fill
                align="right"
              />
              <button className="wmg-icon-btn" onClick={() => onRemoveItem(item.id)} aria-label="Remove item">✕</button>
            </div>
          ))}
          <button className="wmg-add-btn" onClick={onAddItem}>+ Add item</button>
          {cat.items.length > 1 && (
            <button type="button" className="wmg-onboard-skip" style={{ marginLeft: 10 }} onClick={combineIntoTotal}>
              Combine into one total
            </button>
          )}
        </div>
      )}
    </Card>
  );
}


export function EditSpendingSheet({ profile, addCategory, removeCategory, updateCategoryField, addItem, removeItem, updateItem, addArrayItem, onboardingEstimateItem, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="wmg-more-sheet-backdrop" onClick={onClose}>
      <div className="wmg-more-sheet wmg-edit-spending-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wmg-more-sheet-handle" />
        <div className="wmg-more-sheet-title">
          Edit my spending
          <button className="wmg-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="wmg-section-desc">
          Add what applies to your household — item by item for detail, or just type one number per category and
          combine the rest. Mark each category essential or lifestyle — this drives your score and cash flow.
        </div>
        {onboardingEstimateItem && (
          <Card style={{ border: "1px dashed var(--gold)", background: "var(--gold-soft)" }}>
            <div className="wmg-eyebrow" style={{ marginBottom: 4 }}>Improve your spending picture</div>
            <div className="wmg-sub" style={{ color: "var(--paper)", fontWeight: 600, marginBottom: 4 }}>
              You estimated {gbp(onboardingEstimateItem.amount)} of monthly spending during setup.
            </div>
            <div className="wmg-sub">
              Add your regular household and lifestyle costs below to make your forecasts more accurate — this
              replaces the single estimate with a proper breakdown.
            </div>
          </Card>
        )}
        {profile.expenseCategories.map((cat) => {
          const subtotal = cat.items.reduce((s, i) => s + Number(i.amount || 0), 0);
          return (
            <CategoryCard
              key={cat.id}
              cat={cat}
              subtotal={subtotal}
              onUpdateCategoryField={updateCategoryField}
              onRemoveCategory={() => removeCategory(cat.id)}
              onAddItem={() => addItem(cat.id)}
              onRemoveItem={(itemId) => removeItem(cat.id, itemId)}
              onUpdateItem={(itemId, field, value) => updateItem(cat.id, itemId, field, value)}
            />
          );
        })}
        <button className="wmg-add-btn" onClick={addCategory} style={{ marginBottom: 8 }}>+ Add category</button>
        <button className="wmg-btn-primary" style={{ marginTop: 12 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}


export function IncomeTab({ profile, totals, setField, addCategory, removeCategory, updateCategoryField, addItem, addNamedItem, removeItem, updateItem, toggleSub, updateArrayItem, addArrayItem, removeArrayItem, saveSpendingSnapshot }) {
  const activeMode = getActiveMode(profile);
  const [editSpendingOpen, setEditSpendingOpen] = useState(false);
  const [billCheckStatus, setBillCheckStatus] = useState("idle"); // idle | loading | done | error
  const [billCheckResults, setBillCheckResults] = useState(null);
  const [billCheckError, setBillCheckError] = useState("");
  const [spendingInsightStatus, setSpendingInsightStatus] = useState("idle"); // idle | loading | done | error
  const [spendingInsightResults, setSpendingInsightResults] = useState(null);
  const [spendingInsightError, setSpendingInsightError] = useState("");

  const onboardingEstimateItem = useMemo(() => {
    for (const cat of profile.expenseCategories) {
      const item = cat.items.find((i) => i.isOnboardingEstimate);
      if (item) return item;
    }
    return null;
  }, [profile.expenseCategories]);

  const categoryChartData = useMemo(() => {
    const rows = profile.expenseCategories
      .map((cat) => ({ name: cat.name, value: cat.items.reduce((s, i) => s + Number(i.amount || 0), 0) }))
      .filter((r) => r.value > 0);
    if (totals.subsTotal > 0) rows.push({ name: "Subscriptions", value: totals.subsTotal });
    return rows.sort((a, b) => b.value - a.value);
  }, [profile.expenseCategories, totals.subsTotal]);
  const categoryChartTotal = categoryChartData.reduce((s, r) => s + r.value, 0) || 1;

  // Spending history: sorted oldest-to-newest for the trend chart, plus
  // whether the CURRENT calendar month has already been saved (so the nudge
  // only shows when there's actually something new to save).
  const sortedSnapshots = useMemo(
    () => [...profile.spendingSnapshots].sort((a, b) => (a.month > b.month ? 1 : a.month < b.month ? -1 : 0)),
    [profile.spendingSnapshots]
  );
  const currentMonthKey = monthKey();
  const currentMonthSnapshot = sortedSnapshots.find((s) => s.month === currentMonthKey);
  const previousSnapshot = sortedSnapshots.length ? sortedSnapshots[sortedSnapshots.length - 1] : null;
  const previousSnapshotIsCurrentMonth = previousSnapshot?.month === currentMonthKey;
  // The most recent snapshot that ISN'T this month — the genuine "last
  // saved period" to compare against, whether or not this month has also
  // been saved yet.
  const comparisonSnapshot = previousSnapshotIsCurrentMonth
    ? sortedSnapshots[sortedSnapshots.length - 2] || null
    : previousSnapshot;

  // Bills: the "Housing & utilities" and "Insurance & protection" categories
  // (or any category the person has explicitly flagged as isBills) treated
  // as a distinct, guided entry flow — asked for explicitly, ticked off once
  // complete, then collapsed into a summary chart. Editing re-opens entry mode.
  const billsCategories = useMemo(() => profile.expenseCategories.filter((c) => c.isBills), [profile.expenseCategories]);
  const billsItemsFlat = useMemo(() => billsCategories.flatMap((c) => c.items), [billsCategories]);
  const billsTotal = billsItemsFlat.reduce((s, i) => s + Number(i.amount || 0), 0);
  const missingBills = useMemo(() => {
    const namesLower = billsItemsFlat.map((i) => (i.name || "").toLowerCase());
    return COMMON_BILLS.filter((b) => !b.match.some((m) => namesLower.some((n) => n.includes(m))));
  }, [billsItemsFlat]);
  const billsChartData = useMemo(() => {
    return billsItemsFlat
      .filter((i) => Number(i.amount) > 0)
      .map((i) => ({ name: i.name, value: Number(i.amount) }))
      .sort((a, b) => b.value - a.value);
  }, [billsItemsFlat]);

  const addMissingBill = (billDef) => {
    if (!billsCategories.length) return;
    const isInsurance = billDef.name.toLowerCase().includes("insurance");
    const target =
      billsCategories.find((c) => c.name.toLowerCase().includes("insurance") === isInsurance) || billsCategories[0];
    addNamedItem(target.id, billDef.name);
  };

  const checkBills = async () => {
    const billsForCheck = billsItemsFlat.filter((i) => Number(i.amount) > 0);
    if (!billsForCheck.length) return;
    setBillCheckStatus("loading");
    setBillCheckError("");
    try {
      const resp = await fetch("/api/check-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bills: billsForCheck.map((i) => ({ name: i.name, amount: i.amount })) }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      // zip results back up with the names/amounts we sent, so the UI doesn't
      // need to re-derive anything from billsItemsFlat (which could change
      // under it if the person edits while this is loading)
      setBillCheckResults(billsForCheck.map((i, idx) => ({ name: i.name, amount: i.amount, ...data.results[idx] })));
      setBillCheckStatus("done");
    } catch (e) {
      setBillCheckStatus("error");
      setBillCheckError(e.message || "Couldn't check your bills right now.");
    }
  };

  const getSpendingInsight = async () => {
    if (!categoryChartData.length) return;
    setSpendingInsightStatus("loading");
    setSpendingInsightError("");
    try {
      const resp = await fetch("/api/spending-insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categories: categoryChartData.map((r) => ({ name: r.name, value: r.value })),
          income: totals.income,
          // Only sent when a real prior snapshot exists — never fabricated,
          // see saveSpendingSnapshot's comment on why this can't be inferred.
          previousPeriod: comparisonSnapshot
            ? { month: formatMonthKey(comparisonSnapshot.month), totalSpending: comparisonSnapshot.totalSpending }
            : null,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      setSpendingInsightResults(data.insights || []);
      setSpendingInsightStatus("done");
    } catch (e) {
      setSpendingInsightStatus("error");
      setSpendingInsightError(e.message || "Couldn't generate insight right now.");
    }
  };

  return (
    <>
      <div className="wmg-section-title">Income</div>
      <Card>
        <div className="wmg-two-col">
          <div className="wmg-sentence-card">
            You take home <strong>{gbp(totals.income)}</strong> a month
            {profile.incomes.length > 1 ? ` across ${profile.incomes.length} income sources` : ""}.
          </div>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>This month, total spend</div>
            <div className="wmg-figure tone-paper">{gbp(totals.essential + totals.debtPayments + totals.lifestyle)}</div>
          </div>
        </div>
      </Card>

      <div className="wmg-section-title">Income sources</div>
      <Card style={{ marginBottom: 10 }}>
        <div className="wmg-sub">
          Add every regular source of income here — your salary, a partner's income, freelance work, benefits. We
          add them together for the total above.
        </div>
      </Card>
      <Card>
        {profile.incomes.map((inc) => (
          <div className="wmg-life-event-card" key={inc.id}>
            <div className="wmg-life-event-row-top">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="wmg-field-label">Name</div>
                <input
                  className="wmg-input"
                  value={inc.name}
                  onChange={(e) => updateArrayItem("incomes")(inc.id, "name", e.target.value)}
                />
              </div>
              {profile.incomes.length > 1 && (
                <button className="wmg-icon-btn" onClick={() => removeArrayItem("incomes")(inc.id)} aria-label="Remove">
                  ✕
                </button>
              )}
            </div>
            <div className="wmg-life-event-row-bottom">
              <div>
                <div className="wmg-field-label">Monthly amount</div>
                <input
                  className="wmg-input"
                  type="number"
                  value={inc.amount}
                  onChange={(e) => updateArrayItem("incomes")(inc.id, "amount", Number(e.target.value))}
                />
              </div>
            </div>
          </div>
        ))}
        <button
          className="wmg-add-btn"
          onClick={addArrayItem("incomes", { name: "New income", amount: 0 })}
        >
          + Add income source
        </button>
      </Card>

      {activeMode === "guided" && (
        <Card className="wmg-guided-summary-card">
          <p style={{ margin: 0 }}>
            After everything you've added so far, you have <strong>{gbp(Math.round(totals.available))}</strong> left
            each month.
            {categoryChartData.length > 0 && (
              <> Your biggest spending category is <strong>{categoryChartData[0].name}</strong> at {gbp(categoryChartData[0].value)}.</>
            )}
          </p>
        </Card>
      )}

      {billsCategories.length > 0 && (
        <>
          <div className="wmg-section-title">Your bills</div>
          {!profile.billsConfirmed ? (
            <>
              <Card style={{ marginBottom: 10 }}>
                <div className="wmg-sub">
                  Add every regular bill you pay — we'll flag anything obvious that looks missing. Tick off once
                  you're done and this turns into a chart, editable any time from "Edit my bills".
                </div>
              </Card>
              {billsCategories.map((cat) => {
                const subtotal = cat.items.reduce((s, i) => s + Number(i.amount || 0), 0);
                return (
                  <CategoryCard
                    key={cat.id}
                    cat={cat}
                    subtotal={subtotal}
                    onUpdateCategoryField={updateCategoryField}
                    onRemoveCategory={() => removeCategory(cat.id)}
                    onAddItem={() => addItem(cat.id)}
                    onRemoveItem={(itemId) => removeItem(cat.id, itemId)}
                    onUpdateItem={(itemId, field, value) => updateItem(cat.id, itemId, field, value)}
                  />
                );
              })}
              {missingBills.length > 0 && (
                <Card style={{ marginBottom: 10 }}>
                  <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Common bills you haven't added yet</div>
                  <div className="wmg-chip-row" style={{ flexWrap: "wrap", overflow: "visible" }}>
                    {missingBills.map((b) => (
                      <button
                        key={b.name}
                        type="button"
                        className="wmg-add-btn"
                        style={{ width: "auto", flex: "0 0 auto" }}
                        onClick={() => addMissingBill(b)}
                      >
                        + {b.name}
                      </button>
                    ))}
                  </div>
                </Card>
              )}
              <button
                className="wmg-btn-primary"
                style={{ margin: "4px 0 20px", width: "100%" }}
                onClick={() => setField(["billsConfirmed"])(true)}
              >
                ✓ I've added all my bills
              </button>
            </>
          ) : (
            <Card style={{ marginBottom: 20 }}>
              <div className="wmg-category-chart-row">
                <div style={{ width: 140, height: 140, flexShrink: 0 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={billsChartData} dataKey="value" nameKey="name" innerRadius={40} outerRadius={68} paddingAngle={2} strokeWidth={0}>
                        {billsChartData.map((entry, i) => (
                          <Cell key={entry.name} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip content={<CategoryTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="wmg-category-legend">
                  {billsChartData.map((row, i) => (
                    <div className="wmg-category-legend-item" key={row.name}>
                      <span className="wmg-swatch" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                      <span className="wmg-category-legend-name">{row.name}</span>
                      <span className="wmg-category-legend-val">{gbp(row.value)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="wmg-subs-total">
                <span>Total bills</span>
                <span>{gbp(billsTotal, 2)}/month</span>
              </div>

              {billCheckStatus === "idle" && (
                <button className="wmg-add-btn" style={{ marginTop: 10 }} onClick={checkBills}>
                  Check my bills against typical UK costs
                </button>
              )}
              {billCheckStatus === "loading" && (
                <div className="wmg-sub" style={{ marginTop: 10, textAlign: "center" }}>Checking your bills…</div>
              )}
              {billCheckStatus === "error" && (
                <div style={{ marginTop: 10 }}>
                  <div className="wmg-sub" style={{ color: "var(--rust)" }}>{billCheckError}</div>
                  <button className="wmg-add-btn" style={{ marginTop: 6 }} onClick={checkBills}>Try again</button>
                </div>
              )}
              {billCheckStatus === "done" && billCheckResults && (
                <div style={{ marginTop: 12 }}>
                  {billCheckResults.every((r) => r.verdict === "typical") ? (
                    <div className="wmg-sub" style={{ color: "var(--sage)" }}>
                      Nothing stands out — your bills look in line with typical UK costs.
                    </div>
                  ) : (
                    <>
                      <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Worth a second look</div>
                      {billCheckResults
                        .filter((r) => r.verdict !== "typical")
                        .map((r) => (
                          <div key={r.name} className="wmg-sub" style={{ marginBottom: 6, display: "flex", gap: 6 }}>
                            <span>{r.verdict === "high" ? "⚠️" : "ℹ️"}</span>
                            <span>
                              <strong style={{ color: "var(--paper)" }}>{r.name}</strong> ({gbp(r.amount)}) — {r.note}
                            </span>
                          </div>
                        ))}
                    </>
                  )}
                  <div className="wmg-sub" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                    A rough, directional check against typical UK household costs — not a quote or advice to switch anything.
                  </div>
                </div>
              )}

              <button className="wmg-add-btn" style={{ marginTop: 10 }} onClick={() => setField(["billsConfirmed"])(false)}>
                Edit my bills
              </button>
            </Card>
          )}
        </>
      )}

      {categoryChartData.length > 0 ? (
        <>
          <div className="wmg-section-title">Where it actually goes</div>
          <Card>
            <div className="wmg-category-chart-row">
              <div style={{ width: 160, height: 160, flexShrink: 0 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={categoryChartData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                      {categoryChartData.map((entry, i) => (
                        <Cell key={entry.name} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CategoryTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="wmg-category-legend">
                {categoryChartData.map((row, i) => (
                  <div className="wmg-category-legend-item" key={row.name}>
                    <span className="wmg-swatch" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                    <span className="wmg-category-legend-name">{row.name}</span>
                    <span className="wmg-category-legend-pct">{Math.round((row.value / categoryChartTotal) * 100)}%</span>
                    <span className="wmg-category-legend-val">{gbp(row.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          <Card style={{ marginBottom: 20 }}>
            {spendingInsightStatus === "idle" && (
              <button className="wmg-add-btn" onClick={getSpendingInsight}>
                Get an AI read on this breakdown
              </button>
            )}
            {spendingInsightStatus === "loading" && (
              <div className="wmg-sub" style={{ textAlign: "center" }}>Looking at your breakdown…</div>
            )}
            {spendingInsightStatus === "error" && (
              <div>
                <div className="wmg-sub" style={{ color: "var(--rust)" }}>{spendingInsightError}</div>
                <button className="wmg-add-btn" style={{ marginTop: 6 }} onClick={getSpendingInsight}>Try again</button>
              </div>
            )}
            {spendingInsightStatus === "done" && spendingInsightResults && (
              <div>
                <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>What stands out right now</div>
                {spendingInsightResults.map((line, i) => (
                  <div key={i} className="wmg-sub" style={{ marginBottom: 6 }}>• {line}</div>
                ))}
                <div className="wmg-sub" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                  {comparisonSnapshot
                    ? `Includes a genuine comparison to your saved ${formatMonthKey(comparisonSnapshot.month)} snapshot — total spending only, not a category-by-category comparison.`
                    : "Based on this month's snapshot only — save a spending snapshot below to unlock a genuine month-over-month comparison next time."}
                </div>
              </div>
            )}
          </Card>

          <div className="wmg-section-title">Spending history</div>
          <Card style={{ marginBottom: 20 }}>
            {!currentMonthSnapshot ? (
              <>
                <div className="wmg-sentence-card" style={{ marginBottom: 10 }}>
                  {sortedSnapshots.length === 0
                    ? "Save a snapshot of this month's spending to start building a real history — future months can then be compared honestly, not guessed."
                    : `You haven't saved a snapshot for ${formatMonthKey(currentMonthKey)} yet.`}
                </div>
                <button className="wmg-add-btn" onClick={saveSpendingSnapshot}>
                  Save this month's snapshot ({gbp(categoryChartTotal)})
                </button>
              </>
            ) : (
              <>
                <div className="wmg-sentence-card" style={{ marginBottom: 10 }}>
                  {formatMonthKey(currentMonthKey)} saved: <strong style={{ color: "var(--paper)" }}>{gbp(currentMonthSnapshot.totalSpending)}</strong>
                  {comparisonSnapshot && (
                    <>
                      {" "}— {currentMonthSnapshot.totalSpending >= comparisonSnapshot.totalSpending ? "up" : "down"}{" "}
                      {gbp(Math.abs(currentMonthSnapshot.totalSpending - comparisonSnapshot.totalSpending))} vs{" "}
                      {formatMonthKey(comparisonSnapshot.month)}
                    </>
                  )}
                </div>
                <button className="wmg-add-btn" onClick={saveSpendingSnapshot}>
                  Update this month's snapshot ({gbp(categoryChartTotal)})
                </button>
              </>
            )}

            {sortedSnapshots.length >= 2 && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: "1px solid var(--hair)" }}>
                <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Total spending over time</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {sortedSnapshots.map((s, i) => {
                    const prev = i > 0 ? sortedSnapshots[i - 1] : null;
                    const barPct = Math.round((s.totalSpending / Math.max(...sortedSnapshots.map((x) => x.totalSpending), 1)) * 100);
                    return (
                      <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="wmg-sub" style={{ width: 64, flexShrink: 0 }}>{formatMonthKey(s.month)}</span>
                        <div style={{ flex: 1, background: "var(--ink-3)", borderRadius: 6, overflow: "hidden", height: 18 }}>
                          <div style={{ width: `${Math.max(barPct, 4)}%`, height: "100%", background: "var(--brand)", borderRadius: 6 }} />
                        </div>
                        <span className="wmg-mono" style={{ width: 76, textAlign: "right", flexShrink: 0, fontSize: 12.5 }}>{gbp(s.totalSpending)}</span>
                        {prev && (
                          <span
                            className="wmg-sub"
                            style={{ width: 60, textAlign: "right", flexShrink: 0, fontSize: 11, color: s.totalSpending > prev.totalSpending ? "var(--rust)" : "var(--sage)" }}
                          >
                            {s.totalSpending > prev.totalSpending ? "▲" : s.totalSpending < prev.totalSpending ? "▼" : "—"}{" "}
                            {gbp(Math.abs(s.totalSpending - prev.totalSpending))}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </Card>

        </>
      ) : (
        <Card style={{ marginTop: 4 }}>
          <p style={{ marginBottom: 12 }}>Nothing added yet — add your outgoings to see where your money actually goes.</p>
        </Card>
      )}

      <button className="wmg-btn-primary" style={{ margin: "8px 0 20px" }} onClick={() => setEditSpendingOpen(true)}>
        Edit my spending
      </button>

      {editSpendingOpen && (
        <EditSpendingSheet
          profile={profile}
          addCategory={addCategory}
          removeCategory={removeCategory}
          updateCategoryField={updateCategoryField}
          addItem={addItem}
          removeItem={removeItem}
          updateItem={updateItem}
          addArrayItem={addArrayItem}
          onboardingEstimateItem={onboardingEstimateItem}
          onClose={() => setEditSpendingOpen(false)}
        />
      )}

      <div className="wmg-section-title">Subscriptions</div>
      <Card style={{ marginBottom: 10 }}>
        <div className="wmg-sub">
          List anything that charges you regularly — streaming, apps, gym, subscription boxes. We'll flag ones
          worth reconsidering. Marking one cancelled just stops it counting in your total here — it doesn't cancel
          it with the provider, so you'll still need to do that yourself.
        </div>
      </Card>
      <Card>
        <div className="wmg-sub-list">
          {profile.subscriptions.map((s, i) => (
            <SubscriptionRow
              key={s.id}
              sub={s}
              index={i}
              onEdit={(field, value) => updateArrayItem("subscriptions")(s.id, field, value)}
              onToggleCancel={() => toggleSub(s.id)}
              onRemove={() => removeArrayItem("subscriptions")(s.id)}
            />
          ))}
        </div>
        <button className="wmg-add-btn" onClick={addArrayItem("subscriptions", { name: "New subscription", amount: 0, flagged: false, cancelled: false })} style={{ marginTop: 10 }}>
          + Add subscription
        </button>
        <div className="wmg-subs-total">
          <span>Active total</span>
          <span>{gbp(totals.subsTotal, 2)}/month</span>
        </div>
      </Card>
    </>
  );
}


