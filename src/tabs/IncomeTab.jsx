import React, { useState, useMemo, useEffect } from "react";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from "recharts";
import { gbp, getActiveMode, nextId } from "../lib/finance";
import { Card, ProgressBar, InlinePill, CategoryTooltip, NumberInput, BarRow, Reveal, StatIcon } from "../components/ui";
import { API_BASE } from "../lib/apiBase";
import { supabase } from "../lib/supabaseClient";

export const SUB_AVATAR_TONES = ["brand", "coral", "sage", "gold", "rust"];

// Curated real brand colours for common recurring payments — matched by
// loose substring against the subscription's own name, same pattern as
// COMMON_BILLS below, so "Disney Plus" and "Disney+" both match "disney+"
// the same way "Council tax" and "Council Tax bill" both match "council
// tax". Anything not recognised falls back to the existing rotating
// SUB_AVATAR_TONES badge — this is additive, never a hard requirement.
// `text` is the badge's text/icon colour, chosen per-brand for contrast
// against `bg` (most are white-on-colour; a couple of pale brand colours
// need a dark badge text instead).
export const SUBSCRIPTION_BRANDS = [
  { name: "Netflix", match: ["netflix"], domain: "netflix.com", bg: "#E50914", text: "#FFFFFF" },
  { name: "Disney+", match: ["disney"], domain: "disneyplus.com", bg: "#113CCF", text: "#FFFFFF" },
  { name: "Spotify", match: ["spotify"], domain: "spotify.com", bg: "#1DB954", text: "#FFFFFF" },
  { name: "Xbox", match: ["xbox", "game pass"], domain: "xbox.com", bg: "#107C10", text: "#FFFFFF" },
  { name: "PlayStation", match: ["playstation", "ps plus", "ps+"], domain: "playstation.com", bg: "#003791", text: "#FFFFFF" },
  { name: "Amazon Prime", match: ["amazon prime", "prime video"], domain: "amazon.co.uk", bg: "#00A8E1", text: "#0F1111" },
  { name: "Apple Music", match: ["apple music"], domain: "apple.com", bg: "#FA243C", text: "#FFFFFF" },
  { name: "Apple TV", match: ["apple tv"], domain: "apple.com", bg: "#000000", text: "#FFFFFF" },
  { name: "iCloud", match: ["icloud"], domain: "apple.com", bg: "#3693F3", text: "#FFFFFF" },
  { name: "YouTube Premium", match: ["youtube"], domain: "youtube.com", bg: "#FF0000", text: "#FFFFFF" },
  { name: "Now TV", match: ["now tv", "nowtv"], domain: "nowtv.com", bg: "#00203F", text: "#FFFFFF" },
  { name: "Audible", match: ["audible"], domain: "audible.co.uk", bg: "#F8991C", text: "#0F1111" },
  { name: "Google One", match: ["google one", "google drive"], domain: "google.com", bg: "#4285F4", text: "#FFFFFF" },
  { name: "Deezer", match: ["deezer"], domain: "deezer.com", bg: "#FEAA2D", text: "#0F1111" },
  { name: "Discord", match: ["discord"], domain: "discord.com", bg: "#5865F2", text: "#FFFFFF" },
];

// Real logo images via Logo.dev (Clearbit's Logo API shut down for good on
// 8 December 2025 — this app never actually shipped against it, so this
// is a fresh integration, not a migration). Logo.dev's "publishable" token
// is deliberately safe to ship in client-side code (same trust model as a
// Stripe publishable key) — no backend endpoint needed, this is just a
// plain <img src>. VITE_LOGO_DEV_TOKEN must be set in both .env.local (for
// native builds) and Vercel's env vars (for the web build) — see Session
// 4's handover for why those two are separate and both need updating.
// Free tier is 500,000 logo requests/month, comfortably above what this
// app needs; commercial use on the free tier requires a small attribution
// link, added in the Subscriptions section below.
const LOGO_DEV_TOKEN = import.meta.env.VITE_LOGO_DEV_TOKEN;
export function logoDevUrl(domain) {
  if (!LOGO_DEV_TOKEN || !domain) return null;
  return `https://img.logo.dev/${domain}?token=${LOGO_DEV_TOKEN}&size=64&format=png`;
}

