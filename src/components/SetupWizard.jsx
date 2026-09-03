import React, { useEffect, useRef, useState } from "react";
import { gbp, nextId, MODE_LABELS, deriveRecommendedMode, parseDebtLines, defaultProfile } from "../lib/finance";
import { Card, Field, NavIcon, InfoTip, Reveal, StatIcon } from "./ui";
import { hasAccounts, getHouseholdId } from "../lib/storage";
import { BankConnectPanel } from "../tabs/BankConnectPanel";
import { supabase } from "../lib/supabaseClient";
import { API_BASE } from "../lib/apiBase";

export function WizardNumberInput({ value, onChange, placeholder, style, disabled, ariaLabel }) {
  return (
    <input
      className="wmg-input"
      type="number"
      inputMode="decimal"
      value={value === 0 || value === null || value === undefined ? "" : value}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel || placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const raw = e.target.value;
        onChange(raw === "" ? 0 : Number(raw));
      }}
      style={style}
    />
  );
}

/* A small persistent label above a single input inside a multi-field row —
   unlike a placeholder, it doesn't disappear once the person starts typing,
   so it's always clear what each field in a row of several represents. */

export function WizardMiniField({ label, hint, children }) {
  return (
    <div className="wmg-mini-field">
      <label className="wmg-mini-field-label">
        {label}
        {hint && <InfoTip text={hint} />}
      </label>
      {children}
    </div>
  );
}

/* A value shown inline inside a sentence — tap it to edit in place. Used to
   replace stacked labelled-box forms with plain-English readable cards. */

