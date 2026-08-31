import React, { useState, useEffect, useRef, useId } from "react";
import { gbp, clamp, uid } from "../lib/finance";
import { MASCOT_MESSAGES } from "../lib/constants";

export function Card({ children, className = "", style = {}, ...rest }) {
  return (
    <div className={`wmg-card ${className}`} style={style} {...rest}>
      {children}
    </div>
  );
}

/* Shows entered data as a read-only summary "bubble" by default — name,
   badge, and a one-line detail string — with a pencil button that reveals
   the real editable fields (passed as children). A "Done" button collapses
   it back into the summary. New/blank entries start open via
   startEditing, since there's nothing to summarize yet. */

export function EditableEntry({ badge, title, detail, children, onRemove, startEditing = false, removeLabel = "Remove" }) {
  const [editing, setEditing] = useState(startEditing);

  if (!editing) {
    return (
      <Card className="wmg-entry-card">
        <div className="wmg-entry-view">
          {badge}
          <div className="wmg-entry-view-text">
            <div className="wmg-entry-title">{title}</div>
            {detail && <div className="wmg-entry-detail">{detail}</div>}
          </div>
          <button type="button" className="wmg-entry-edit-btn" onClick={() => setEditing(true)} aria-label={`Edit ${title}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="wmg-entry-card">
      <div className="wmg-entry-edit">
        {children}
        <div className="wmg-entry-edit-actions">
          {onRemove && (
            <button type="button" className="wmg-icon-btn" onClick={onRemove} aria-label={removeLabel}>✕</button>
          )}
          <button type="button" className="wmg-entry-done-btn" onClick={() => setEditing(false)}>Done</button>
        </div>
      </div>
    </Card>
  );
}

/* Quest-style gradient progress ring — a single thick gradient stroke over a
   soft track, matching the Overview badge-circle palette. `progress` is 0–1. */

export const RING_GRADIENTS = {
  brand: ["#A78BFA", "#7C4DFF"],
  coral: ["#FF9166", "#FF6B4A"],
  sage: ["#4FD1C5", "#17A398"],
  gold: ["#FFCE6B", "#FFA400"],
  rust: ["#FF7AB0", "#FF3D81"],
};

export function GrowthRing({ progress, size = 84, tone = "brand", children }) {
  const uid = useId();
  const strokeWidth = size * 0.13;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, isFinite(progress) ? progress : 0));
  const offset = circumference * (1 - clamped);
  const [from, to] = RING_GRADIENTS[tone] || RING_GRADIENTS.brand;
  const gradId = `wmg-ring-grad-${uid}`;
  return (
    <div className="wmg-growth-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ink-3)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className="wmg-growth-ring-inner" style={{ width: size, height: size }}>{children}</div>}
    </div>
  );
}


export function StatIcon({ name }) {
  const common = { width: 16, height: 16, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "networth":
      return (
        <svg {...common}>
          <path d="M12 3v3M12 18v3M4.2 7.8l2.1 1.8M17.7 14.4l2.1 1.8M3 12h3M18 12h3M4.2 16.2l2.1-1.8M17.7 9.6l2.1-1.8" />
          <circle cx="12" cy="12" r="3.4" />
        </svg>
      );
    case "wallet":
      return (
        <svg {...common}>
          <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18a1 1 0 0 1 1 1v1.2" />
          <path d="M4 7.5v10A2.5 2.5 0 0 0 6.5 20H19a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 6.5" />
          <circle cx="16.2" cy="13.5" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "debt":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="M6 15h4" />
        </svg>
      );
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V10" />
        </svg>
      );
    case "savings":
      return (
        <svg {...common}>
          <path d="M4 13.5c0-3.6 3.1-6.5 7-6.5.9 0 1.8.15 2.6.44L17 5.5l1 3-2.1 1.2c1 1.1 1.6 2.4 1.6 3.8v1.7l2 1.3-1 1.5H17v1.5a1 1 0 0 1-1 1h-2.2a1 1 0 0 1-1-.86L12.5 18h-1.3l-.3 1.34a1 1 0 0 1-1 .86H7.7a1 1 0 0 1-1-1V17.5C5 16.3 4 15 4 13.5z" />
          <circle cx="14.5" cy="10.5" r="0.6" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pension":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v6c0 5 3.2 8.3 7.5 9.9 4.3-1.6 7.5-4.9 7.5-9.9V6L12 3z" />
        </svg>
      );
    case "invest":
      return (
        <svg {...common}>
          <polyline points="3 17 9.5 10.5 14 15 21 6.5" />
          <polyline points="15 6.5 21 6.5 21 12.5" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18" />
          <path d="M8 3v4M16 3v4" />
        </svg>
      );
    case "percent":
      return (
        <svg {...common}>
          <path d="M5 19 19 5" />
          <circle cx="6.5" cy="6.5" r="2.3" />
          <circle cx="17.5" cy="17.5" r="2.3" />
        </svg>
      );
    case "flag":
      return (
        <svg {...common}>
          <path d="M5 3v18" />
          <path d="M5 4.5c1.6-1 3.4-1 5 0s3.4 1 5 0v8c-1.6 1-3.4 1-5 0s-3.4-1-5 0z" />
        </svg>
      );
    case "pin":
      return (
        <svg {...common}>
          <path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z" />
          <circle cx="12" cy="9.5" r="2.3" />
        </svg>
      );
    default:
      return null;
  }
}


export function Stat({ label, value, tone = "paper", sub, icon }) {
  return (
    <Card className="wmg-stat">
      {icon && (
        <div className={`wmg-stat-icon-badge tone-${tone}`}>
          <StatIcon name={icon} />
        </div>
      )}
      <div className="wmg-eyebrow">{label}</div>
      <div className={`wmg-figure tone-${tone}`}>{value}</div>
      {sub && <div className="wmg-sub">{sub}</div>}
    </Card>
  );
}


export function ProgressBar({ value, max, tone = "gold" }) {
  const pct = clamp((value / Math.max(1, max)) * 100, 0, 100);
  return (
    <div className="wmg-progress-track">
      <div className={`wmg-progress-fill tone-${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}


export function Gauge({ score, variant = "light" }) {
  const cx = 110,
    cy = 118,
    r = 92;
  const theta = (180 - clamp(score, 0, 100) * 1.8) * (Math.PI / 180);
  const nx = cx + (r - 12) * Math.cos(theta);
  const ny = cy - (r - 12) * Math.sin(theta);
  const isHero = variant === "hero";
  const trackColor = isHero ? "rgba(255,255,255,0.28)" : "var(--ink-3)";
  const needleColor = isHero ? "#FFFFFF" : "var(--paper)";
  const hubFill = isHero ? "#FF9166" : "#8B5CF6";
  const hubStroke = "#FFFFFF";
  const gradId = isHero ? "gaugeGradHero" : "gaugeGrad";

  return (
    <svg viewBox="0 0 220 134" className="wmg-gauge" role="img" aria-label={`Financial score ${score} out of 100`}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
          {isHero ? (
            <>
              <stop offset="0%" stopColor="#FF9166" />
              <stop offset="50%" stopColor="#FFCE6B" />
              <stop offset="100%" stopColor="#4FD1C5" />
            </>
          ) : (
            <>
              <stop offset="0%" stopColor="#FF5C7A" />
              <stop offset="50%" stopColor="#FFCE6B" />
              <stop offset="100%" stopColor="#8B5CF6" />
            </>
          )}
        </linearGradient>
      </defs>
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={trackColor}
        strokeWidth="12"
        strokeLinecap="round"
        pathLength="100"
      />
      <path
        d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth="12"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray={`${clamp(score, 0, 100)} 100`}
      />
      <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={needleColor} strokeWidth="2.5" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="6" fill={hubFill} stroke={hubStroke} strokeWidth="2" />
    </svg>
  );
}

/* Compact, collapsed-by-default "why this matters" callout — real motivational
   context for a section, tucked behind a tap so it doesn't add to the page's
   visual weight for people who don't need it. */

export function WhyItMatters({ children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="wmg-why-card">
      <button type="button" className="wmg-why-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="wmg-why-icon">✦</span>
        <span className="wmg-why-label">Why this matters</span>
        <span className={`wmg-sub-chevron ${open ? "open" : ""}`} aria-hidden="true">›</span>
      </button>
      {open && <div className="wmg-why-body">{children}</div>}
    </div>
  );
}

/* Two-factor authentication management — enroll, verify, and remove a TOTP
   authenticator app factor via Supabase's built-in MFA API. Manages its own
   state so it can be dropped into any account-settings surface unchanged. */

export function InfoTip({ text, light }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="wmg-infotip-wrap">
      <button
        type="button"
        className={`wmg-infotip-btn ${light ? "wmg-infotip-btn-light" : ""}`}
        aria-label="More information"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setOpen(false)}
      >
        i
      </button>
      {open && (
        <span className="wmg-infotip-bubble" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

/* Phase 1 of the adaptive experience: a "see more details" collapsible
   section. Defaults closed for Guided mode (keep the first view simple) and
   open for Standard/Advanced (people who chose more detail shouldn't have
   to click for it). Not mode-gated content — anyone can open it regardless
   of mode; this only changes what's visible by default. */

export function DisclosureSection({ label = "See more details", defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="wmg-disclosure">
      <button type="button" className="wmg-disclosure-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Show less" : label} <span className="wmg-disclosure-chevron" aria-hidden="true">{open ? "\u2191" : "\u2193"}</span>
      </button>
      {open && <div className="wmg-disclosure-body">{children}</div>}
    </div>
  );
}


export function Field({ label, hint, children }) {
  return (
    <div className="wmg-field">
      <label className="wmg-field-label">
        {label}
        {hint && <InfoTip text={hint} />}
      </label>
      {children}
    </div>
  );
}

/* Numeric input used throughout the setup wizard. Fixes the "leading zero"
   bug: a plain controlled <input value={0}> displays a literal "0", and on
   many mobile keyboards new digits get typed after it instead of replacing
   it (e.g. "0" + "5000" => "05000"). This shows an empty field instead of a
   literal 0, and selects existing text on focus so typing always overwrites
   rather than appends. */

export function InlinePill({ value, onChange, type = "number", step, formatter, ariaLabel, minWidth, fill, align }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    onChange(type === "number" ? Number(draft) : draft);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`wmg-pill-input ${fill ? "wmg-pill-fill" : ""}`}
        type={type}
        step={step}
        inputMode={type === "number" ? "decimal" : undefined}
        value={draft}
        style={{ ...(minWidth ? { minWidth } : undefined), ...(align ? { textAlign: align } : undefined) }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
      />
    );
  }

  return (
    <button
      type="button"
      className={`wmg-pill ${fill ? "wmg-pill-fill" : ""}`}
      style={align ? { textAlign: align } : undefined}
      aria-label={ariaLabel}
      onClick={() => setEditing(true)}
    >
      {formatter ? formatter(value) : value}
    </button>
  );
}


export function ArrayEditor({ title, items, fields, onChange, onAdd, onRemove, addLabel }) {
  return (
    <div className="wmg-array-editor">
      <div className="wmg-array-title">{title}</div>
      {items.map((item) => (
        <div className="wmg-array-row" key={item.id}>
          {fields.map((f) => (
            <input
              key={f.key}
              className="wmg-input"
              type={f.type || "text"}
              value={item[f.key]}
              placeholder={f.label}
              onChange={(e) =>
                onChange(item.id, f.key, f.type === "number" ? Number(e.target.value) : e.target.value)
              }
              style={{ flex: f.key === "name" ? 2 : 1 }}
            />
          ))}
          <button className="wmg-icon-btn" onClick={() => onRemove(item.id)} aria-label="Remove">
            ✕
          </button>
        </div>
      ))}
      <button className="wmg-add-btn" onClick={onAdd}>
        + {addLabel}
      </button>
    </div>
  );
}


// Fixes a bug in plain `<input type="number" value={n} onChange={...Number(e.target.value)}>`
// patterns: clearing the field makes e.target.value "", Number("") is 0, so the
// component immediately re-renders showing "0" while the user is still mid-edit —
// the next digit they type then lands next to that "0" (typing "5" shows "05").
// This keeps a local text buffer so the field can sit empty while being edited,
// and only commits a parsed number to the model on a valid change or on blur.
export function NumberInput({ value, onChange, ...props }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <input
      {...props}
      type="number"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        if (raw !== "" && !isNaN(Number(raw))) onChange(Number(raw));
      }}
      onBlur={() => {
        if (text === "" || isNaN(Number(text))) setText(String(value));
      }}
    />
  );
}

