export const NAV = [
  { key: "overview", label: "Overview", icon: "overview" },
  { key: "pension", label: "Pension & Retirement", icon: "pension" },
  { key: "pension-reader", label: "AI Pension Reader", icon: "reader" },
  { key: "forecast", label: "Cash Flow Forecast", icon: "forecast" },
  { key: "education", label: "Education", icon: "education" },
  { key: "import", label: "Import from Bank CSV", icon: "import" },
];

// "income" is reachable via its relabelled Overview tile, not the nav bar,
// so it still needs its title listed explicitly here — NAV alone isn't
// enough to cover every reachable tab.

export const TAB_TITLES = {
  ...Object.fromEntries(NAV.map((n) => [n.key, n.label])),
  income: "Income & Expenditure",
  debts: "Debts & Mortgage",
  goals: "Savings & Goals",
};


export const MASCOT_MESSAGES = {
  overview: "This is your whole financial picture in one place — net worth, score, and what needs attention, all pulled from what you've entered elsewhere.",
  income: "Add every category you spend in here. The more complete this is, the more useful your score and forecast become.",
  debts: "Tap the balance, rate, or payment on any debt to update it. Confirming it every so often keeps your \"debt-free by\" date accurate.",
  goals: "Set a target for anything you're saving towards — a holiday, a house deposit — and see when you'll realistically get there.",
  pension: "Your pension and State Pension both feed into your retirement forecast. Even rough numbers here are better than leaving it blank.",
  "pension-reader": "Most budgeting apps can't do this. Upload any pension statement — PDF or a photo — and I'll explain what it actually says in plain English, free.",
  forecast: "This projects your finances forward using everything else you've entered. Try the sliders to see how overpaying debt or saving more changes your future.",
  education: "General explainers on pensions, debt, and savings — not personalised advice, just the basics laid out plainly.",
  default: "Wealth Within pulls your income, debts, savings, and pension into one place, so you can see the full picture instead of piecing it together yourself.",
};


export const FLOW_TONE_COLORS = { slate: "#A6A3D6", rust: "#FF8FA6", gold: "#FFCE6B", sage: "#4FD1C5" };

