import React, { useState, useMemo, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { gbp, getActiveMode, nextId } from "../lib/finance";
import { Card, ProgressBar, InlinePill, CategoryTooltip, NumberInput } from "../components/ui";
import { API_BASE } from "../lib/apiBase";
import { supabase } from "../lib/supabaseClient";

export const SUB_AVATAR_TONES = ["brand", "coral", "sage", "gold", "rust"];

// Small reusable "this needs Premium" prompt — used everywhere an
// AI-powered feature is gated (bill checker, spending insight, Pension
// Reader). Wording matches the pattern used on Overview's own upgrade
// card: "Start trial" for someone who's never subscribed, "Renew
// Premium" for someone whose subscription lapsed (canceled/past_due).
export function PremiumGate({ subscriptionStatus, onUpgrade, text }) {
  const isLapsed = subscriptionStatus === "canceled" || subscriptionStatus === "past_due";
  return (
    <div className="wmg-premium-gate" style={{ textAlign: "center", padding: "8px 0" }}>
      <div className="wmg-sub" style={{ marginBottom: 10 }}>{text}</div>
      <button className="wmg-btn-primary" onClick={onUpgrade}>
        {isLapsed ? "Renew Premium" : "See Premium plans"}
      </button>
    </div>
  );
}


export function SubscriptionRow({ sub, index, onEdit, onToggleCancel, onRemove, startEditing = false }) {
  const [expanded, setExpanded] = useState(startEditing);
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
            <NumberInput
              className="wmg-input wmg-sub-amount-input"
              value={sub.amount}
              onChange={(v) => onEdit("amount", v)}
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


export const CATEGORY_COLORS = ["#8A7FC9", "#B5652F", "#97701A", "#5C6BA3", "#C97099", "#4A7A3A", "#B2504F", "#6C5FB0", "#C9708F", "#7972B5"];

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

function ItemRow({ item, onUpdateItem, onRemoveItem }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <div className="wmg-item-line">
        <span style={{ flex: 1, fontSize: 13.5, color: "var(--paper)" }}>{item.name}</span>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--paper)" }}>{gbp(item.amount)}</span>
        <button type="button" className="wmg-item-remove-btn" onClick={() => setEditing(true)} aria-label={`Edit ${item.name}`}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
          </svg>
        </button>
      </div>
    );
  }
  return (
    <div className="wmg-item-line">
      <InlinePill value={item.name} type="text" onChange={(v) => onUpdateItem(item.id, "name", v)} ariaLabel="Item name" fill />
      <InlinePill value={item.amount} onChange={(v) => onUpdateItem(item.id, "amount", v)} formatter={(v) => gbp(v)} ariaLabel={`${item.name} monthly cost`} fill align="right" />
      <button type="button" className="wmg-item-remove-btn" onClick={() => setEditing(false)} aria-label="Done editing item">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
      </button>
      <button type="button" className="wmg-item-remove-btn" onClick={() => onRemoveItem(item.id)} aria-label="Remove item">✕</button>
    </div>
  );
}

// Shown when a category has real spending but no budget set yet (budget
// defaults to 0 on every new category, and stays 0 until someone edits it —
// which most people never do unprompted). Suggests current spend plus a
// little headroom, rounded to a friendly number, as a one-tap starting
// point rather than leaving them to type a figure from scratch. This also
// unblocks the budget-threshold notification check, which skips any
// category still sitting at a 0 budget.
function suggestedBudgetFor(subtotal) {
  const withHeadroom = subtotal * 1.1;
  return Math.ceil(withHeadroom / 10) * 10;
}

