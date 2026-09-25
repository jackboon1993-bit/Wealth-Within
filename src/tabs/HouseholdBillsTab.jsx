import React, { useState, useEffect, useRef } from "react";
import { gbp, nextId } from "../lib/finance";
import { Card, NumberInput } from "../components/ui";
// SubscriptionRow and PremiumGate live in IncomeTab.jsx (not ui.js) —
// reused as-is rather than duplicated. Subscription management moved
// here from the old Budget tab per the reshuffle: it's essential
// recurring spend, same as the bills above it on this page, so it
// belongs alongside them rather than on its own tab.
import { SubscriptionRow, PremiumGate } from "./IncomeTab";

const LOGO_DEV_TOKEN = import.meta.env.VITE_LOGO_DEV_TOKEN;

// A genuinely separate, simple page for entering essential household
// bills — electricity, gas, water, and the like. Built on request after
// the existing guided bills flow inside Budget (IncomeTab.jsx) proved
// too easy to lose track of on a long scroll, even after two attempts
// to fix navigation into it. This deliberately does far less than that
// flow: no multi-step wizard, no "confirm and it collapses into a
// summary" state — just a flat, always-editable list.
//
// Writes into the exact same underlying data as the old flow
// (profile.expenseCategories, filtered to type === "essential") rather
// than a separate bills store — so nothing about totals.essential,
// the score, or anywhere else that already reads essential spending
// needs to change, and there's only ever one real source of truth for
// what a household's essential spending actually is.

// The pre-selected list, on request — rather than starting from a blank
// "type a name" box, every household sees these ready to fill in a
// figure for straight away. Deliberately just the common, genuinely
// near-universal ones; anything unusual still fits through "Add another
// bill" below.
const COMMON_BILLS = ["Electricity", "Gas", "Water", "Council Tax", "Broadband", "Home insurance", "TV licence", "Mobile phone"];

