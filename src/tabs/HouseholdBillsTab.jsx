import React, { useState } from "react";
import { gbp } from "../lib/finance";
import { Card, NumberInput } from "../components/ui";

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
export function HouseholdBillsTab({ profile, addNamedItem, removeItem, updateItem }) {
  const essentialCategories = profile.expenseCategories.filter((c) => c.type === "essential");
  // The first essential category is where new bills land. Most
  // households only have one ("Housing & utilities" or similar) — if
  // there are genuinely several, this keeps things simple rather than
  // asking someone to pick a category just to add "Electricity".
  const targetCategory = essentialCategories[0] || null;
  const [newBillName, setNewBillName] = useState("");

  const handleAdd = () => {
    if (!newBillName.trim() || !targetCategory) return;
    addNamedItem(targetCategory.id, newBillName.trim());
    setNewBillName("");
  };

  return (
    <>
      <div className="wmg-section-title">Household bills</div>
      <div className="wmg-section-desc">
        Add each regular bill — electricity, gas, water, council tax, broadband — and what it actually costs.
        This is exactly what feeds your essential spending everywhere else in the app.
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
          <Card>
            {targetCategory.items.length === 0 && (
              <div className="wmg-sub" style={{ marginBottom: 10 }}>Nothing added yet — start below.</div>
            )}
            {targetCategory.items.map((item) => (
              <div
                key={item.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "0.5px solid var(--hair)" }}
              >
                <input
                  className="wmg-input"
                  style={{ flex: 1 }}
                  value={item.name}
                  onChange={(e) => updateItem(targetCategory.id, item.id, "name", e.target.value)}
                />
                <NumberInput
                  className="wmg-input"
                  style={{ width: 90, flexShrink: 0 }}
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
            <div className="wmg-field-label">Add a bill</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <input
                className="wmg-input"
                style={{ flex: 1 }}
                placeholder="e.g. Electricity"
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
            <div className="wmg-sub" style={{ marginTop: 10 }}>
              A few common ones, if it helps: Electricity, Gas, Water, Council Tax, Broadband, Home insurance, TV
              licence, Mobile phone.
            </div>
          </Card>

          <div className="wmg-sub" style={{ marginTop: 14, textAlign: "center" }}>
            Total: <strong style={{ color: "var(--paper)" }}>{gbp(targetCategory.items.reduce((s, i) => s + Number(i.amount || 0), 0))}</strong>/month
          </div>
        </>
      )}
    </>
  );
}
