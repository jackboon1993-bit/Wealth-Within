import React, { useState } from "react";
import { gbp, nextId, MODE_LABELS, deriveRecommendedMode, parseDebtLines } from "../lib/finance";
import { Card, Field, NavIcon, InfoTip } from "./ui";

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

export const WIZARD_STEPS = ["welcome", ...WIZARD_DATA_STEPS, "done"];


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
  const dataStepPos = WIZARD_DATA_STEPS.indexOf(step); // -1 on welcome/done

  const [comfortLevel, setComfortLevel] = useState(null); // "getting-started" | "basics" | "confident" | null
  const [detailPreference, setDetailPreference] = useState(null); // "simple" | "detail-explained" | "all-numbers" | null

  const [income, setIncome] = useState(0);
  const [spendingEstimate, setSpendingEstimate] = useState(0);

  const [hasMortgage, setHasMortgage] = useState(false);
  const [mortgage, setMortgage] = useState({ balance: 0, rate: 4.5, payment: 0 });
  const [loans, setLoans] = useState([]);
  const [cards, setCards] = useState([]);

  const [savingsBalance, setSavingsBalance] = useState(0);
  const [emergencyFund, setEmergencyFund] = useState({ balance: 0, target: 0 });
  const [goals, setGoals] = useState([]);

  const [pension, setPension] = useState({ balance: 0, contribution: 0, currentAge: 30, retirementAge: 67 });
  const [statePensionIncluded, setStatePensionIncluded] = useState(true);
  const [pensionStatus, setPensionStatus] = useState(null); // "yes" | "no" | "unsure" | null
  const [pensionValueUnknown, setPensionValueUnknown] = useState(false);

  const goNext = () => setStepIdx((i) => Math.min(WIZARD_STEPS.length - 1, i + 1));
  const goBack = () => setStepIdx((i) => Math.max(0, i - 1));

  const finishWithData = () => {
    onFinish((p) => ({
      ...p,
      recommendedMode: comfortLevel && detailPreference ? deriveRecommendedMode(comfortLevel, detailPreference) : p.recommendedMode,
      incomes: [{ id: nextId(), name: "Your income", amount: income }],
      expenseCategories:
        spendingEstimate > 0
          ? [
              {
                id: nextId(),
                name: "Getting started",
                type: "essential",
                items: [
                  {
                    id: nextId(),
                    name: "Estimated spending (from setup)",
                    amount: spendingEstimate,
                    isOnboardingEstimate: true,
                  },
                ],
              },
            ]
          : p.expenseCategories,
      mortgage: hasMortgage
        ? { ...p.mortgage, balance: mortgage.balance, rate: mortgage.rate, payment: mortgage.payment, originalBalance: mortgage.balance, lastConfirmedAt: new Date().toISOString() }
        : { ...p.mortgage, balance: 0, payment: 0, originalBalance: 0, lastConfirmedAt: new Date().toISOString() },
      loans,
      cards,
      savings: { ...p.savings, balance: savingsBalance },
      emergencyFund,
      goals,
      pension:
        pensionStatus === "no"
          ? { ...p.pension, balance: 0, contribution: 0 }
          : { ...p.pension, ...pension, balance: pensionValueUnknown ? 0 : pension.balance },
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
                { key: "detail-explained", label: "Show me the detail, but explain things when needed" },
                { key: "all-numbers", label: "Give me all the numbers and let me explore" },
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
                {deriveRecommendedMode(comfortLevel, detailPreference) === "advanced" && " We'll show more detail and the numbers behind it by default."}
                {" "}You can see more detail whenever you want, or change this at any time in Settings.
              </div>
            )}
          </div>
        )}

        {step === "income" && (
          <div className="wmg-wizard-step">
            <h2 className="wmg-wizard-step-title">Income & spending</h2>
            <p className="wmg-wizard-step-sub">The money that actually lands in your bank account each month.</p>
            <Field
              label="Monthly income"
              hint="This is your take-home pay after tax and National Insurance — check a recent payslip if you're not sure. Include any other regular income too, like a second job, benefits, or child benefit."
            >
              <WizardNumberInput value={income} placeholder="e.g. 3200" onChange={setIncome} />
            </Field>
            <Field
              label="Approximate monthly spending"
              hint="Normal household and lifestyle costs — rent, bills, food, travel, subscriptions and so on. Don't include mortgage or debt repayments, those come next. An estimate is fine — you can add the full breakdown later."
            >
              <WizardNumberInput value={spendingEstimate} placeholder="e.g. 1600" onChange={setSpendingEstimate} />
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
          {step !== "done" && (
            <button className="wmg-onboard-skip" onClick={skipAll}>
              Skip for now
            </button>
          )}
          {dataStepPos > 0 && (
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