// Returns the matching brand entry for a subscription name, or null if
// nothing in SUBSCRIPTION_BRANDS matches — callers fall back to the
// existing tone-rotation badge style in that case.
export function getSubscriptionBrand(name) {
  const nameLower = (name || "").toLowerCase();
  return SUBSCRIPTION_BRANDS.find((b) => b.match.some((m) => nameLower.includes(m))) || null;
}

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
  const brand = getSubscriptionBrand(sub.name);
  const initial = (sub.name || "?").trim().charAt(0).toUpperCase() || "?";
  // Try the real logo first; fall back to the existing colour+initial
  // badge if there's no token configured, no matching brand, or the
  // image itself fails to load (a brand not in Logo.dev's database, a
  // network hiccup, etc.) — this can never show a broken-image icon,
  // since imageFailed flips the badge back the moment onError fires.
  const logoUrl = brand ? logoDevUrl(brand.domain) : null;
  const [imageFailed, setImageFailed] = useState(false);
  const showLogo = logoUrl && !imageFailed;

  // A small, quick acknowledgement when a subscription is actively
  // cancelled — deliberately lighter than Celebration (confetti every
  // time someone cancels a subscription would get old fast, since it's
  // a routine action, not a milestone like a bank connecting or a debt
  // clearing). Only fires on active -> cancelled, never on Restore, and
  // clears itself — nothing to reset from a parent re-render.
  const [showPulse, setShowPulse] = useState(false);
  const [pulseIn, setPulseIn] = useState(false);
  useEffect(() => {
    if (!showPulse) return;
    const t1 = setTimeout(() => setPulseIn(true), 10);
    const t2 = setTimeout(() => setPulseIn(false), 900);
    const t3 = setTimeout(() => setShowPulse(false), 1200);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [showPulse]);
  const handleToggleCancel = () => {
    if (!sub.cancelled) setShowPulse(true);
    onToggleCancel();
  };

  return (
    <div className={`wmg-sub-card ${sub.cancelled ? "cancelled" : ""}`} style={{ position: "relative" }}>
      {showPulse && (
        <span
          aria-hidden="true"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            background: "rgba(99, 153, 34, 0.14)",
            color: "var(--sage)",
            fontSize: 11,
            fontWeight: 500,
            padding: "3px 8px",
            borderRadius: 999,
            opacity: pulseIn ? 1 : 0,
            transform: pulseIn ? "translateY(0)" : "translateY(-6px)",
            transition: "opacity 300ms ease, transform 300ms ease",
            pointerEvents: "none",
          }}
        >
          <i className="ti ti-check" style={{ fontSize: 12 }}></i> Cancelled
        </span>
      )}
      <button type="button" className="wmg-sub-summary" onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
        {showLogo ? (
          <span className="wmg-sub-avatar" style={{ background: "#FFFFFF", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <img
              src={logoUrl}
              alt=""
              width={22}
              height={22}
              loading="lazy"
              style={{ objectFit: "contain" }}
              onError={() => setImageFailed(true)}
            />
          </span>
        ) : (
          <span
            className={`wmg-sub-avatar ${brand ? "" : `tone-${tone}`}`}
            style={brand ? { background: brand.bg, color: brand.text } : undefined}
          >
            {initial}
          </span>
        )}
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
              onClick={handleToggleCancel}
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


// Was hardcoded to the *original* pre-re-theme hex values — the same
// stale-colour-array bug found and fixed in FLOW_TONE_COLORS
// (constants.js), SCENARIO_COLORS (ForecastTab.jsx), and PensionTab's
// growth chart. Switched to var() strings, using all 8 named theme
// tones plus the two -fill variants for extra cycling variety on
// households with more than 8 spending categories — SVG fill/stroke
// accepts CSS custom properties directly, so this now stays correct
// through any future re-theme automatically.
export const CATEGORY_COLORS = ["var(--brand)", "var(--coral)", "var(--gold)", "var(--slate)", "var(--brand-2)", "var(--sage)", "var(--rust)", "var(--brand-deep)", "var(--slate-fill)", "var(--rust-fill)"];

// Tone names (matching BarRow/motion.css's .tone-* classes) cycled through
// for the bills bar breakdown — a smaller, named-tone palette rather than
// the free-form hex CATEGORY_COLORS above, since BarRow's gradient fills
// are pre-defined per tone rather than accepting an arbitrary colour.
const CATEGORY_TONES = ["brand", "coral", "gold", "sage", "rust", "slate"];

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

// Groups a category NAME (not a fixed list — categories are freely named
// by the person, or generated by AI categorisation from a bank pull) into
// one of a small set of clear buckets, purely by loose substring match,
// same pattern as COMMON_BILLS above. This is computed on the fly rather
// than stored on the category itself, so it works retroactively on every
// existing category without needing a data migration, and stays correct
// automatically if someone renames a category later. "Everything else"
// is the deliberate fallback for genuinely miscellaneous spending (food,
// travel, entertainment, childcare, etc.) — grouping it under a clear
// header too, rather than leaving it feeling like an unsorted leftover
// pile, is part of the point.
const CATEGORY_GROUPS = [
  { name: "Housing", match: ["rent", "mortgage", "council tax", "ground rent", "service charge"] },
  { name: "Utilities", match: ["electric", "gas", "water", "broadband", "internet", "wifi", "mobile", "phone", "tv licence", "tv license", "energy"] },
  { name: "Insurance & Protection", match: ["insurance", "protection", "life cover", "critical illness", "warranty"] },
];
function categoryGroupName(name) {
  const nameLower = (name || "").toLowerCase();
  const match = CATEGORY_GROUPS.find((g) => g.match.some((m) => nameLower.includes(m)));
  return match ? match.name : "Everything else";
}
// Fixed display order for the groups above — CATEGORY_GROUPS' own order
// plus the fallback bucket last, rather than whatever order categories
// happen to be inferred in.
const CATEGORY_GROUP_ORDER = [...CATEGORY_GROUPS.map((g) => g.name), "Everything else"];

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

  // Spend pacing — compares how far through the *month* we are against
  // how far through this category's *budget* the current spend is.
  // subtotal is a live, growing-through-the-month figure (confirmed by
  // monthly-spending-snapshot.js existing specifically to freeze it at
  // month-end for history — before that point it fluctuates as bank
  // syncs land), so comparing it against elapsed calendar days is a
  // genuinely meaningful signal, not just a guess. Only shown once
  // there's a real gap (12+ points) either way — flagging "you're
  // basically on schedule" for every single category would be noise,
  // not insight, and only when a real budget is set, since pacing
  // against a £0 budget is meaningless.
  const pacing = (() => {
    if (!(cat.budget > 0) || subtotal <= 0) return null;
    const now = new Date();
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const timeElapsedPct = (dayOfMonth / daysInMonth) * 100;
    const spendPct = (subtotal / cat.budget) * 100;
    const gap = spendPct - timeElapsedPct;
    if (Math.abs(gap) < 12) return null;
    return { ahead: gap > 0, dayOfMonth, daysInMonth, timeElapsedPct, spendPct };
  })();

  // Merchant breakdown + recurring-vs-one-off, built on top of the real
  // transaction history now landing in household_transactions (see the
  // transactions migration and persistTransactions in
  // api/_lib/categorizeTransactions.js) — this genuinely didn't exist
  // before tonight, since the backend only ever kept an aggregated
  // monthly average per category and threw the individual transactions
  // away. Queried directly through the normal (RLS-scoped) Supabase
  // client rather than a new API route — the existing RLS policy on
  // household_transactions already restricts reads to the household's
  // own members, so there's nothing a server-side endpoint would add
  // here that a direct client read doesn't already handle correctly.
  //
  // "Recurring" means the same cleaned-up merchant name appearing in at
  // least 2 of the last 3 distinct calendar months — deliberately a
  // simple, explainable rule rather than anything fuzzier (matching
  // amounts within a tolerance, etc.) given how new and unproven this
  // data source still is. Fetched once, on first expand, not on every
  // toggle — a category someone opens and closes a few times while
  // editing shouldn't re-query each time.
  const [merchantStatus, setMerchantStatus] = useState("idle"); // idle | loading | done | empty | error
  const [merchantBreakdown, setMerchantBreakdown] = useState(null);

  useEffect(() => {
    if (!expanded || merchantStatus !== "idle") return;
    setMerchantStatus("loading");
    (async () => {
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const sinceDate = threeMonthsAgo.toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("household_transactions")
        .select("merchant, amount, date")
        .eq("category", cat.name)
        .lt("amount", 0) // spending only — income never lands in a named category
        .gte("date", sinceDate)
        .order("date", { ascending: false });

      if (error) {
        setMerchantStatus("error");
        return;
      }
      if (!data || data.length === 0) {
        setMerchantStatus("empty");
        return;
      }

      const byMerchant = new Map();
      data.forEach((t) => {
        const name = t.merchant || "Other";
        const monthKey = String(t.date).slice(0, 7); // YYYY-MM
        if (!byMerchant.has(name)) byMerchant.set(name, { name, total: 0, count: 0, months: new Set() });
        const entry = byMerchant.get(name);
        entry.total += Math.abs(Number(t.amount) || 0);
        entry.count += 1;
        entry.months.add(monthKey);
      });

      const rows = Array.from(byMerchant.values())
        .map((e) => ({ name: e.name, total: e.total, count: e.count, recurring: e.months.size >= 2 }))
        .sort((a, b) => b.total - a.total)
        .slice(0, 8); // a long tail of one-off £1.20 merchants isn't worth scrolling through

      setMerchantBreakdown(rows);
      setMerchantStatus("done");
    })();
  }, [expanded, merchantStatus, cat.name]);

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
          {pacing && (
            <div className="wmg-sub" style={{ marginTop: 6, color: pacing.ahead ? "var(--rust)" : "var(--sage)" }}>
              {pacing.ahead
                ? `Pacing ahead of schedule — day ${pacing.dayOfMonth} of ${pacing.daysInMonth}, but already ${Math.round(pacing.spendPct)}% through this budget.`
                : `Pacing comfortably — day ${pacing.dayOfMonth} of ${pacing.daysInMonth}, and only ${Math.round(pacing.spendPct)}% through this budget.`}
            </div>
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
          {merchantStatus === "loading" && (
            <div className="wmg-sub" style={{ marginTop: 12 }}>Looking at where this actually went…</div>
          )}
          {merchantStatus === "done" && merchantBreakdown && (
            <div style={{ marginTop: 14 }}>
              <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Where this actually went (last 3 months)</div>
              {merchantBreakdown.map((m) => (
                <div
                  key={m.name}
                  style={{
                    display: "flex", alignItems: "center", gap: 8, padding: "7px 0",
                    borderBottom: "0.5px solid var(--hair)",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 12.5, color: "var(--paper)" }}>{m.name}</span>
                  {m.recurring && (
                    <span
                      style={{
                        fontSize: 10, fontWeight: 700, color: "var(--brand)", background: "var(--brand-soft)",
                        padding: "2px 7px", borderRadius: 999,
                      }}
                    >
                      Recurring
                    </span>
                  )}
                  <span style={{ fontSize: 11.5, color: "var(--paper-dim)" }}>
                    {m.count}× — {gbp(m.total)}
                  </span>
                </div>
              ))}
              <div className="wmg-sub" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                "Recurring" means this merchant showed up in at least 2 of the last 3 months — not necessarily the
                same amount each time, just a repeating pattern worth knowing about.
              </div>
            </div>
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

        {(() => {
          // Group visibleCategories by CATEGORY_GROUP_ORDER, preserving
          // each group's own category order, and skip any group that
          // has nothing in it rather than showing an empty header.
          const grouped = CATEGORY_GROUP_ORDER.map((groupName) => ({
            groupName,
            cats: visibleCategories.filter((c) => categoryGroupName(c.name) === groupName),
          })).filter((g) => g.cats.length > 0);

          return grouped.map(({ groupName, cats }) => {
            const groupSubtotal = cats.reduce((s, c) => s + c.items.reduce((si, i) => si + Number(i.amount || 0), 0), 0);
            return (
              <div key={groupName} style={{ marginBottom: 4 }}>
                <div className="wmg-eyebrow" style={{ display: "flex", justifyContent: "space-between", margin: "14px 0 6px" }}>
                  <span>{groupName}</span>
                  <span>{gbp(groupSubtotal)}/mo</span>
                </div>
                {cats.map((cat) => {
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
              </div>
            );
          });
        })()}
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

  // The "what changed" headline — same logic as OverviewTab's
  // biggestMover and findBiggestMover() in api/send-monthly-recap.js,
  // just scoped to this tab specifically rather than Overview. Compares
  // the current live category totals against the most recent *frozen*
  // month (profile.spendingSnapshots), not last month's live figures —
  // live figures are still changing as the month goes, so comparing
  // against them would be comparing a part-month to a full one.
  // Requires a real snapshot to exist and at least a 15% swing to
  // bother surfacing, same threshold as Overview, for the same reason:
  // a smaller move is just normal noise, not a headline.
  const biggestSpendMover = useMemo(() => {
    const snapshots = profile.spendingSnapshots || [];
    if (!snapshots.length) return null;
    const lastMonth = snapshots[snapshots.length - 1];
    const lastByName = new Map((lastMonth.categories || []).map((c) => [c.name, c.value]));
    let biggest = null;
    categoryChartData.forEach((c) => {
      const prev = lastByName.get(c.name);
      if (!prev || prev <= 0) return;
      const pctChange = ((c.value - prev) / prev) * 100;
      if (!biggest || Math.abs(pctChange) > Math.abs(biggest.pctChange)) {
        biggest = { name: c.name, value: c.value, prev, pctChange, diff: c.value - prev };
      }
    });
    if (!biggest || Math.abs(biggest.pctChange) < 15) return null;
    return biggest;
  }, [categoryChartData, profile.spendingSnapshots]);

  // "Ask your budget" — a free-form question answered from this
  // household's own stored data (see api/ask-budget.js), not general
  // advice. Same idle/loading/error/done/locked state shape as the
  // existing getSpendingInsight/checkBills below, for consistency.
  const [askBudgetQuestion, setAskBudgetQuestion] = useState("");
  const [askBudgetStatus, setAskBudgetStatus] = useState("idle"); // idle | loading | done | error | locked
  const [askBudgetAnswer, setAskBudgetAnswer] = useState("");
  const [askBudgetError, setAskBudgetError] = useState("");

  const askBudget = async () => {
    if (!askBudgetQuestion.trim()) return;
    setAskBudgetStatus("loading");
    setAskBudgetError("");
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      // Merchant-level detail, so this can actually answer what its own
      // placeholder promises ("how much did I spend on takeaways") —
      // before tonight's transaction-history work this genuinely
      // couldn't, since it only ever saw the same 6-7 broad category
      // totals already visible on this exact screen. Same RLS-scoped
      // direct query as the per-category merchant breakdown in
      // CategoryCard above, just grouped across every category rather
      // than one at a time, since a question here could be about
      // anything.
      let merchants = [];
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      const { data: txRows } = await supabase
        .from("household_transactions")
        .select("merchant, category, amount, date")
        .lt("amount", 0)
        .gte("date", threeMonthsAgo.toISOString().slice(0, 10));
      if (txRows && txRows.length > 0) {
        const byMerchant = new Map();
        txRows.forEach((t) => {
          const name = t.merchant || "Other";
          const key = `${name}__${t.category || ""}`;
          if (!byMerchant.has(key)) byMerchant.set(key, { name, category: t.category, total: 0, count: 0 });
          const entry = byMerchant.get(key);
          entry.total += Math.abs(Number(t.amount) || 0);
          entry.count += 1;
        });
        merchants = Array.from(byMerchant.values())
          .sort((a, b) => b.total - a.total)
          .slice(0, 40); // a generous cap, not every £1.50 one-off
      }

      const resp = await fetch(`${API_BASE}/api/ask-budget`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          question: askBudgetQuestion,
          categories: categoryChartData.map((r) => ({ name: r.name, value: r.value, budget: profile.expenseCategories.find((c) => c.name === r.name)?.budget ?? null })),
          income: totals.income,
          subscriptions: profile.subscriptions.filter((s) => !s.cancelled).map((s) => ({ name: s.name, amount: s.amount })),
          merchants,
        }),
      });
      const data = await resp.json();
      if (resp.status === 402) {
        setAskBudgetStatus("locked");
        return;
      }
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      setAskBudgetAnswer(data.answer);
      setAskBudgetStatus("done");
    } catch (e) {
      setAskBudgetStatus("error");
      setAskBudgetError(e.message || "Couldn't answer that right now.");
    }
  };

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
      <div className="wmg-section-title">Income</div>
      <Card>
        <div className="wmg-two-col">
          <div className="wmg-sentence-card">
            You take home <strong>{gbp(totals.income)}</strong> a month
            {profile.incomes.length > 1 ? ` across ${profile.incomes.length} income sources` : ""}.
          </div>
          <div>
            {/* Was a bare "total outgoings" figure — removed per feedback
                that it wasn't adding much next to the income line above
                it. This shows something genuinely different from
                Overview's "Budget" tile instead: that tile deliberately
                excludes lifestyle spending (fixed costs only), so this is
                the one place that shows what's left after literally
                everything, essentials + debt + lifestyle included. */}
            <div className="wmg-eyebrow" style={{ marginBottom: 8 }}>Leaves you with</div>
            <div className="wmg-figure tone-paper">
              {gbp(totals.income - totals.essential - totals.debtPayments - totals.lifestyle)}/mo
            </div>
          </div>
        </div>
      </Card>

      {/* Was a separate "Income sources" section title + its own
          explainer card, directly under a section already titled
          "Income" — read as the same concept said twice on a screen
          people land on straight from Overview's "Budget" tile.
          Same functional list (add/edit/remove income sources) as
          before, just folded into one Income section rather than two. */}
      <Card style={{ marginTop: 10 }}>
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
              {/* Bar breakdown instead of a pie + legend — easier to compare
                  bill amounts at a glance than matching slice colours to a
                  list, and it reuses the app's existing icon/label-left,
                  value-right list rhythm instead of a chart-specific
                  layout. Bars animate their width in on mount (see
                  wmg-bar-row-fill in motion.css). Scaled against the
                  largest single bill, not the total, so the biggest bar
                  reads as ~full width rather than everything looking small
                  next to a combined sum. */}
              {(() => {
                const maxBill = Math.max(1, ...billsChartData.map((r) => r.value));
                return billsChartData.map((row, i) => (
                  <Reveal key={row.name} delay={i * 45}>
                    <BarRow label={row.name} value={row.value} max={maxBill} tone={CATEGORY_TONES[i % CATEGORY_TONES.length]} formatter={(v) => gbp(v)} />
                  </Reveal>
                ));
              })()}
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

      {categoryChartData.length > 0 ? (
        <>
          {biggestSpendMover && (
            <div
              style={{
                display: "flex", alignItems: "center", gap: 12,
                background: "var(--brand-soft)", border: "0.5px solid var(--brand)",
                borderRadius: 14, padding: "12px 14px", marginBottom: 14,
              }}
            >
              <span className="wmg-showcase-icon tone-brand" style={{ width: 30, height: 30, flexShrink: 0 }} aria-hidden="true">
                <StatIcon name="flag" />
              </span>
              <div style={{ fontSize: 12.5, color: "var(--paper)", lineHeight: 1.4 }}>
                <strong>{biggestSpendMover.name}</strong> is {biggestSpendMover.pctChange > 0 ? "up" : "down"}{" "}
                {Math.round(Math.abs(biggestSpendMover.pctChange))}% since last month (
                {biggestSpendMover.pctChange > 0 ? "+" : "−"}
                {gbp(Math.abs(biggestSpendMover.diff))}).
              </div>
            </div>
          )}
          <div className="wmg-section-title">Where it actually goes</div>
          <div className="wmg-section-desc">
            Your day-to-day category spending — mortgage/rent, debt repayments and subscriptions are tracked
            separately, so they're not counted here.
          </div>
          <Card>
            {/* Same reasoning as the bills breakdown above — a bar per
                category, sorted by size, showing both the amount and the
                % of total spend it represents, is easier to actually read
                than matching pie slice colours to a legend list. Shows
                percentage alongside the amount specifically because a raw
                £ figure alone doesn't convey "is this a lot" the way
                "38% of your spending" does. */}
            {(() => {
              const maxCat = Math.max(1, ...categoryChartData.map((r) => r.value));
              return categoryChartData.map((row, i) => (
                <Reveal key={row.name} delay={i * 45}>
                  <BarRow
                    label={row.name}
                    value={row.value}
                    max={maxCat}
                    tone={CATEGORY_TONES[i % CATEGORY_TONES.length]}
                    formatter={(v) => `${gbp(v)} · ${Math.round((v / categoryChartTotal) * 100)}%`}
                  />
                </Reveal>
              ));
            })()}
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

          <Card style={{ marginBottom: 20 }}>
            <div className="wmg-eyebrow" style={{ marginBottom: 6 }}>Ask your budget</div>
            <div className="wmg-sub" style={{ marginBottom: 10 }}>
              Ask anything about your own numbers — "how much did I spend on takeaways", "what's my biggest
              subscription" — answered from what's actually here, not general advice.
            </div>
            {!hasPremium && (askBudgetStatus === "idle" || askBudgetStatus === "locked") && (
              <PremiumGate
                subscriptionStatus={subscriptionStatus}
                onUpgrade={onUpgrade}
                text="Asking your budget a question is a Premium feature."
              />
            )}
            {hasPremium && (
              <>
                {/* Switched away from flex entirely, rather than kept
                    fighting it — the diagnostic proved inline styles
                    reach this element fine (the magenta test box
                    rendered exactly as sized), but every flex-based
                    attempt at making the input grow to fill the row
                    still failed, which points at the `flex` shorthand
                    itself misbehaving in this WebView (a real, known
                    class of bug in some Android WebView versions) rather
                    than a specificity fight with .wmg-input. A plain
                    block layout with calc() sizing sidesteps flex
                    entirely instead of trying to out-guess it further.
                */}
                <div style={{ display: "block", width: "100%" }}>
                  <input
                    type="text"
                    className="wmg-input"
                    // Widened the button below, so the width subtracted
                    // here needs to match: 112px button + 8px margin.
                    style={{ display: "inline-block", width: "calc(100% - 120px)", verticalAlign: "middle", minHeight: 44 }}
                    placeholder="e.g. What's my biggest subscription?"
                    value={askBudgetQuestion}
                    onChange={(e) => setAskBudgetQuestion(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        askBudget();
                      }
                    }}
                    disabled={askBudgetStatus === "loading"}
                  />
                  <button
                    // Was wmg-add-btn — the plain dashed/secondary style,
                    // which undersold this: "Ask" is the actual primary
                    // action of this whole card, not a minor secondary
                    // one, so it gets the same solid gradient-fill
                    // treatment as other real submit buttons elsewhere
                    // (e.g. "Read a statement" on Investments).
                    className="wmg-btn-primary"
                    style={{
                      display: "inline-block", width: 112, marginLeft: 8, verticalAlign: "middle",
                      minHeight: 44, padding: "0 8px", fontSize: 14, fontWeight: 700,
                    }}
                    onClick={askBudget}
                    disabled={askBudgetStatus === "loading" || !askBudgetQuestion.trim()}
                  >
                    {askBudgetStatus === "loading" ? "Asking…" : "Ask"}
                  </button>
                </div>
                {askBudgetStatus === "locked" && (
                  <div style={{ marginTop: 10 }}>
                    <PremiumGate
                      subscriptionStatus={subscriptionStatus}
                      onUpgrade={onUpgrade}
                      text="Asking your budget a question is a Premium feature."
                    />
                  </div>
                )}
                {askBudgetStatus === "error" && (
                  <div className="wmg-sub" style={{ marginTop: 10, color: "var(--rust)" }}>{askBudgetError}</div>
                )}
                {askBudgetStatus === "done" && askBudgetAnswer && (
                  <div className="wmg-sub" style={{ marginTop: 10, color: "var(--paper)" }}>{askBudgetAnswer}</div>
                )}
              </>
            )}
          </Card>

          {profile.spendingSnapshots && profile.spendingSnapshots.length > 0 && (() => {
            // Just the most recent frozen month — see
            // api/monthly-spending-snapshot.js, which runs on the 1st and
            // fills this in. Unlike categoryChartData above, this doesn't
            // change if categories are edited later — it's a fixed record
            // of what that month actually looked like.
            const latest = profile.spendingSnapshots[profile.spendingSnapshots.length - 1];
            const latestTotal = latest.total || 1;
            const [year, monthNum] = latest.month.split("-");
            const monthLabel = new Date(Number(year), Number(monthNum) - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
            return (
              <>
                <div className="wmg-section-title">Last month's spending</div>
                <div className="wmg-section-desc">{monthLabel} — a fixed record, so it won't change even if you edit your categories later.</div>
                <Card>
                  <div className="wmg-category-chart-row">
                    <div style={{ width: 160, height: 160, flexShrink: 0 }}>
                      <ResponsiveContainer>
                        <PieChart>
                          <Pie data={latest.categories} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2} strokeWidth={0}>
                            {latest.categories.map((entry, i) => (
                              <Cell key={entry.name} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip content={<CategoryTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="wmg-category-legend">
                      {latest.categories.map((row, i) => (
                        <div className="wmg-category-legend-item" key={row.name}>
                          <span className="wmg-swatch" style={{ background: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }} />
                          <span className="wmg-category-legend-name">{row.name}</span>
                          <span className="wmg-category-legend-pct">{Math.round((row.value / latestTotal) * 100)}%</span>
                          <span className="wmg-category-legend-val">{gbp(row.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </>
            );
          })()}
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
        {/* Required by Logo.dev's free tier for commercial use — see the
            SUBSCRIPTION_BRANDS comment above. Small and out of the way
            deliberately; remove only if/when this moves to a paid
            Logo.dev plan, which drops the attribution requirement. */}
        {LOGO_DEV_TOKEN && (
          <div className="wmg-sub" style={{ marginTop: 8, fontSize: 11 }}>
            Logos provided by{" "}
            <a href="https://logo.dev" target="_blank" rel="noopener noreferrer" style={{ color: "inherit" }}>
              Logo.dev
            </a>
          </div>
        )}
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
  );
}