export function HouseholdBillsTab({
  profile,
  addNamedItem,
  removeItem,
  updateItem,
  totals,
  toggleSub,
  updateArrayItem,
  addArrayItemWithId,
  removeArrayItem,
  onAcceptDetectedSubscription,
  onDismissDetectedSubscription,
  onConfirmSubscriptionStopped,
  onKeepFlaggedSubscription,
  hasPremium,
  subscriptionStatus,
  onUpgrade,
}) {
  const essentialCategories = profile.expenseCategories.filter((c) => c.type === "essential");
  // The first essential category is where new bills land. Most
  // households only have one ("Housing & utilities" or similar) — if
  // there are genuinely several, this keeps things simple rather than
  // asking someone to pick a category just to add "Electricity".
  const targetCategory = essentialCategories[0] || null;
  const [newBillName, setNewBillName] = useState("");
  // Guards the seeding effect below to run at most once per visit to
  // this page, regardless of re-renders — without it, each render
  // before the newly-added items actually land in profile would look
  // like "still missing" and re-trigger addNamedItem again, seeding
  // duplicates.
  const hasSeeded = useRef(false);

  useEffect(() => {
    if (!targetCategory || hasSeeded.current) return;
    hasSeeded.current = true;
    const existingNames = new Set(targetCategory.items.map((i) => i.name.toLowerCase()));
    COMMON_BILLS.forEach((name) => {
      if (!existingNames.has(name.toLowerCase())) addNamedItem(targetCategory.id, name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetCategory?.id]);

  const handleAdd = () => {
    if (!newBillName.trim() || !targetCategory) return;
    addNamedItem(targetCategory.id, newBillName.trim());
    setNewBillName("");
  };

  // Subscriptions — moved here from the old Budget tab (IncomeTab.jsx),
  // unchanged in behaviour: same detected/possibly-stopped review
  // flows, same SubscriptionRow editing (renewsOn, flag, cancel/
  // restore, remove), same active total.
  const [justAddedSubId, setJustAddedSubId] = useState(null);
  const handleAddSubscription = () => {
    const id = nextId();
    addArrayItemWithId("subscriptions", { id, name: "New subscription", amount: 0, flagged: false, cancelled: false })();
    setJustAddedSubId(id);
  };

  return (
    <>
      <div className="wmg-section-title">Household bills</div>
      <div className="wmg-section-desc">
        The usual essentials, ready to fill in — just add what you actually pay for each. Nothing here is pulled
        from your bank; every figure comes from you.
      </div>

      {!targetCategory ? (
        <Card>
          <div className="wmg-sub">
            There's no essential spending category set up yet. Add one from the Budget tab first — something
            like "Housing &amp; utilities" — then come back here to fill in the actual bills.
          </div>
        </Card>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 2px 6px", fontSize: 10.5, color: "var(--paper-dim)", fontWeight: 700 }}>
            <span style={{ flex: 1 }}>BILL</span>
            <span style={{ width: 48, flexShrink: 0, textAlign: "center" }}>DUE ON</span>
            <span style={{ width: 80, flexShrink: 0, textAlign: "center" }}>AMOUNT</span>
            <span style={{ width: 15, flexShrink: 0 }} />
          </div>
          <Card>
            {targetCategory.items.map((item) => (
              <div
                key={item.id}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderBottom: "0.5px solid var(--hair)" }}
              >
                <span style={{ flex: 1, fontSize: 13.5, color: "var(--paper)" }}>{item.name}</span>
                {/* "Due on" — new, on request, so this can feed the
                    forward-looking "coming up" forecast on Overview.
                    Same day-of-month approach as subscriptions'
                    renewsOn, for consistency across both. */}
                <NumberInput
                  className="wmg-input"
                  style={{ width: 48, flexShrink: 0 }}
                  value={item.dueOn || ""}
                  onChange={(v) => updateItem(targetCategory.id, item.id, "dueOn", Math.max(1, Math.min(31, Math.round(v) || 1)))}
                  placeholder="day"
                />
                <NumberInput
                  className="wmg-input"
                  style={{ width: 80, flexShrink: 0 }}
                  value={item.amount}
                  onChange={(v) => updateItem(targetCategory.id, item.id, "amount", v)}
                />
                <button
                  type="button"
                  className="wmg-icon-btn"
                  onClick={() => removeItem(targetCategory.id, item.id)}
                  aria-label={`Remove ${item.name}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </Card>

          <Card style={{ marginTop: 12 }}>
            <div className="wmg-field-label">Add another bill</div>
            <div className="wmg-sub" style={{ marginBottom: 8 }}>Anything not covered above — a service charge, ground rent, whatever it is.</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="wmg-input"
                style={{ flex: 1 }}
                placeholder="e.g. Ground rent"
                value={newBillName}
                onChange={(e) => setNewBillName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                }}
              />
              <button type="button" className="wmg-btn-primary" onClick={handleAdd} disabled={!newBillName.trim()}>
                Add
              </button>
            </div>
          </Card>

          <div className="wmg-sub" style={{ marginTop: 14, textAlign: "center" }}>
            Total: <strong style={{ color: "var(--paper)" }}>{gbp(targetCategory.items.reduce((s, i) => s + Number(i.amount || 0), 0))}</strong>/month
          </div>
        </>
      )}

      <div className="wmg-section-title" style={{ marginTop: 22 }}>Subscriptions</div>
      {(profile.subscriptions.length === 0 || LOGO_DEV_TOKEN) && (
        <Card style={{ marginBottom: 10 }}>
          {profile.subscriptions.length === 0 && (
            <div className="wmg-sub">
              List anything that charges you regularly — streaming, apps, gym, subscription boxes. We'll flag ones
              worth reconsidering. Marking one cancelled just stops it counting in your total here — it doesn't cancel
              it with the provider, so you'll still need to do that yourself.
            </div>
          )}
          {LOGO_DEV_TOKEN && (
            <div className="wmg-sub" style={{ marginTop: profile.subscriptions.length === 0 ? 8 : 0, fontSize: 11 }}>
              Logos provided by{" "}
              <a href="https://logo.dev" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
                Logo.dev
              </a>
            </div>
          )}
        </Card>
      )}

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
          <span>{gbp(totals?.subsTotal || 0, 2)}/month</span>
        </div>
      </Card>
    </>
  );
}