export function QuickImport({ onAdd }) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState("loans");
  const [preview, setPreview] = useState(null);

  const handleParse = () => {
    const rows = parseDebtLines(text).filter((r) => r.balance > 0 || r.payment > 0);
    setPreview(rows);
  };
  const handleAdd = () => {
    if (preview && preview.length) {
      onAdd(target, preview);
      setText("");
      setPreview(null);
    }
  };

  return (
    <Card>
      <div className="wmg-array-title">Quick add from text</div>
      <div className="wmg-section-desc" style={{ marginTop: -2 }}>
        No live link to any bank or credit agency — but you can paste several debts in at once instead of typing each
        field separately. One per line: name, balance, rate %, monthly payment.
      </div>
      <div className="wmg-two-col" style={{ marginBottom: 10 }}>
        <div>
          <label className="wmg-field-label">Add as</label>
          <select className="wmg-select" value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="loans">Loans</option>
            <option value="cards">Credit cards</option>
          </select>
        </div>
      </div>
      <textarea
        className="wmg-input wmg-textarea"
        rows={4}
        placeholder={"Car loan, 21000, 7.9, 300\nBarclaycard, 3200, 22.9, 150"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <button className="wmg-add-btn" style={{ width: "auto", flex: "1 1 160px" }} onClick={handleParse} disabled={!text.trim()}>
          Preview
        </button>
        {preview && preview.length > 0 && (
          <button className="wmg-edit-toggle" onClick={handleAdd}>
            Add {preview.length} {preview.length === 1 ? "debt" : "debts"}
          </button>
        )}
      </div>
      {preview && preview.length === 0 && (
        <div className="wmg-sub" style={{ marginTop: 10 }}>
          Couldn't find a balance or payment on any line — check the format and try again.
        </div>
      )}
      {preview && preview.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {preview.map((r, i) => (
            <div key={i} className="wmg-array-row" style={{ background: "var(--ink-3)", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--hair)", flexWrap: "wrap" }}>
              <span style={{ flex: "1 1 100%", fontSize: 12.5, fontWeight: 700 }}>{r.name}</span>
              <span className="wmg-mono" style={{ flex: 1, minWidth: 70, fontSize: 12 }}>{gbp(r.balance)}</span>
              <span className="wmg-mono" style={{ flex: 1, minWidth: 50, fontSize: 12 }}>{r.rate}%</span>
              <span className="wmg-mono" style={{ flex: 1, minWidth: 70, fontSize: 12 }}>{gbp(r.payment)}/mo</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ============================ setup wizard ============================ */


export const WIZARD_DATA_STEPS = ["mode", "income", "debts", "savings", "pension"];

export const WIZARD_STEPS = ["welcome", "connect", ...WIZARD_DATA_STEPS, "showcase", "done"];

// What gets highlighted on the "showcase" step, right after someone's
// finished entering their numbers and right before they land on their
// actual dashboard — the moment they're most engaged, so it's the right
// place to show off what the app can actually do rather than burying
// these behind menus they might never find. Deliberately a fixed list
// here rather than pulling from anywhere dynamic — these are the
// flagship features worth a proper introduction, not everything the app
// does.
const SHOWCASE_FEATURES = [
  {
    icon: "pin",
    tone: "sage",
    title: "Live home value tracking",
    body: "Add your address on Debts & Mortgage and we'll track your home's value automatically, so your net worth stays accurate without you doing anything.",
  },
  {
    icon: "document",
    tone: "brand",
    title: "AI Document Reader",
    body: "Upload a pension statement, mortgage offer, or payslip and let AI pull out the numbers for you — no manual typing.",
  },
  {
    icon: "sparkle",
    tone: "gold",
    title: "Automatic bill & subscription detection",
    body: "Connect a bank and we'll spot your recurring bills and subscriptions for you, ready to review and add in one tap.",
  },
  {
    icon: "percent",
    tone: "rust",
    title: "Smart spending insights",
    body: "Get an AI read on where your money's actually going each month, not just a list of numbers.",
  },
  {
    icon: "networth",
    tone: "slate",
    title: "Cash Flow Forecast",
    body: "See your future net worth, when you'll be debt-free, and your retirement outlook — all in one guided view.",
  },
];


export const blankLoan = () => ({ id: nextId(), name: "", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString(), debtType: "loan" });

export const blankCard = () => ({ id: nextId(), name: "", balance: 0, rate: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString(), debtType: "card" });

export const blankGoal = () => ({ id: nextId(), name: "", target: 0, current: 0, monthlyContribution: 0, desiredMonths: null });


export function WizardListEditor({ items, setItems, fields, addLabel, emptyLabel, quickAdds }) {
  return (
    <div className="wmg-wizard-list">
      {items.length === 0 && <div className="wmg-wizard-list-empty">{emptyLabel}</div>}
      {items.map((item) => (
        <div className="wmg-wizard-list-card" key={item.id}>
          <div className="wmg-wizard-list-row-top">
            {fields
              .filter((f) => f.key === "name")
              .map((f) => (
                <input
                  key={f.key}
                  className="wmg-input"
                  type="text"
                  value={item[f.key]}
                  placeholder={f.label}
                  aria-label={f.label}
                  onChange={(e) => setItems((list) => list.map((it) => (it.id === item.id ? { ...it, [f.key]: e.target.value } : it)))}
                  style={{ flex: 2 }}
                />
              ))}
            {fields
              .filter((f) => f.type === "select")
              .map((f) => (
                <select
                  key={f.key}
                  className="wmg-select"
                  style={{ fontSize: 12 }}
                  value={item[f.key] || f.options[0].value}
                  aria-label={f.label}
                  onChange={(e) => setItems((list) => list.map((it) => (it.id === item.id ? { ...it, [f.key]: e.target.value } : it)))}
                >
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              ))}
            <button
              type="button"
              className="wmg-wizard-list-remove"
              aria-label={`Remove ${item.name || "item"}`}
              onClick={() => setItems((list) => list.filter((it) => it.id !== item.id))}
            >
              ×
            </button>
          </div>
          <div className="wmg-wizard-list-row-numbers">
            {fields
              .filter((f) => f.type === "number")
              .map((f) => (
                <WizardMiniField label={f.label} hint={f.hint} key={f.key}>
                  <WizardNumberInput
                    value={item[f.key]}
                    placeholder={f.label}
                    onChange={(v) => setItems((list) => list.map((it) => (it.id === item.id ? { ...it, [f.key]: v } : it)))}
                  />
                </WizardMiniField>
              ))}
          </div>
        </div>
      ))}
      <div className="wmg-wizard-add-row">
        <button type="button" className="wmg-wizard-list-add" onClick={() => setItems((list) => [...list, fields.factory()])}>
          + {addLabel}
        </button>
        {quickAdds && quickAdds.map((qa) => (
          <button type="button" className="wmg-wizard-list-add wmg-wizard-list-add-secondary" key={qa.label} onClick={() => setItems((list) => [...list, qa.factory()])}>
            + {qa.label}
          </button>
        ))}
      </div>
    </div>
  );
}


export function SetupWizard({ onFinish }) {
  const [stepIdx, setStepIdx] = useState(0);
  const step = WIZARD_STEPS[stepIdx];
  const dataStepPos = WIZARD_DATA_STEPS.indexOf(step); // -1 on welcome/connect/done

  // Only needed for the "connect" step's BankConnectPanel — resolved once,
  // same pattern as BankImportTab, since AuthGate guarantees a signed-in
  // session (and therefore a household) by the time this wizard can render.
  const [householdId, setHouseholdId] = useState(null);
  useEffect(() => {
    if (!hasAccounts) return;
    getHouseholdId().then(setHouseholdId).catch(() => setHouseholdId(null));
  }, []);

  const [comfortLevel, setComfortLevel] = useState(null); // "getting-started" | "basics" | "confident" | null
  const [detailPreference, setDetailPreference] = useState(null); // "simple" | "detail-explained" | "all-numbers" | null

  const [income, setIncome] = useState(0);

  const [hasMortgage, setHasMortgage] = useState(false);
  const [mortgage, setMortgage] = useState({ balance: 0, rate: 4.5, payment: 0, remainingTermYears: null });
  const [loans, setLoans] = useState([]);
  const [cards, setCards] = useState([]);

  const [savingsBalance, setSavingsBalance] = useState(0);
  const [emergencyFund, setEmergencyFund] = useState({ balance: 0, target: 0 });
  const [goals, setGoals] = useState([]);

  const [pension, setPension] = useState({ balance: 0, contribution: 0, currentAge: 30, retirementAge: 67 });
  const [statePensionIncluded, setStatePensionIncluded] = useState(true);
  const [pensionStatus, setPensionStatus] = useState(null); // "yes" | "no" | "unsure" | null
  const [pensionValueUnknown, setPensionValueUnknown] = useState(false);

  // Prefilling income/spending from a bank connected mid-wizard — see
  // pullAndPrefillFromBank below. "idle" until a bank's connected,
  // "loading" while fetching+categorising, "done" or "error" after.
  // hasPrefilledRef guards against re-running this every time
  // BankConnectPanel reports accounts changed (e.g. after a reconnect).
  const [bankPrefillStatus, setBankPrefillStatus] = useState("idle");
  const hasPrefilledRef = useRef(false);

  // Once a bank's connected via the wizard's own "connect" step, pull a
  // one-time transaction history (same api/truelayer-transactions +
  // categorize-transactions pipeline BankImportTab's manual pull uses —
  // see its `categorize` function) and use it to pre-fill the income and
  // spending-estimate questions later in the wizard, rather than leaving
  // them at 0 for someone who just told the app which bank they use.
  // Categorises against defaultProfile's category names since there's no
  // real profile yet to categorise against at this point in onboarding —
  // a fresh household starts with exactly those categories anyway.
  // Guards against overwriting anything the person's already typed (e.g.
  // if they connected a bank, went back, and typed a number by hand
  // first) by only setting a field if it's still at its untouched 0.
  const pullAndPrefillFromBank = async () => {
    if (hasPrefilledRef.current) return;
    hasPrefilledRef.current = true;
    setBankPrefillStatus("loading");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/truelayer-transactions`, {
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Couldn't fetch transactions.");
      const txs = (data.transactions || []).map((t) => ({ description: t.description, amount: t.amount, date: new Date(t.date) }));
      if (txs.length === 0) {
        setBankPrefillStatus("done");
        return;
      }

      const categories = defaultProfile.expenseCategories.map((c) => c.name);
      const batchSize = 150;
      const results = new Array(txs.length).fill(null);
      for (let start = 0; start < txs.length; start += batchSize) {
        const batch = txs.slice(start, start + batchSize);
        const catResp = await fetch(`${API_BASE}/api/categorize-transactions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transactions: batch.map((t) => ({ description: t.description, amount: t.amount })),
            categories,
          }),
        });
        const catData = await catResp.json();
        if (!catResp.ok) throw new Error(catData.error || "Couldn't categorise transactions.");
        (catData.results || []).forEach((r, i) => {
          results[start + i] = r;
        });
      }

      const dates = txs.map((t) => t.date.getTime());
      const spanDays = Math.max(1, (Math.max(...dates) - Math.min(...dates)) / (1000 * 60 * 60 * 24));
      const spanMonths = Math.max(spanDays / 30, 1 / 30);

      let incomeTotal = 0;
      txs.forEach((t, i) => {
        const r = results[i];
        if (!r) return;
        if (r.isIncome && t.amount > 0) incomeTotal += t.amount;
      });

      setIncome((prev) => (prev === 0 && incomeTotal > 0 ? Math.round(incomeTotal / spanMonths) : prev));
      setBankPrefillStatus("done");
    } catch (e) {
      setBankPrefillStatus("error");
    }
  };

  // Existing cards found on the connected bank, offered via
  // BankConnectPanel's card-debt matcher — starts empty since there's no
  // profile to compare against yet during onboarding, so every card
  // shows as "Add as a new card" rather than "Update existing".
  const handleUseAsCardDebt = (selectedId, balance, name) => {
    if (selectedId === "__new__") {
      setCards((prev) => [...prev, { id: nextId(), name, balance, rate: 0, payment: 0, originalBalance: balance, lastConfirmedAt: new Date().toISOString(), debtType: "card" }]);
    } else {
      setCards((prev) => prev.map((c) => (c.id === selectedId ? { ...c, balance } : c)));
    }
  };

  const goNext = () => setStepIdx((i) => Math.min(WIZARD_STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));

  const finishWithData = () => {
    onFinish((p) => ({
      ...p,
      recommendedMode: comfortLevel && detailPreference ? deriveRecommendedMode(comfortLevel, detailPreference) : p.recommendedMode,
      incomes: [{ id: nextId(), name: "Your income", amount: income }],
      mortgage: hasMortgage
        ? { ...p.mortgage, balance: mortgage.balance, rate: mortgage.rate, payment: mortgage.payment, remainingTermYears: mortgage.remainingTermYears, originalBalance: mortgage.balance, lastConfirmedAt: new Date().toISOString() }
        : { ...p.mortgage, balance: 0, payment: 0, remainingTermYears: null, originalBalance: 0, lastConfirmedAt: new Date().toISOString() },
      loans,
      cards,
      savings: { ...p.savings, balance: savingsBalance },
      emergencyFund,
      goals,
      // Wizard deliberately stays single-pot, same as income — no added
      // onboarding friction. It feeds a one-item pensions list; adding more
      // pots later happens on the Pension tab itself. currentAge/
      // retirementAge are person-level (pensionSettings), shared with
      // whatever pots get added later.
      pensions:
        pensionStatus === "no"
          ? [{ ...p.pensions[0], balance: 0, contribution: 0 }]
          : [{ ...p.pensions[0], balance: pensionValueUnknown ? 0 : pension.balance, contribution: pension.contribution }],
      pensionSettings:
        pensionStatus === "no"
          ? p.pensionSettings
          : { ...p.pensionSettings, currentAge: pension.currentAge, retirementAge: pension.retirementAge },
      statePension: { ...p.statePension, included: statePensionIncluded },
      onboarded: true,
    }));
  };

  const skipAll = () => onFinish((p) => ({ ...p, onboarded: true }));

  return (
    <div className="wmg-onboard">
      <div className="wmg-wizard-card">
        {dataStepPos >= 0 && (
          <div className="wmg-wizard-progress">
            <div className="wmg-wizard-progress-track">
              <div
                className="wmg-wizard-progress-fill"
                style={{ width: `${((dataStepPos + 1) / WIZARD_DATA_STEPS.length) * 100}%` }}
              />
            </div>
            <div className="wmg-wizard-progress-label">
              Step {dataStepPos + 1} of {WIZARD_DATA_STEPS.length}
            </div>
          </div>
        )}

        {step === "welcome" && (
          <div className="wmg-wizard-step">
            <div className="wmg-onboard-icon">
              <NavIcon name="overview" />
            </div>
            <h2 className="wmg-onboard-title">Let's set up your picture</h2>
            <p className="wmg-onboard-body">
              A few quick questions about your income, debts, savings and pension — so your
              dashboard reflects your real numbers from the start, not example data. It takes
              about two minutes, and you can skip at any point.
            </p>
          </div>
        )}

        {step === "connect" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Connect a bank</h2>
            <p className="wmg-wizard-step-sub">
              Optional — link an account via Open Banking now, or skip and enter your numbers by
              hand on the next few screens instead. Read-only, and you can always connect later
              from Overview.
            </p>
            {hasAccounts && householdId ? (
              <>
                <BankConnectPanel
                  householdId={householdId}
                  onAccountsChanged={(accounts) => {
                    // BankConnectPanel reports every status check here, not
                    // just real connections — including its own initial
                    // "not connected yet" 404 check on mount, before the
                    // person has done anything. Only treat this as "a bank
                    // just got connected" when real account data actually
                    // comes back, otherwise pullAndPrefillFromBank would
                    // fire immediately on page load (before any bank
                    // exists), fail, and — since it only ever runs once —
                    // never get a second chance even after a real
                    // connection succeeds moments later.
                    if (Array.isArray(accounts) && accounts.length > 0) {
                      pullAndPrefillFromBank();
                    }
                  }}
                  onUseAsSavings={(balance) => setSavingsBalance((prev) => (prev === 0 ? balance : prev))}
                  onUseAsCardDebt={handleUseAsCardDebt}
                  existingCards={cards}
                  savingsBalance={savingsBalance}
                />
                {bankPrefillStatus === "loading" && (
                  <div className="wmg-sub" style={{ marginTop: 10 }}>
                    Reading your recent transactions to fill in the next few questions for you…
                  </div>
                )}
                {bankPrefillStatus === "done" && (
                  <div className="wmg-sub" style={{ marginTop: 10, color: "var(--sage)" }}>
                    ✓ Income and spending on the next screens have been pre-filled from your bank — check them over,
                    they're easy to adjust.
                  </div>
                )}
                {bankPrefillStatus === "error" && (
                  <div className="wmg-sub" style={{ marginTop: 10 }}>
                    Couldn't read transaction history right now — no problem, just enter income and spending by hand
                    on the next screens.
                  </div>
                )}
              </>
            ) : (
              <p className="wmg-sub">Loading…</p>
            )}
          </div>
        )}

        {step === "mode" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">How would you like this to work?</h2>
            <p className="wmg-wizard-step-sub">
              Two quick questions so we can show you the right amount of detail from the start — you can change this any time in Settings.
            </p>

            <p className="wmg-wizard-step-sub" style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>
              How comfortable are you with managing your finances?
            </p>
            <div className="wmg-wizard-mode-options" style={{ marginBottom: 18 }}>
              {[
                { key: "getting-started", label: "I'm just getting started" },
                { key: "basics", label: "I understand the basics" },
                { key: "confident", label: "I'm pretty confident" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`wmg-wizard-mode-option ${comfortLevel === opt.key ? "active" : ""}`}
                  aria-pressed={comfortLevel === opt.key}
                  onClick={() => setComfortLevel(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <p className="wmg-wizard-step-sub" style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>
              When looking at your finances, what would you prefer?
            </p>
            <div className="wmg-wizard-mode-options" style={{ marginBottom: 12 }}>
              {[
                { key: "simple", label: "Keep things simple and tell me what matters" },
                { key: "detailed", label: "Show me the detail and the numbers behind it" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className={`wmg-wizard-mode-option ${detailPreference === opt.key ? "active" : ""}`}
                  aria-pressed={detailPreference === opt.key}
                  onClick={() => setDetailPreference(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {comfortLevel && detailPreference && (
              <div className="wmg-wizard-mode-recommend">
                We recommend <strong>{MODE_LABELS[deriveRecommendedMode(comfortLevel, detailPreference)]}</strong> mode.
                {deriveRecommendedMode(comfortLevel, detailPreference) === "guided" && " We'll keep things simple, explain financial terms when they appear, and focus on what matters most."}
                {deriveRecommendedMode(comfortLevel, detailPreference) === "standard" && " We'll show the key numbers with explanations where useful, and more detail is always a tap away."}
                {" "}You can see more detail whenever you want, or change this at any time in Settings.
              </div>
            )}
          </div>
        )}

        {step === "income" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Income & spending</h2>
            <p className="wmg-wizard-step-sub">The money that actually lands in your bank account each month.</p>
            {bankPrefillStatus === "done" && income > 0 && (
              <div className="wmg-sub" style={{ marginBottom: 10, color: "var(--sage)" }}>
                Pre-filled from your connected bank — adjust anything that doesn't look right.
              </div>
            )}
            <Field
              label="Monthly income"
              hint="This is your take-home pay after tax and National Insurance — check a recent payslip if you're not sure. Include any other regular income too, like a second job, benefits, or child benefit."
            >
              <WizardNumberInput value={income} placeholder="e.g. 3200" onChange={setIncome} />
            </Field>
          </div>
        )}

        {step === "debts" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Debts & mortgage</h2>
            <p className="wmg-wizard-step-sub">Anything you're paying off each month — a mortgage, loans, credit cards. Leave blank if none apply.</p>

            <div className="wmg-wizard-section-title">Mortgage</div>
            <label className="wmg-wizard-toggle">
              <input type="checkbox" checked={hasMortgage} onChange={(e) => setHasMortgage(e.target.checked)} />
              I have a mortgage
            </label>
            {hasMortgage && (
              <div className="wmg-wizard-list-row-numbers" style={{ marginBottom: 16 }}>
                <WizardMiniField label="Balance" hint="How much you still owe on the mortgage — you'll find this on a recent mortgage statement or your lender's app.">
                  <WizardNumberInput
                    value={mortgage.balance}
                    placeholder="e.g. 180000"
                    onChange={(v) => setMortgage((m) => ({ ...m, balance: v }))}
                  />
                </WizardMiniField>
                <WizardMiniField label="Rate %" hint="Your interest rate, sometimes shown as APR — also on your mortgage statement. If you're not sure, a rough guess is fine for now.">
                  <WizardNumberInput
                    value={mortgage.rate}
                    placeholder="e.g. 4.5"
                    onChange={(v) => setMortgage((m) => ({ ...m, rate: v }))}
                  />
                </WizardMiniField>
                <WizardMiniField label="Monthly payment">
                  <WizardNumberInput
                    value={mortgage.payment}
                    placeholder="e.g. 950"
                    onChange={(v) => setMortgage((m) => ({ ...m, payment: v }))}
                  />
                </WizardMiniField>
                <WizardMiniField label="Years left on term (optional)" hint="On your mortgage statement or lender's app. Just for comparison — skip if you're not sure.">
                  <WizardNumberInput
                    value={mortgage.remainingTermYears ?? ""}
                    placeholder="e.g. 22"
                    onChange={(v) => setMortgage((m) => ({ ...m, remainingTermYears: v === "" ? null : v }))}
                  />
                </WizardMiniField>
              </div>
            )}

            <div className="wmg-wizard-section-title">Loans</div>
            <WizardListEditor
              items={loans}
              setItems={setLoans}
              addLabel="Add a loan"
              emptyLabel="No loans added"
              quickAdds={[
                { label: "Car finance (PCP / HP)", factory: () => ({ ...blankLoan(), name: "Car finance", debtType: "car-finance" }) },
              ]}
              fields={Object.assign(
                [
                  { key: "name", label: "Name" },
                  { key: "debtType", label: "Type", type: "select", options: [
                    { value: "loan", label: "Loan" },
                    { value: "car-finance", label: "Car finance" },
                    { value: "other", label: "Other" },
                  ] },
                  { key: "balance", label: "Balance", type: "number", hint: "How much is left to pay off." },
                  { key: "rate", label: "Rate %", type: "number", hint: "The interest rate, sometimes shown as APR — check the credit agreement or lender's app. A rough guess is fine." },
                  { key: "payment", label: "Monthly payment", type: "number" },
                ],
                { factory: blankLoan }
              )}
            />

            <div className="wmg-wizard-section-title">Credit cards</div>
            <WizardListEditor
              items={cards}
              setItems={setCards}
              addLabel="Add a credit card"
              emptyLabel="No credit cards added"
              quickAdds={[
                { label: "Overdraft", factory: () => ({ ...blankCard(), name: "Overdraft", debtType: "overdraft" }) },
              ]}
              fields={Object.assign(
                [
                  { key: "name", label: "Name" },
                  { key: "debtType", label: "Type", type: "select", options: [
                    { value: "card", label: "Credit card" },
                    { value: "overdraft", label: "Overdraft" },
                    { value: "other", label: "Other" },
                  ] },
                  { key: "balance", label: "Balance", type: "number", hint: "How much is currently owed on the card." },
                  { key: "rate", label: "Rate %", type: "number", hint: "The interest rate, sometimes shown as APR — check a recent statement or the card provider's app. A rough guess is fine." },
                  { key: "payment", label: "Monthly payment", type: "number" },
                ],
                { factory: blankCard }
              )}
            />
          </div>
        )}

        {step === "savings" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Savings & goals</h2>
            <p className="wmg-wizard-step-sub">What you've already got saved, plus anything you're saving towards.</p>

            <Field label="Savings balance" hint="Any money you've got set aside — savings accounts, ISAs, or similar. A rough total is fine.">
              <WizardNumberInput value={savingsBalance} placeholder="e.g. 4000" onChange={setSavingsBalance} />
            </Field>
            <div className="wmg-wizard-section-title" style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Emergency fund
              <InfoTip text="Money set aside purely for unexpected costs — a boiler breaking, a job loss — kept separate from everyday savings so you're not tempted to dip into it. If you don't have one yet, that's completely normal; leave these at 0." />
            </div>
            <div className="wmg-wizard-list-row-numbers" style={{ marginBottom: 16 }}>
              <WizardMiniField label="Current balance">
                <WizardNumberInput
                  value={emergencyFund.balance}
                  placeholder="e.g. 1000"
                  onChange={(v) => setEmergencyFund((f) => ({ ...f, balance: v }))}
                />
              </WizardMiniField>
              <WizardMiniField label="Target" hint="What you're aiming to build it up to. A common starting point is 3–6 months of essential costs, but any number is fine — you can change this later.">
                <WizardNumberInput
                  value={emergencyFund.target}
                  placeholder="e.g. 6000"
                  onChange={(v) => setEmergencyFund((f) => ({ ...f, target: v }))}
                />
              </WizardMiniField>
            </div>

            <div className="wmg-wizard-section-title">Savings goals</div>
            <WizardListEditor
              items={goals}
              setItems={setGoals}
              addLabel="Add a goal"
              emptyLabel="No goals added"
              fields={Object.assign(
                [
                  { key: "name", label: "Goal name" },
                  { key: "target", label: "Target", type: "number" },
                  { key: "current", label: "Saved so far", type: "number" },
                  { key: "monthlyContribution", label: "Monthly", type: "number" },
                ],
                { factory: blankGoal }
              )}
            />
          </div>
        )}

        {step === "pension" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Pension</h2>
            <p className="wmg-wizard-step-sub">Workplace or personal pension, plus your State Pension.</p>

            <p className="wmg-wizard-step-sub" style={{ marginTop: 0, marginBottom: 8, fontWeight: 600 }}>
              Do you have a workplace or personal pension?
            </p>
            <div className="wmg-wizard-list-row" style={{ marginBottom: 16 }}>
              {[
                { key: "yes", label: "Yes" },
                { key: "no", label: "No" },
                { key: "unsure", label: "Not sure" },
              ].map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  className="wmg-edit-toggle"
                  aria-pressed={pensionStatus === opt.key}
                  style={
                    pensionStatus === opt.key
                      ? { background: "var(--brand)", color: "#fff", borderColor: "var(--brand)" }
                      : undefined
                  }
                  onClick={() => setPensionStatus(opt.key)}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {pensionStatus === "no" && (
              <p className="wmg-sub" style={{ marginBottom: 16 }}>
                No problem — you can add a pension at any time from the Pension tab. Your State
                Pension can still count towards your forecast below.
              </p>
            )}

            {(pensionStatus === "yes" || pensionStatus === "unsure") && (
              <>
                <div className="wmg-wizard-list-row-numbers" style={{ marginBottom: 8 }}>
                  <WizardMiniField label="Pension balance" hint="Check your pension provider's app or a recent annual statement. Not sure where to look? Tick the box below and use the AI pension document reader later — it can read a statement for you.">
                    <WizardNumberInput
                      value={pensionValueUnknown ? "" : pension.balance}
                      placeholder="e.g. 45000"
                      disabled={pensionValueUnknown}
                      onChange={(v) => setPension((p) => ({ ...p, balance: v }))}
                    />
                  </WizardMiniField>
                  <WizardMiniField label="Monthly contribution" hint="The combined total going in each month — both what you pay in and what your employer adds.">
                    <WizardNumberInput
                      value={pension.contribution}
                      placeholder="e.g. 250"
                      onChange={(v) => setPension((p) => ({ ...p, contribution: v }))}
                    />
                  </WizardMiniField>
                </div>
                <label className="wmg-wizard-toggle" style={{ marginBottom: 16 }}>
                  <input
                    type="checkbox"
                    checked={pensionValueUnknown}
                    onChange={(e) => setPensionValueUnknown(e.target.checked)}
                  />
                  I don't know the value — add this later
                </label>
                <div className="wmg-wizard-list-row-numbers" style={{ marginBottom: 16 }}>
                  <WizardMiniField label="Current age">
                    <WizardNumberInput
                      value={pension.currentAge}
                      placeholder="e.g. 30"
                      onChange={(v) => setPension((p) => ({ ...p, currentAge: v }))}
                    />
                  </WizardMiniField>
                  <WizardMiniField label="Retirement age">
                    <WizardNumberInput
                      value={pension.retirementAge}
                      placeholder="e.g. 67"
                      onChange={(v) => setPension((p) => ({ ...p, retirementAge: v }))}
                    />
                  </WizardMiniField>
                </div>
              </>
            )}

            <label className="wmg-wizard-toggle">
              <input type="checkbox" checked={statePensionIncluded} onChange={(e) => setStatePensionIncluded(e.target.checked)} />
              Include my State Pension in the forecast
            </label>
          </div>
        )}

        {step === "showcase" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Here's what's waiting for you</h2>
            <p className="wmg-wizard-step-sub">A few things worth knowing about before you dive in.</p>
            {SHOWCASE_FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 90}>
                <Card style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10 }}>
                  <span className={`wmg-showcase-icon tone-${f.tone}`} style={{ flexShrink: 0 }} aria-hidden="true">
                    <StatIcon name={f.icon} />
                  </span>
                  <div>
                    <div className="wmg-entry-title" style={{ fontSize: 14, marginBottom: 3 }}>{f.title}</div>
                    <div className="wmg-sub">{f.body}</div>
                  </div>
                </Card>
              </Reveal>
            ))}
            <Reveal delay={SHOWCASE_FEATURES.length * 90}>
              <div className="wmg-sub" style={{ textAlign: "center", marginTop: 4 }}>
                Most of this is part of Premium — free for 14 days, cancel any time.
              </div>
            </Reveal>
          </div>
        )}

        {step === "done" && (
          <div className="wmg-wizard-step">
            <div className="wmg-onboard-icon">
              <NavIcon name="forecast" />
            </div>
            <h2 className="wmg-onboard-title">You're all set</h2>
            <p className="wmg-onboard-body">
              Your dashboard is ready with your numbers. You can edit any of this at any time from
              its tab — nothing here is final.
            </p>
          </div>
        )}

        <div className="wmg-onboard-actions">
          {step !== "done" && step !== "showcase" && (
            <button className="wmg-onboard-skip" onClick={skipAll}>
              Skip for now
            </button>
          )}
          {(dataStepPos > 0 || step === "showcase") && (
            <button className="wmg-wizard-back" onClick={goBack}>
              Back
            </button>
          )}
          <button
            className="wmg-onboard-next"
            onClick={() => (step === "done" ? finishWithData() : goNext())}
          >
            {step === "welcome" ? "Get started" : step === "done" ? "Go to my dashboard" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}


