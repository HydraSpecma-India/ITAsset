# IT Purchase & Budget Monitor

A web app for tracking IT hardware and software purchases against a category-wise
budget that is split between **local staff** and **global staff**, with warranty /
licence / AMC / replacement expiry alerts and a next-year budget proposal builder.

Built with **Next.js 16** (App Router, JavaScript) and **Supabase**
(Postgres + Auth + Storage). No server-side secrets — the browser talks to
Supabase directly and everything is protected by row level security.

---

## What it does

| Screen | Purpose |
|---|---|
| **Dashboard** | Budget vs consumed vs balance for the selected calendar year, local/global split, monthly spend, over-budget categories, 90-day expiry watchlist |
| **Budget vs Actual** | The budget grid — one budget figure per category × local/global per year. Consumption is matched automatically from purchase lines. Editable by admins, exportable to CSV |
| **Expiry & Renewals** | Every warranty, licence, AMC and replacement date with days remaining, filterable by type and window |
| **Next Year Budget** | Prior-year actuals + already-committed renewals → suggested figure with an uplift %, editable line by line, then "Approve → budget" copies it into the approved budget |
| **Invoices** | Invoice header (number, date, vendor, PO, tax, freight, PDF/image copy) with any number of asset lines |
| **Asset Register** | Every purchased item — cost, owner, department, location, serial, all four expiry dates, status — searchable and filterable |
| **Categories & Vendors** | Master data |
| **Users** | Create admin/viewer accounts, reset passwords, disable accounts |

### Roles

- **Admin** — full access: enters invoices, edits budgets, maintains masters and users.
- **Viewer** — read-only. Intended for management: dashboards, budget comparison, expiry lists, CSV export.

Every account is forced to set its own password the first time it signs in.

---

## Running it

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # production build
```

Node 20 or newer.

### Deploying

Any Next.js host works. On Vercel: import the folder (or a Git repo containing it),
framework preset **Next.js**, no environment variables needed unless you are
pointing at a different Supabase project.

---

## Database

`supabase/schema.sql` is the complete, idempotent schema — tables, row level
security, views, the user-admin functions, the category seed, the storage bucket
for invoice copies, and the first two accounts.

**If you are using the Supabase project this was built against
(`ollhtyeflpggdazrsqsq`), the schema is already applied — do nothing.**

To move to a fresh Supabase project:

1. Create the project, open **SQL Editor**, paste `supabase/schema.sql`, run it.
   Change the two seed emails and the temporary password at the bottom first.
2. Copy the project URL and the publishable (anon) key from
   **Project Settings → API**.
3. Put them in `.env.local` (see `.env.example`) or edit `lib/supabase.js`.

### How consumption is matched to budget

Each asset line carries a **category**, a **scope** (local/global) and a
**purchase date**. The calendar year of the purchase date is the budget year.
The view `v_it_budget_summary` sums line totals by (year, category, scope) and
subtracts them from the budget row for the same key. Tax and freight sit on the
invoice header and are *not* charged to a category budget — move them into a line
if you want them counted.

### How expiry alerts work

`v_it_expiry_alerts` unpivots the four date columns on every asset that is not
disposed. The UI colours them: red for expired or ≤30 days, amber for ≤90 days,
green beyond that.

### How the next-year suggestion works

```
suggested = max(committed renewals in the plan year,
                prior-year actual × (1 + uplift%))   rounded to ₹500
```

"Committed" = every licence end, AMC end or replacement-due date that falls inside
the plan year, valued at the asset's line total.

---

## First sign-in

| Account | Email | Temporary password | Role |
|---|---|---|---|
| Admin | `itadmin@hydraspecma.com` | `Hydra@2026` | Admin |
| Viewer | `itview@hydraspecma.com` | `Hydra@2026` | Viewer |

Both are forced to change the password at first sign-in. Change these emails in
`supabase/schema.sql` before running it on a new project, and create the real
accounts from the **Users** screen afterwards.

---

## Suggested first hour

1. Sign in as admin, set a real password.
2. **Categories & Vendors** — adjust the 14 seeded categories to match how you
   wrote last year's budget, and add your regular vendors.
3. **Budget vs Actual** — pick the year, type last year's approved figures into
   the local and global columns, save.
4. **Invoices** — enter the purchases already made this year. One invoice can hold
   many asset lines; fill in warranty / licence / AMC / replacement dates as you go
   so the expiry screen becomes useful immediately.
5. **Dashboard** — the balance is now live.
6. **Users** — create a viewer account for management.

---

## Project layout

```
app/
  layout.js            fonts, auth provider
  page.js              redirects to login or dashboard
  login/               sign-in
  change-password/     forced first-time password change
  dashboard/           KPIs and charts
  budgets/             budget grid
  expiry/              renewal watchlist
  planning/            next-year proposal
  invoices/            invoice + asset line entry
  assets/              asset register
  masters/             categories and vendors
  users/               account management
components/
  Shell.js             sidebar, top bar, route guard
  ui.js                cards, KPIs, modal, and the hand-rolled SVG charts
lib/
  supabase.js          Supabase client
  session.js           auth context (user + profile + role)
  format.js            currency, dates, expiry maths, CSV export
supabase/
  schema.sql           complete database schema
```

The charts are plain inline SVG — no charting library, nothing to keep updated.
