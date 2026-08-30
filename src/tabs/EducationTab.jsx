import React, { useState } from "react";
import { Card, AccordionItem } from "../components/ui";
import { API_BASE } from "../lib/apiBase";
import { supabase } from "../lib/supabaseClient";
import { gbp } from "../lib/finance";

// Deliberately duplicated from IncomeTab.jsx/BankImportTab.jsx/
// AccountPanel.jsx/DebtsTab.jsx rather than imported — EducationTab is
// its own lazy-loaded chunk, and importing across chunks would couple
// two that were deliberately split apart for one small component.
function PremiumGate({ subscriptionStatus, onUpgrade, text }) {
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

export const EDUCATION_TOPICS = [
  {
    category: "Pensions",
    items: [
      {
        title: "Why starting early matters more than how much",
        body: "Compound growth means your returns start earning their own returns, so time in the market does more heavy lifting than the size of your contributions. Someone who starts paying £200/month into a pension at 25 and stops at 35 (ten years of contributions, then nothing more) can end up with a larger pot at 65 than someone who starts at 35 and pays £200/month every year until retirement — purely because the first person's money had an extra decade to grow. The practical takeaway isn't 'it's too late' if you're starting later — it's that whatever you can contribute now is worth more than the same amount contributed next year, so the biggest cost of waiting is the years you can't get back.",
      },
      {
        title: "Workplace pensions & auto-enrolment",
        body: "If you're employed, aged 22+, and earn over £10,000/year, your employer must automatically enrol you into a workplace pension unless you opt out. You pay in (usually a minimum of 5% of qualifying earnings), your employer adds at least 3% on top, and the government adds tax relief. Opting out means walking away from free money from your employer — it's usually worth staying in unless you have a specific reason not to.",
      },
      {
        title: "Defined contribution vs defined benefit",
        body: "Most modern workplace pensions are defined contribution (DC): you and your employer pay into a pot, it's invested, and what you get at retirement depends on how much went in and how it grew. Older or public-sector pensions are often defined benefit (DB) — sometimes called 'final salary' — where you're promised a specific income for life based on your salary and years of service, regardless of investment performance. DB pensions are generally more valuable and rarer; if you have one, think very carefully before transferring out of it.",
      },
      {
        title: "SIPPs — self-invested personal pensions",
        body: "A SIPP is a pension you control directly, choosing your own investments, rather than being defaulted into a provider's fund. They suit people who are self-employed, want more investment choice, or want to consolidate old workplace pensions. They come with the same tax relief as other pensions, but you carry the responsibility for investment decisions — or the cost of paying someone to make them for you.",
      },
      {
        title: "The State Pension",
        body: "The State Pension is separate from any workplace or personal pension, and depends on your National Insurance (NI) record rather than a pot you've built up. You typically need 35 qualifying years of NI contributions for the full amount, and at least 10 years for any payment at all. The age you can claim it is currently rising towards 67, then 68. It's worth checking your own forecast and NI record at gov.uk/check-state-pension — gaps from time abroad, self-employment, or career breaks can reduce what you get, and voluntary contributions can sometimes fill them.",
      },
      {
        title: "Pension tax relief, explained",
        body: "When you pay into a pension, the government tops it up as tax relief — effectively refunding the income tax you'd have paid on that money. A basic-rate taxpayer paying in £80 sees it topped up to £100; higher and additional-rate taxpayers can claim back more via their tax return. This is on top of any employer contribution, which is why pensions are usually the most tax-efficient way to save for the long term, even before investment growth is considered.",
      },
      {
        title: "Annuity vs drawdown at retirement",
        body: "When you access a defined contribution pension (from age 55, rising to 57 from 2028), you can normally take up to 25% as a tax-free lump sum. With the rest, an annuity converts your pot into a guaranteed income for life — simple and predictable, but the rate you're offered depends on interest rates and your health, and it's usually irreversible. Drawdown instead keeps your pot invested and you draw an income from it — more flexible and with more upside, but the pot can run out or fall in value if markets do badly. Many people use a mix of both, or a phased move from drawdown towards an annuity later in retirement.",
      },
    ],
  },
  {
    category: "Savings & ISAs",
    items: [
      {
        title: "Cash ISA vs Stocks & Shares ISA",
        body: "An ISA (Individual Savings Account) lets you save or invest up to an annual allowance (£20,000 for 2024/25) without paying tax on the interest, dividends, or gains. A Cash ISA works like a savings account — low risk, low return, good for money you might need at short notice. A Stocks & Shares ISA invests the money in the market — historically higher long-term returns, but the value can fall as well as rise, so it suits money you won't need for at least 5 years.",
      },
      {
        title: "Lifetime ISA (LISA)",
        body: "If you're 18–39, a LISA lets you save up to £4,000/year towards a first home or retirement, and the government adds a 25% bonus on top — up to £1,000/year. You can access the money for a first home purchase (under £450,000) at any time, or penalty-free from age 60 for anything else. Withdraw it for any other reason and you lose the bonus plus a bit of your own money, so it's best treated as genuinely locked away until one of those two goals.",
      },
      {
        title: "Emergency funds — why 3–6 months",
        body: "An emergency fund is money kept in easy-access savings, separate from your everyday account, for genuine shocks — job loss, a broken boiler, an unexpected bill. The usual guideline is 3–6 months of essential outgoings, with the higher end suiting single incomes, self-employment, or less job security. It belongs in something instant-access, like an easy-access savings account, not invested — the point isn't growth, it's being there when you need it without having to borrow or sell investments at a bad time.",
      },
      {
        title: "Personal Savings Allowance",
        body: "Outside an ISA, most people can still earn some savings interest tax-free each year — currently £1,000 for basic-rate taxpayers, £500 for higher-rate, and £0 for additional-rate taxpayers. With savings rates higher than they've been in years, it's become easier to exceed this on a large cash balance, which is one more reason ISA allowances are worth using where you can.",
      },
    ],
  },
  {
    category: "Debt",
    items: [
      {
        title: "Avalanche vs snowball",
        body: "When paying off multiple debts, the avalanche method puts extra money towards the highest interest rate debt first, while making minimum payments on the rest — mathematically it saves the most money. The snowball method instead targets the smallest balance first, for a quicker psychological win, then rolls that payment onto the next smallest. Avalanche saves more in interest; snowball can be easier to stick with. Either beats paying minimums only.",
      },
      {
        title: "APR, explained",
        body: "APR (Annual Percentage Rate) is the yearly cost of borrowing, including interest and most fees, expressed as a single percentage — it's designed to let you compare loans, cards, and overdrafts on a like-for-like basis. A 0% purchase or balance transfer credit card genuinely charges no interest for a set period, but usually reverts to a much higher rate afterwards and often carries a transfer fee, so the promotional rate isn't the whole story.",
      },
      {
        title: "Secured vs unsecured debt",
        body: "A secured debt, like a mortgage or a car on finance, is tied to an asset the lender can repossess if you stop paying — this is usually why secured rates are lower. An unsecured debt, like a credit card, personal loan, or overdraft, isn't backed by a specific asset, so lenders charge more to offset their risk, and generally accept partial payment plans more readily in genuine hardship. Never treat unsecured debt as more urgent than a mortgage or secured loan just because the calls feel more frequent — missing secured payments risks your home or car.",
      },
    ],
  },
  {
    category: "Getting real help",
    items: [
      {
        title: "Free, impartial guidance",
        body: "MoneyHelper (moneyhelper.org.uk) is a free, government-backed service covering budgeting, debt, pensions, and savings, with phone and webchat advisers. Pension Wise, part of MoneyHelper, offers a free guidance appointment for anyone 50+ with a defined contribution pension, before you make any decisions about accessing it. Citizens Advice can help with debt and wider financial difficulty, including free debt advice charities like StepChange and National Debtline if things feel unmanageable.",
      },
      {
        title: "When to see a regulated financial adviser",
        body: "This app — and free guidance services — can help you understand your options, but neither can tell you what's right for your specific circumstances the way a regulated financial adviser can. It's worth paying for advice before large, hard-to-reverse decisions: transferring a defined benefit pension, choosing an annuity, consolidating old pensions, or investing a large lump sum. Check an adviser is registered on the FCA register at register.fca.org.uk before paying for anything.",
      },
    ],
  },
];


export const EDU_CATEGORY_TONES = {
  Pensions: "gold",
  "Savings & ISAs": "sage",
  Debt: "coral",
  "Getting real help": "brand",
};


// Maps profile data the app already has to a handful of the topics
// above, so the person sees what's most relevant to their own situation
// first, instead of the same 17 topics in the same order regardless of
// circumstances. Pure logic, no AI or API call — this is instant and
// free, unlike the "Ask a question" box below. Returns at most 3 matches
// in priority order (most time-sensitive first), each referencing a
// topic by its accordion id ("<category>-<index>") so the actual topic
// text lives in exactly one place (EDUCATION_TOPICS above) rather than
// being duplicated here.
function getRelevantTopics(profile, totals, pensionYearsToRetire, inFinancialHardship) {
  const candidates = [];

  if (inFinancialHardship) {
    candidates.push({ id: "Getting real help-0", reason: "Because your essential spending is currently close to or above your income" });
  }
  if (totals.totalDebt > 0) {
    candidates.push({ id: "Debt-0", reason: `Because you're carrying ${gbp(Math.round(totals.totalDebt))} in loans and card debt` });
  }
  const emergencyTarget = profile.emergencyFund?.target || 0;
  if (emergencyTarget > 0 && (profile.emergencyFund?.balance || 0) < emergencyTarget) {
    candidates.push({ id: "Savings & ISAs-2", reason: "Because your emergency fund isn't at its target yet" });
  }
  if (pensionYearsToRetire != null) {
    if (pensionYearsToRetire <= 10) {
      candidates.push({ id: "Pensions-6", reason: `Because you're about ${pensionYearsToRetire} years from your target retirement age` });
    } else {
      candidates.push({ id: "Pensions-0", reason: "Because you've still got time on your side before retirement" });
    }
  }
  if ((profile.investments?.balance || 0) === 0 && (profile.savings?.balance || 0) > emergencyTarget) {
    candidates.push({ id: "Savings & ISAs-0", reason: "Because you've got savings beyond your emergency fund that could be working harder" });
  }

  return candidates.slice(0, 3);
}

function findTopic(id) {
  const [category, indexStr] = [id.slice(0, id.lastIndexOf("-")), id.slice(id.lastIndexOf("-") + 1)];
  const group = EDUCATION_TOPICS.find((g) => g.category === category);
  return group?.items?.[Number(indexStr)] || null;
}

export function EducationTab({ profile, totals, pensionYearsToRetire, inFinancialHardship, hasPremium, subscriptionStatus, onUpgrade }) {
  const [openId, setOpenId] = useState(null);
  const [question, setQuestion] = useState("");
  const [questionStatus, setQuestionStatus] = useState("idle"); // idle | asking | done | error | locked
  const [answer, setAnswer] = useState(null);
  const [questionError, setQuestionError] = useState("");

  const relevantTopics = getRelevantTopics(profile, totals, pensionYearsToRetire, inFinancialHardship)
    .map((r) => ({ ...r, topic: findTopic(r.id) }))
    .filter((r) => r.topic);

  const askQuestion = async () => {
    if (!question.trim()) return;
    setQuestionStatus("asking");
    setQuestionError("");
    setAnswer(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const resp = await fetch(`${API_BASE}/api/education-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ question: question.trim() }),
      });
      const data = await resp.json();
      if (resp.status === 402) {
        setQuestionStatus("locked");
        return;
      }
      if (!resp.ok) throw new Error(data.error || "Something went wrong.");
      setAnswer(data.answer);
      setQuestionStatus("done");
    } catch (e) {
      setQuestionStatus("error");
      setQuestionError(e.message || "Couldn't get an answer right now.");
    }
  };

  return (
    <>
      <div className="wmg-section-title">Education</div>
      <div className="wmg-section-desc">
        General information to help you understand your options — not personalised financial advice, and it doesn't
        know your circumstances the way a regulated adviser or MoneyHelper would. Rules, rates, and allowances change
        most years; treat specific figures below as a guide and check gov.uk or MoneyHelper for current numbers.
      </div>

      {relevantTopics.length > 0 && (
        <>
          <div className="wmg-section-title">For you</div>
          <div className="wmg-section-desc">Picked based on what you've already entered elsewhere in the app.</div>
          <Card>
            {relevantTopics.map((r, i) => (
              <div key={r.id} style={{ marginBottom: i === relevantTopics.length - 1 ? 0 : 14 }}>
                <div className="wmg-sub" style={{ marginBottom: 4 }}>{r.reason}</div>
                <AccordionItem
                  title={r.topic.title}
                  body={r.topic.body}
                  isOpen={openId === `foryou-${r.id}`}
                  onToggle={() => setOpenId(openId === `foryou-${r.id}` ? null : `foryou-${r.id}`)}
                  tone="brand"
                />
              </div>
            ))}
          </Card>
        </>
      )}

      <div className="wmg-section-title">Ask a question</div>
      <div className="wmg-section-desc">
        Anything about pensions, savings, debt, or how something works — general education, not advice tailored to
        your specific situation.
      </div>
      <Card>
        {!hasPremium || questionStatus === "locked" ? (
          <PremiumGate
            subscriptionStatus={subscriptionStatus}
            onUpgrade={onUpgrade}
            text="Asking a free-text question is a Premium feature."
          />
        ) : (
          <>
            <textarea
              className="wmg-input"
              rows={2}
              placeholder="e.g. What's the difference between an annuity and drawdown?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              maxLength={500}
              style={{ resize: "vertical", minHeight: 44 }}
            />
            <button
              type="button"
              className="wmg-add-btn"
              style={{ marginTop: 8 }}
              disabled={!question.trim() || questionStatus === "asking"}
              onClick={askQuestion}
            >
              {questionStatus === "asking" ? "Thinking…" : "Ask"}
            </button>
            {questionStatus === "error" && (
              <div className="wmg-sub" style={{ marginTop: 8, color: "var(--rust)" }}>{questionError}</div>
            )}
            {questionStatus === "done" && answer && (
              <div className="wmg-sub" style={{ marginTop: 12, whiteSpace: "pre-wrap", color: "var(--paper)" }}>
                {answer}
              </div>
            )}
          </>
        )}
      </Card>

      {EDUCATION_TOPICS.map((group) => {
        const tone = EDU_CATEGORY_TONES[group.category] || "brand";
        return (
          <React.Fragment key={group.category}>
            <div className="wmg-section-title">
              <span className={`wmg-edu-dot tone-${tone}`} />
              <span>{group.category}</span>
            </div>
            <Card>
              {group.items.map((item, i) => {
                const id = `${group.category}-${i}`;
                return (
                  <AccordionItem
                    key={id}
                    title={item.title}
                    body={item.body}
                    isOpen={openId === id}
                    onToggle={() => setOpenId(openId === id ? null : id)}
                    tone={tone}
                  />
                );
              })}
            </Card>
          </React.Fragment>
        );
      })}
    </>
  );
}

