// Shared best-effort transaction classifier — turns a raw bank merchant/
// description string into one of a small set of genuinely useful buckets,
// used by both OverviewTab.jsx (the new "Groceries" essential row) and
// SpendingTab.jsx (the Lifestyle breakdown). One place, so the two screens
// can never disagree about what counts as what.
//
// Built on request after real bank data showed most lifestyle transactions
// landing in a single "Other" bucket — the previous approach grouped by
// whatever category name Claude matched each transaction to from the
// household's own hand-typed budget categories (see
// api/_lib/categorizeTransactions.js), which only ever have a handful of
// broad names (most households don't have a category called "Eating Out").
// This instead classifies straight from the transaction's own merchant
// text against a fixed, curated taxonomy — same keyword-matching approach
// already used for guessMerchantDomain/SUBSCRIPTION_BRANDS in
// IncomeTab.jsx, just aimed at a different question (which bucket, not
// which logo).
//
// Deliberately excludes two things from the Lifestyle buckets entirely,
// on request:
// - Groceries: genuinely essential spending, not discretionary — now its
//   own row in the Essential breakdown instead (see isGroceryTransaction).
// - Subscriptions: already tracked as their own total on Household Bills
//   (profile.subscriptions / totals.subsTotal) — counting a Netflix direct
//   debit again here would double-count it against that existing figure,
//   so a transaction matching a known subscription brand is skipped
//   entirely rather than bucketed as "Other".
//
// Like guessMerchantDomain, this is a best-effort guess from a messy raw
// bank string, not a guarantee — anything unmatched falls into "Other",
// which is still meant to be the exception, not the rule, for a household
// with a reasonable spread of everyday spending.

const GROCERY_KEYWORDS = [
  "tesco", "sainsbury", "asda", "morrison", "aldi", "lidl", "waitrose",
  "co-op", "coop food", "the co-operative", "iceland", "ocado",
  "farmfoods", "budgens", "spar ", "londis", "nisa local", "costcutter",
  "marks and spencer food", "m&s food", "whole foods",
];

// One name per bucket, in match-priority order (first match wins) —
// order matters where a merchant could plausibly fit more than one
// bucket (e.g. Boots reads as both "shopping" and "personal care"; it's
// deliberately caught by Personal Care first since that's the more
// specific, more useful read of an actual Boots transaction).
const LIFESTYLE_CATEGORIES = [
  {
    name: "Eating Out & Takeaways",
    match: [
      "mcdonald", "kfc", "burger king", "greggs", "subway", "starbucks",
      "costa", "pret", "nando", "deliveroo", "just eat", "justeat",
      "uber eats", "ubereats", "domino", "pizza hut", "pizza express",
      "wagamama", "five guys", "wetherspoon", "restaurant", "bistro",
      "brewdog", "taco bell", "chicken", "diner", "eatery",
    ],
  },
  {
    name: "Personal Care & Beauty",
    match: [
      "boots", "superdrug", "hairdresser", "barber", "salon", "spa ",
      "nails", "beauty", "the body shop",
    ],
  },
  {
    name: "Health & Fitness",
    match: [
      "gym", "puregym", "pure gym", "virgin active", "fitness first",
      "nuffield health", "david lloyd", "the gym group", "pharmacy",
      "chemist", "physio", "dentist", "optic", "specsavers",
    ],
  },
  {
    name: "Entertainment & Leisure",
    match: [
      "cinema", "odeon", "cineworld", "vue ", "vue.com", "theatre",
      "bowling", "ticketmaster", "eventbrite", "steam", "playstation",
      "xbox", "nintendo", "game digital", "games workshop", "museum",
      "zoo ", "spotify", "netflix", "disney+", "disney plus",
    ],
  },
  {
    name: "Shopping",
    match: [
      "amazon", "argos", "ebay", "asos", "next retail", "next plc",
      "zara", "h&m", "primark", "john lewis", "ikea", "currys",
      "apple.com", "marks and spencer", "m&s ", "topshop", "urban outfitters",
      "boohoo", "very.co.uk", "b&q", "screwfix", "wilko", "tk maxx",
    ],
  },
  {
    name: "Transport",
    match: [
      "uber", "tfl", "transport for london", "trainline", "national rail",
      "shell", "bp ", "esso", "fuel", "petrol", "parking", "stagecoach",
      "national express", "megabus", "taxi", "addison lee",
    ],
  },
  {
    name: "Travel & Holidays",
    match: [
      "airline", "easyjet", "ryanair", "british airways", "jet2",
      "hotel", "booking.com", "airbnb", "expedia", "travelodge",
      "premier inn", "holiday", "travel agent", "tui ",
    ],
  },
];

// Note: NOT exhaustive and deliberately kept separate from
// SUBSCRIPTION_BRANDS in IncomeTab.jsx (that list is curated for logo
// display on a household's own manually-added subscriptions — this one
// only needs to be good enough to keep a recognisable subscription out of
// the Lifestyle breakdown, a lower bar than getting every logo right).
const SUBSCRIPTION_KEYWORDS = [
  "netflix", "spotify", "disney+", "disney plus", "amazon prime",
  "now tv", "now.com", "apple.com/bill", "youtube premium", "audible",
  "xbox game pass", "playstation plus", "icloud", "google one",
  "gym membership",
];

function textMatches(haystack, keywords) {
  const h = (haystack || "").toLowerCase();
  return keywords.some((k) => h.includes(k));
}

// A transaction's merchant field is preferred (cleaner, already the
// display name shown elsewhere) but description is used as a fallback —
// some sources (older CSV imports, certain banks) may not have a
// separately-parsed merchant.
function transactionText(t) {
  return `${t.merchant || ""} ${t.description || ""}`.trim();
}

export function isGroceryTransaction(t) {
  return textMatches(transactionText(t), GROCERY_KEYWORDS);
}

export function isKnownSubscriptionTransaction(t) {
  return textMatches(transactionText(t), SUBSCRIPTION_KEYWORDS);
}

// Returns one of LIFESTYLE_CATEGORIES' names, or "Other" — never null, so
// callers can always group by the return value directly. Callers are
// expected to have already filtered out essential/grocery/subscription
// transactions before calling this (see isGroceryTransaction,
// isKnownSubscriptionTransaction, and SpendingTab's own
// isEssentialCategoryName) — this only decides which *lifestyle* bucket a
// remaining transaction falls into.
export function classifyLifestyleTransaction(t) {
  const text = transactionText(t);
  const match = LIFESTYLE_CATEGORIES.find((c) => textMatches(text, c.match));
  return match ? match.name : "Other";
}

export const LIFESTYLE_CATEGORY_NAMES = LIFESTYLE_CATEGORIES.map((c) => c.name);
