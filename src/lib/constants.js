export const NAV = [
  { key: "overview", label: "Overview", icon: "overview" },
  { key: "pension", label: "Pension & Retirement", icon: "pension" },
  { key: "pension-reader", label: "AI Document Reader", icon: "reader" },
  { key: "forecast", label: "Cash Flow Forecast", icon: "forecast" },
  { key: "mortgage-overpayment", label: "Overpayment Calculator", icon: "mortgage" },
  { key: "education", label: "Education", icon: "education" },
];

// "income", "import", "loans", "mortgage", "savings", and "investments"
// are all reachable via other entry points (Overview tiles, the setup
// wizard), not the nav bar, so they still need titles listed explicitly
// here — NAV alone isn't enough to cover every reachable tab.
//
// "loans"/"mortgage" and "savings"/"investments" used to be one combined
// tab each ("debts" and "goals") — each pair is now fully separate, with
// no combined view, so each gets its own single-purpose title/message
// rather than sharing one.

export const TAB_TITLES = {
  ...Object.fromEntries(NAV.map((n) => [n.key, n.label])),
  income: "Budget",
  loans: "Loans & Credit Cards",
  mortgage: "Mortgage",
  savings: "Savings",
  investments: "Investments",
  import: "Connect a Bank",
};


export const MASCOT_MESSAGES = {
  overview: "This is your whole financial picture in one place — net worth, score, and what needs attention, all pulled from what you've entered elsewhere.",
  income: "Add every category you spend in here. The more complete this is, the more useful your score and forecast become.",
  loans: "Tap the balance, rate, or payment on any loan or card to update it. Confirming it every so often keeps your \"debt-free by\" date accurate.",
  mortgage: "Keep your balance, rate, and payment up to date here — it feeds your mortgage-free date and how much of your home you actually own outright.",
  savings: "Set a target for anything you're saving towards — a holiday, a house deposit — and see when you'll realistically get there.",
  investments: "Track what you hold outside your pension — an ISA, a general investment account, or anything else — separately from cash savings and your pension balance.",
  pension: "Your pension and State Pension both feed into your retirement forecast. Even rough numbers here are better than leaving it blank.",
  "pension-reader": "Upload a PDF or a photo of any pension or investment statement, and I'll explain what it actually says in plain English — free, and nothing's saved unless you choose to use it.",
  forecast: "This projects your finances forward using everything else you've entered. Try the sliders to see how overpaying debt or saving more changes your future.",
  "mortgage-overpayment": "See what a one-off lump sum or an extra amount every month could actually save on your mortgage — in time and in interest.",
  education: "General explainers on pensions, debt, and savings — not personalised advice, just the basics laid out plainly.",
  default: "Wealth Within pulls your income, debts, savings, and pension into one place, so you can see the full picture instead of piecing it together yourself.",
};


export const FLOW_TONE_COLORS = { slate: "#5C6BA3", rust: "#C9708F", gold: "#97701A", sage: "#4A7A3A" };

// Free-tier limit on manual "Pull transactions from my connected bank".
// Premium has no limit (also gets automatic nightly sync — see
// api/sync-bank-transactions.js). Free users can still pull manually, just
// not more than once every N days — this is the free tier's only route to
// updated bank data, since nightly auto-sync is Premium-only.
export const FREE_BANK_PULL_COOLDOWN_DAYS = 7;