function BudgetSuggestion({ subtotal, onApply }) {
  const suggested = suggestedBudgetFor(subtotal);
  return (
    <div className="wmg-budget-suggestion">
      <span className="wmg-sub">No budget set yet — try {gbp(suggested)}?</span>
      <button type="button" className="wmg-onboard-skip" onClick={() => onApply(suggested)}>
        Use {gbp(suggested)}
      </button>
    </div>
  );
}

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
        </span>
        <span className={`wmg-sub-chevron ${expanded ? "open" : ""}`} aria-hidden="true">›</span>
      </button>

      <div className="wmg-cat-budget-row">
        <div className="wmg-cat-budget-info">
          <div className="wmg-cat-budget-label">
            <span className={subtotal > cat.budget ? "wmg-cat-budget-over" : ""}>{gbp(subtotal)}</span> of{" "}
            {expanded ? (
              <InlinePill
                value={cat.budget}
                onChange={(v) => onUpdateCategoryField(cat.id, "budget", v)}
                formatter={(v) => gbp(v)}
                ariaLabel={`${cat.name} monthly budget`}
              />
            ) : (
              gbp(cat.budget)
            )}{" "}
            budget · {itemCount} {itemCount === 1 ? "item" : "items"}
          </div>
          <ProgressBar value={subtotal} max={cat.budget} tone={subtotal > cat.budget ? "rust" : "sage"} />
          {cat.budget === 0 && subtotal > 0 && (
            <BudgetSuggestion subtotal={subtotal} onApply={(v) => onUpdateCategoryField(cat.id, "budget", v)} />
          )}
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
            <button type="button" className="wmg-item-remove-btn" onClick={onRemoveCategory} aria-label="Remove category">✕</button>
          </div>
          {cat.items.map((item) => (
            <ItemRow key={item.id} item={item} onUpdateItem={onUpdateItem} onRemoveItem={onRemoveItem} />
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

  const visibleCategories = profile.expenseCategories;

  return (
    <div className="wmg-more-sheet-backdrop" onClick={onClose}>
      <div className="wmg-more-sheet wmg-edit-spending-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="wmg-more-sheet-handle" />
        <div className="wmg-more-sheet-title">
          Edit my spending
          <button className="wmg-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="wmg-section-desc">
          Everything you spend each month — everyday household costs and discretionary spending together. Add your
          amounts, or add more categories if something's missing.
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

        {visibleCategories.map((cat) => {
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
        <button className="wmg-add-btn" onClick={() => addCategory()} style={{ marginBottom: 8 }}>
          + Add category
        </button>
        <button className="wmg-btn-primary" style={{ marginTop: 12 }} onClick={onClose}>Done</button>
      </div>
    </div>
  );
}


export function IncomeSourceCard({ inc, canRemove, updateArrayItem, removeArrayItem, startEditing = false }) {
  const [editing, setEditing] = useState(startEditing);
  return (
    <div className="wmg-life-event-card">
      <div className="wmg-life-event-row-top">
        {editing ? (
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="wmg-field-label">Name</div>
            <input
              className="wmg-input"
              value={inc.name}
              onChange={(e) => updateArrayItem("incomes")(inc.id, "name", e.target.value)}
            />
          </div>
        ) : (
          <span className="wmg-entry-title" style={{ fontSize: 15.5 }}>{inc.name}</span>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="wmg-entry-edit-btn" onClick={() => setEditing((e) => !e)} aria-label={editing ? "Done editing income source" : "Edit income source"}>
            {editing ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 20h9" />
                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
              </svg>
            )}
          </button>
          {canRemove && (
            <button className="wmg-icon-btn" onClick={() => removeArrayItem("incomes")(inc.id)} aria-label="Remove">
              ✕
            </button>
          )}
        </div>
      </div>
      {editing ? (
        <div className="wmg-life-event-row-bottom">
          <div>
            <div className="wmg-field-label">Monthly amount</div>
            <NumberInput
              className="wmg-input"
              value={inc.amount}
              onChange={(v) => updateArrayItem("incomes")(inc.id, "amount", v)}
            />
          </div>
        </div>
      ) : (
        <div className="wmg-sub" style={{ marginTop: 8 }}>{gbp(inc.amount)}/mo</div>
      )}
    </div>
  );
}


export function IncomeTab({ profile, totals, setField, addCategory, removeCategory, updateCategoryField, addItem, addNamedItem, removeItem, updateItem, toggleSub, updateArrayItem, addArrayItem, addArrayItemWithId, removeArrayItem, onAcceptDetectedSubscription, onDismissDetectedSubscription, onConfirmSubscriptionStopped, onKeepFlaggedSubscription, hasPremium, subscriptionStatus, onUpgrade }) {
  const [justAddedIncomeId, setJustAddedIncomeId] = useState(null);
  const handleAddIncome = () => {
    const id = nextId();
    addArrayItemWithId("incomes", { id, name: "New income", amount: 0 })();
    setJustAddedIncomeId(id);
  };
  const [justAddedSubId, setJustAddedSubId] = useState(null);
  const handleAddSubscription = () => {
    const id = nextId();
    addArrayItemWithId("subscriptions", { id, name: "New subscription", amount: 0, flagged: false, cancelled: false })();
    setJustAddedSubId(id);
  };
  const activeMode = getActiveMode(profile);
  const [editSpendingOpen, setEditSpendingOpen] = useState(false);
  const [billCheckStatus, setBillCheckStatus] = useState("idle"); // idle | loading | done | error
  const [billCheckResults, setBillCheckResults] = useState(null);
  const [billCheckError, setBillCheckError] = useState("");
  const [spendingInsightStatus, setSpendingInsightStatus] = useState("idle"); // idle | loading | done | error
  const [spendingInsightResults, setSpendingInsightResults] = useState(null);
  const [spendingInsightError, setSpendingInsightError] = useState("");
  // Drives the "what would you like to check?" wizard below. "picker"
  // shows the question; "all" shows every section exactly as this tab
  // has always worked (full parity, nothing hidden); the other four
  // values each show just one existing section. This is deliberately
  // just a *view filter* over sections/data that already exist — it
  // doesn't collect or duplicate anything the rest of the tab already
  // asks for.
  const [cashflowView, setCashflowView] = useState("picker");

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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/check-bills`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ bills: billsForCheck.map((i) => ({ name: i.name, amount: i.amount })) }),
      });
      const data = await resp.json();
      if (resp.status === 402) {
        setBillCheckStatus("locked");
        return;
      }
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
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/spending-insight`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          categories: categoryChartData.map((r) => ({ name: r.name, value: r.value })),
          income: totals.income,
        }),
      });
      const data = await resp.json();
      if (resp.status === 402) {
        setSpendingInsightStatus("locked");
        return;
      }
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
      {cashflowView === "picker" && (
        <>
          <div className="wmg-section-title">What would you like to check?</div>
          <div className="wmg-section-desc">
            Pick one to jump straight there, or see the whole picture at once. Nothing here asks you to enter
            anything twice — it's just a quicker way into what's already below.
          </div>
          <Card>
            <div className="wmg-sub-list">
              <button type="button" className="wmg-add-btn" onClick={() => setCashflowView("overview")}>
                How much do I have left each month?
              </button>
              {billsCategories.length > 0 && (
                <button type="button" className="wmg-add-btn" onClick={() => setCashflowView("bills")}>
                  Are my bills reasonable?
                </button>
              )}
              <button type="button" className="wmg-add-btn" onClick={() => setCashflowView("spending")}>
                Where's my everyday spending actually going?
              </button>
              <button type="button" className="wmg-add-btn" onClick={() => setCashflowView("subscriptions")}>
                What am I paying for on repeat?
              </button>
            </div>
            <button
              type="button"
              className="wmg-btn-primary"
              style={{ width: "100%", marginTop: 12 }}
              onClick={() => setCashflowView("all")}
            >
              Just show me everything
            </button>
          </Card>
        </>
      )}

      {cashflowView !== "picker" && (
        <button
          type="button"
          className="wmg-onboard-skip"
          style={{ marginBottom: 12 }}
          onClick={() => setCashflowView("picker")}
        >
          ← Choose something else to check
        </button>
      )}

      {(cashflowView === "overview" || cashflowView === "all") && (
        <>
      <div className="wmg-section-title">Income</div>
      <Card>
        <div className="wmg-two-col">
          <div className="wmg-sentence-card">
            You take home <strong>{gbp(totals.income)}</strong> a month
            {profile.incomes.length > 1 ? ` across ${profile.incomes.length} income sources` : ""}.
          </div>
          <div>
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>This month, total outgoings</div>
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
          <IncomeSourceCard
            key={inc.id}
            inc={inc}
            canRemove={profile.incomes.length > 1}
            updateArrayItem={updateArrayItem}
            removeArrayItem={removeArrayItem}
            startEditing={inc.id === justAddedIncomeId}
          />
        ))}
        <button
          className="wmg-add-btn"
          onClick={handleAddIncome}
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
        </>
      )}

      {(cashflowView === "bills" || cashflowView === "all") && billsCategories.length > 0 && (
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

              {!hasPremium && (billCheckStatus === "idle" || billCheckStatus === "locked") && (
                <PremiumGate
                  subscriptionStatus={subscriptionStatus}
                  onUpgrade={onUpgrade}
                  text="Checking your bills against typical UK costs is a Premium feature."
                />
              )}
              {hasPremium && billCheckStatus === "idle" && (
                <button className="wmg-add-btn" style={{ marginTop: 10 }} onClick={checkBills}>
                  Check my bills against typical UK costs
                </button>
              )}
              {billCheckStatus === "locked" && hasPremium && (
                // hasPremium is true client-side but the server still said
                // no (e.g. status just lapsed) — trust the server, not the
                // possibly-stale client prop.
                <PremiumGate
                  subscriptionStatus={subscriptionStatus}
                  onUpgrade={onUpgrade}
                  text="Checking your bills against typical UK costs is a Premium feature."
                />
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

      {(cashflowView === "spending" || cashflowView === "all") && (
        <>
        {categoryChartData.length > 0 ? (
        <>
          <div className="wmg-section-title">Where it actually goes</div>
          <div className="wmg-section-desc">
            Your day-to-day category spending — mortgage/rent, debt repayments and subscriptions are tracked
            separately, so they're not counted here.
          </div>
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
            {!hasPremium && (spendingInsightStatus === "idle" || spendingInsightStatus === "locked") && (
              <PremiumGate
                subscriptionStatus={subscriptionStatus}
                onUpgrade={onUpgrade}
                text="An AI read on your spending breakdown is a Premium feature."
              />
            )}
            {hasPremium && spendingInsightStatus === "idle" && (
              <button className="wmg-add-btn" onClick={getSpendingInsight}>
                Get an AI read on this breakdown
              </button>
            )}
            {spendingInsightStatus === "locked" && hasPremium && (
              <PremiumGate
                subscriptionStatus={subscriptionStatus}
                onUpgrade={onUpgrade}
                text="An AI read on your spending breakdown is a Premium feature."
              />
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
                  Based on this month's category breakdown.
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
        </>
      )}

      {(cashflowView === "subscriptions" || cashflowView === "all") && (
        <>
      <div className="wmg-section-title">Subscriptions</div>
      <Card style={{ marginBottom: 10 }}>
        <div className="wmg-sub">
          List anything that charges you regularly — streaming, apps, gym, subscription boxes. We'll flag ones
          worth reconsidering. Marking one cancelled just stops it counting in your total here — it doesn't cancel
          it with the provider, so you'll still need to do that yourself.
        </div>
      </Card>

      {!hasPremium && (!profile.pendingSubscriptions || profile.pendingSubscriptions.length === 0) && (
        <Card style={{ marginBottom: 10 }}>
          <PremiumGate
            subscriptionStatus={subscriptionStatus}
            onUpgrade={onUpgrade}
            text="Premium automatically spots subscriptions in your connected bank's transaction history — new ones, and ones that look like they've stopped."
          />
        </Card>
      )}

      {profile.pendingSubscriptions && profile.pendingSubscriptions.length > 0 && (
        <Card style={{ marginBottom: 10 }}>
          <div className="wmg-sub" style={{ marginBottom: 10 }}>
            Spotted in your connected bank's transaction history — check these before adding them.
          </div>
          <div className="wmg-sub-list">
            {profile.pendingSubscriptions.map((s) => (
              <div key={s.id} className="wmg-chip-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div className="wmg-sub" style={{ fontSize: 12 }}>
                    {gbp(s.rawAmount)}/{s.frequency === "weekly" ? "week" : "month"}
                    {s.frequency === "weekly" ? ` ≈ ${gbp(s.monthlyAmount)}/month` : ""} — seen {s.occurrences} time{s.occurrences === 1 ? "" : "s"}
                    {s.lastDate ? `, last on ${s.lastDate}` : ""}
                  </div>
                </div>
                <div className="wmg-chip-row" style={{ flexShrink: 0 }}>
                  <button type="button" className="wmg-onboard-skip" onClick={() => onDismissDetectedSubscription?.(s.id)}>
                    Dismiss
                  </button>
                  <button type="button" className="wmg-btn-primary" onClick={() => onAcceptDetectedSubscription?.(s)}>
                    Add
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {profile.pendingSubscriptionRemovals && profile.pendingSubscriptionRemovals.length > 0 && (
        <Card style={{ marginBottom: 10 }}>
          <div className="wmg-sub" style={{ marginBottom: 10 }}>
            These haven't shown up in your connected bank's recent transactions — still have them?
          </div>
          <div className="wmg-sub-list">
            {profile.pendingSubscriptionRemovals.map((r) => (
              <div key={r.id} className="wmg-chip-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 600 }}>{r.name}</div>
                <div className="wmg-chip-row" style={{ flexShrink: 0 }}>
                  <button type="button" className="wmg-onboard-skip" onClick={() => onKeepFlaggedSubscription?.(r.id)}>
                    Still have it
                  </button>
                  <button type="button" className="wmg-btn-primary" onClick={() => onConfirmSubscriptionStopped?.(r.id)}>
                    Mark cancelled
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

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
              startEditing={s.id === justAddedSubId}
            />
          ))}
        </div>
        <button className="wmg-add-btn" onClick={handleAddSubscription} style={{ marginTop: 10 }}>
          + Add subscription
        </button>
        <div className="wmg-subs-total">
          <span>Active total</span>
          <span>{gbp(totals.subsTotal, 2)}/month</span>
        </div>
      </Card>
        </>
      )}
    </>
  );
}


