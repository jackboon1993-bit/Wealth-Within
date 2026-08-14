# Wealth Within

A household finance dashboard: income, spending, debts, savings goals,
pension & State Pension projections, and a cash flow forecast. Originally
built as a Claude artifact; this is the same app as a standalone project you
can run locally and deploy for other people to use, each with their own
account.

## How it's put together

- **React + Vite** — no server-rendering, just a static site once built.
- **Recharts** — the pension and forecast charts.
- **Supabase** (optional) — email/password accounts and a Postgres database,
  so each person's data is private to them and follows them across devices.
- If Supabase isn't configured, the app still runs, skipping accounts
  entirely and saving to the browser's `localStorage` instead — handy for
  local development, or if you only ever want a single-user deployment with
  no login at all.

## Run it locally

```bash
npm install
npm run dev
```

That's enough to see the app running at `localhost:5173` — without
`.env.local` set up, it'll skip the sign-in screen and save to
`localStorage`.

## Adding real accounts (Supabase)

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run everything in `supabase/setup.sql` — this creates
   the `profiles` table and the row-level security policies that keep each
   user's data private to them.
3. In your Supabase project, go to **Authentication → Providers** and make
   sure **Email** is enabled. (For a quicker signup flow during testing, you
   can also turn off "Confirm email" under **Authentication → Settings** —
   turn it back on before real users sign up.)
4. Copy `.env.example` to `.env.local` and fill in your project's URL and
   anon key (**Project Settings → API**).
5. Restart `npm run dev` — you should now see a sign-in screen.

## Deploying it

The simplest path is [Vercel](https://vercel.com) or
[Netlify](https://netlify.com):

1. Push this project to a GitHub repo.
2. Import it into Vercel/Netlify.
3. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment
   variables in the project's dashboard (same values as your `.env.local`).
4. Deploy. Build command `npm run build`, output directory `dist`.
5. Add a custom domain once you're happy with it — both platforms make this
   a few clicks.

## Before you open this up to other people

This handles people's income, debts, and pension figures — worth treating
seriously before it's live for anyone but you:

- **Privacy policy & terms of service.** You're a data controller under
  UK GDPR the moment someone else's financial data touches your database.
  You'll likely also need to register with the [ICO](https://ico.org.uk)
  and pay the data protection fee — check whether an exemption applies to
  you, but assume it doesn't until you've checked.
- **The advice/guidance line.** This app calculates and educates — it
  doesn't recommend specific products or tell someone what to personally
  do with their money. That distinction matters: personalised
  recommendations are FCA-regulated financial advice, and offering it
  without authorisation is a serious problem, not a formality. Keep the
  "not financial advice" language intact everywhere, and get this
  reviewed properly (a solicitor, not just this README) before wider
  release, especially the "coach" framing.
- **Security basics.** Supabase encrypts data at rest and in transit by
  default, and row-level security stops one user reading another's data
  at the database level — but you're still responsible for keeping
  dependencies patched, not logging sensitive data, and having a plan
  for what you'd do in a breach.
- **A way for people to delete their data**, not just reset it to the
  example profile — right now `deleteData()` in `src/lib/storage.js`
  removes their row, but you'd want an obvious "delete my account"
  control wired to it, not just the internal reset button.

None of this needs solving before you show it to a few friends. It does
need solving before you market it.

## Project structure

```
src/
  App.jsx              the whole app — dashboard, tabs, calculations
  AuthGate.jsx          sign-in / sign-up screen, wraps App
  lib/
    storage.js          get/set/delete profile data (Supabase or localStorage)
    supabaseClient.js    Supabase client, null if not configured
supabase/
  setup.sql             run once in the Supabase SQL editor
```