export function useCountUp(target, duration = 700) {
  const [display, setDisplay] = useState(target);
  const prevRef = useRef(target);
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      prevRef.current = target;
      setDisplay(target);
      return;
    }
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const start = prevRef.current;
    const end = target;
    if (start === end) return;
    if (prefersReducedMotion) {
      prevRef.current = end;
      setDisplay(end);
      return;
    }
    const startTime = performance.now();
    let frame;
    const tick = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(start + (end - start) * eased);
      if (progress < 1) {
        frame = requestAnimationFrame(tick);
      } else {
        prevRef.current = end;
        setDisplay(end);
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target, duration]);

  return display;
}


export function CategoryTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="wmg-tooltip">
      <div className="wmg-tooltip-row">
        <span className="wmg-swatch" style={{ background: p.payload.fill || p.color }} />
        <span className="wmg-tooltip-name">{p.name}</span>
        <span className="wmg-tooltip-val">{gbp(p.value)}</span>
      </div>
    </div>
  );
}


/* ============================ motion & engagement ============================ */

// Wraps children in a small fade-up-and-in entrance, staggered by index —
// used anywhere a list of cards/rows appears at once (stat tiles, bar
// breakdowns, goal cards) so they settle in rather than popping into
// place all at once. All the actual animation lives in styles/motion.css
// (the .wmg-reveal class and its :nth-child delay rules) — this component
// just applies the class and an optional explicit delay for cases that
// aren't simple siblings. Respects prefers-reduced-motion via a plain CSS
// media query in that stylesheet, not JS, so it can't get out of sync
// with the rest of the app's motion.
export function Reveal({ children, delay = 0, className = "" }) {
  return (
    <div className={`wmg-reveal ${className}`} style={delay ? { animationDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

/* Generic bottom-sheet popout — same visual pattern already used for the
   Account and "More" sheets in App.jsx (wmg-more-sheet-backdrop /
   wmg-more-sheet / wmg-more-sheet-handle / wmg-more-sheet-title), pulled
   out here as a reusable component so the new progress/detail popouts
   (goals, cash flow milestones) don't each hand-roll their own version of
   the same markup. Closes on backdrop tap or the ✕, same as the existing
   sheets. */
export function Popout({ open, onClose, title, children, className = "" }) {
  if (!open) return null;
  return (
    <div className="wmg-more-sheet-backdrop" onClick={onClose}>
      <div className={`wmg-more-sheet ${className}`} onClick={(e) => e.stopPropagation()}>
        <div className="wmg-more-sheet-handle" />
        <div className="wmg-more-sheet-title">
          {title}
          <button className="wmg-icon-btn" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* A small celebratory moment for hitting a goal or milestone — a burst of
   coloured dots behind a headline, built in SVG/CSS rather than an image
   or external confetti library so it stays tiny and themeable via the
   existing tone colours. Purely decorative: screen readers just get the
   title/message text via normal DOM order, the burst is aria-hidden. */
export function Celebration({ title, message, tone = "gold" }) {
  const dotColors = {
    gold: ["#FFCE6B", "#FFA400", "#FF9166"],
    sage: ["#4FD1C5", "#17A398", "#4A7A3A"],
    brand: ["#A78BFA", "#7C4DFF", "#FF6FA5"],
  }[tone] || ["#FFCE6B", "#FFA400", "#FF9166"];
  const dots = Array.from({ length: 14 });
  return (
    <div className="wmg-celebration">
      <div className="wmg-celebration-burst" aria-hidden="true">
        {dots.map((_, i) => {
          const angle = (360 / dots.length) * i;
          const dist = 46 + (i % 3) * 10;
          const color = dotColors[i % dotColors.length];
          return (
            <span
              key={i}
              className="wmg-celebration-dot"
              style={{
                background: color,
                transform: `rotate(${angle}deg) translateY(-${dist}px)`,
                animationDelay: `${(i % 5) * 35}ms`,
              }}
            />
          );
        })}
      </div>
      <div className="wmg-celebration-body">
        <div className="wmg-celebration-title">{title}</div>
        {message && <div className="wmg-celebration-message">{message}</div>}
      </div>
    </div>
  );
}

/* A single labelled row with an animated horizontal bar — the "grow in"
   equivalent of a pie slice, but reusing the app's existing
   icon+label-left/value-right list idiom (see .wmg-detail-row) instead of
   a chart legend. The bar itself animates its width in via a CSS
   transition (see .wmg-bar-row-fill in motion.css) triggered by mounting
   at width 0 and immediately being told its real width — no JS animation
   loop needed. `max` sets what counts as a "full" bar; pass the largest
   value in the set so the biggest row reads as ~100%, not the sum of
   everything (which would make every bar look small). */
export function BarRow({ label, value, max, tone = "brand", formatter }) {
  const pct = clamp((value / Math.max(1, max)) * 100, 2, 100);
  return (
    <div className="wmg-bar-row">
      <div className="wmg-bar-row-top">
        <span className="wmg-bar-row-label">{label}</span>
        <span className="wmg-bar-row-value">{formatter ? formatter(value) : value}</span>
      </div>
      <div className="wmg-bar-row-track">
        <div className={`wmg-bar-row-fill tone-${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* Compact "N day streak" pill — shown on Overview once there's anything to
   show (a streak of 1 is just "opened today", not really a streak yet, so
   this only renders from 2 upward). Deliberately understated — a small
   flame + number, not a modal or a badge collection, in keeping with the
   rest of the app's low-pressure tone. */
export function StreakBadge({ streakCount }) {
  if (!streakCount || streakCount < 2) return null;
  return (
    <div className="wmg-streak-badge" title={`${streakCount} days in a row`}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2c1 3-2 4.5-2 7.5a2 2 0 0 0 4 0c1.5 1.5 2 3 2 4.5a5 5 0 0 1-10 0c0-4 3-6 3-9.5C9 3.5 10.3 2.5 12 2z" />
      </svg>
      <span>{streakCount} day streak</span>
    </div>
  );
}


export function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const visible = payload.filter((p) => p.name);
  if (!visible.length) return null;
  return (
    <div className="wmg-tooltip">
      <div className="wmg-tooltip-label">Year {label}</div>
      {visible.map((p) => (
        <div className="wmg-tooltip-row" key={p.dataKey}>
          <span className="wmg-swatch" style={{ background: p.color }} />
          <span className="wmg-tooltip-name">{p.name}</span>
          <span className="wmg-tooltip-val">{gbp(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

/* ================================ app ================================ */

// Income & Spending, Debts & Mortgage, and Savings & Goals are deliberately
// NOT in this list — they're reached by tapping the relevant box on the
// Overview screen instead (see heroStats/onNavigate in OverviewTab). The
// "tab" state itself still supports those keys; they're just not primary
// bottom-bar destinations any more.

export function NavIcon({ name }) {
  const common = { width: 17, height: 17, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round" };
  switch (name) {
    case "overview":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
          <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
        </svg>
      );
    case "income":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
          <path d="M6 15h4" />
        </svg>
      );
    case "debts":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V10" />
        </svg>
      );
    case "goals":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        </svg>
      );
    case "pension":
      return (
        <svg {...common}>
          <path d="M12 3 4.5 6v6c0 5 3.2 8.3 7.5 9.9 4.3-1.6 7.5-4.9 7.5-9.9V6L12 3z" />
        </svg>
      );
    case "reader":
      return (
        <svg {...common}>
          <path d="M14.5 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V8.5L14.5 3z" />
          <path d="M14 3v5.5h5.5" />
          <path d="M8.5 13h7" />
          <path d="M8.5 16.5h4.5" />
        </svg>
      );
    case "bank":
      return (
        <svg {...common}>
          <path d="M3 10 12 4l9 6" />
          <path d="M4.5 10v9M9 10v9M15 10v9M19.5 10v9" />
          <path d="M3 19.5h18" />
        </svg>
      );
    case "import":
      return (
        <svg {...common}>
          <path d="M12 3v12" />
          <path d="M7.5 10.5 12 15l4.5-4.5" />
          <path d="M4 19.5h16" />
        </svg>
      );
    case "forecast":
      return (
        <svg {...common}>
          <polyline points="3 17 9.5 10.5 14 15 21 6.5" />
          <polyline points="15 6.5 21 6.5 21 12.5" />
        </svg>
      );
    case "education":
      return (
        <svg {...common}>
          <path d="M2 8 12 2.5l10 5.5-10 5.5L2 8Z" />
          <path d="M5.5 10.3v7.7c0 1.7 2.9 3 6.5 3s6.5-1.3 6.5-3v-7.7" />
          <path d="M21 8.5v7" />
        </svg>
      );
    case "more":
      return (
        <svg {...common}>
          <circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return null;
  }
}


export function BrandMark({ size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 34 34" fill="none">
      <defs>
        <linearGradient id="brandMarkGrad" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FF6FA5" />
          <stop offset="100%" stopColor="#7C4DFF" />
        </linearGradient>
      </defs>
      <rect width="34" height="34" rx="10" fill="url(#brandMarkGrad)" />
      <path d="M8 21.5 13.2 15l4 4.2L26 10" stroke="#FFFFFF" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="26" cy="10" r="1.9" fill="#FFCE6B" />
    </svg>
  );
}


export function TabTip({ tab, seen, onDismiss }) {
  const message = MASCOT_MESSAGES[tab];
  if (seen || !message) return null;

  return (
    <div className="wmg-tab-tip" role="note">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="wmg-tab-tip-icon" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 16v-5" />
        <circle cx="12" cy="8.2" r="0.9" fill="currentColor" stroke="none" />
      </svg>
      <p className="wmg-tab-tip-text">{message}</p>
      <button type="button" className="wmg-tab-tip-close" onClick={onDismiss} aria-label="Got it, don't show this again">
        Got it
      </button>
    </div>
  );
}


export function Mascot({ tab, coachTips, inFinancialHardship, onNavigate }) {
  const [open, setOpen] = useState(false);
  const showCoach = tab === "overview" && (coachTips || inFinancialHardship);
  const message = MASCOT_MESSAGES[tab] || MASCOT_MESSAGES.default;

  return (
    <div className="wmg-mascot-wrap">
      {open && (
        <div className="wmg-mascot-bubble" role="dialog" aria-label={showCoach ? "Your coach" : "About this app"}>
          <button type="button" className="wmg-mascot-bubble-close" onClick={() => setOpen(false)} aria-label="Close">×</button>
          {showCoach ? (
            inFinancialHardship ? (
              <p>
                Right now your essential costs alone come to more than your income. There's real, free help
                available today — StepChange, National Debtline, Citizens Advice, or MoneyHelper.
              </p>
            ) : coachTips.length === 0 ? (
              <p>Everything's in decent shape. Keep going.</p>
            ) : (
              <div className="wmg-mascot-coach-list">
                {coachTips.slice(0, 3).map((tip, i) => (
                  <button
                    type="button"
                    className="wmg-mascot-coach-tip"
                    key={i}
                    onClick={() => {
                      setOpen(false);
                      onNavigate?.(tip.tab);
                    }}
                  >
                    {tip.text}
                  </button>
                ))}
              </div>
            )
          ) : (
            <p>{message}</p>
          )}
        </div>
      )}
      <button type="button" className="wmg-mascot-face" onClick={() => setOpen((o) => !o)} aria-label={showCoach ? "Your coach — tips for you" : "What does this app do?"} aria-expanded={open}>
        <svg width="26" height="26" viewBox="0 0 26 26">
          <circle cx="9" cy="12" r="1.9" fill="#FFFFFF" />
          <circle cx="17" cy="12" r="1.9" fill="#FFFFFF" />
          <path d="M7.5 16.5c2 2.2 9 2.2 11 0" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" fill="none" />
        </svg>
      </button>
    </div>
  );
}


export function AccordionItem({ title, body, isOpen, onToggle, tone = "brand" }) {
  return (
    <div className="wmg-accordion-item">
      <button className="wmg-accordion-head" onClick={onToggle} aria-expanded={isOpen}>
        <span>{title}</span>
        <span className={`wmg-accordion-toggle tone-${tone}`}>{isOpen ? "−" : "+"}</span>
      </button>
      {isOpen && <div className="wmg-accordion-body">{body}</div>}
    </div>
  );
}


