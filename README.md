# RIDGE Admin

A real database and backend for the RIDGE registration/brochure system,
replacing the `code.gs` Google Apps Script + Sheets setup. Next.js 15
(App Router) + TypeScript + Prisma + Postgres.

## What this replaces

| Old (code.gs)                          | New                                              |
|-----------------------------------------|---------------------------------------------------|
| `doPost` on a `/exec` URL, no auth      | `POST /api/public/registrations`, `/brochure-requests` |
| Google Sheets rows                      | Postgres tables (`Registration`, `BrochureRequest`) |
| Hardcoded `CONFIG` block                | `Setting` table, editable at `/admin/settings`     |
| Hardcoded email HTML in `code.gs`       | `EmailTemplate` table, editable at `/admin/templates` |
| `MailApp.sendEmail`, no delivery data   | Gmail (transactional) + Brevo (campaigns, with delivery/open/bounce tracking) |
| Anyone with the `/exec` link has access | Session-based admin login, owner/admin roles       |

## Stack

- **Next.js 15** (App Router) — API routes + the admin dashboard UI in one deployable app
- **Prisma + Postgres** — schema in `prisma/schema.prisma`
- **Gmail** — transactional email (confirmations, reminders, seat invites)
- **Brevo** — campaign/broadcast email with delivery webhooks (falls back to console logging outside production if unconfigured)
- **Google Sheets** (service account) — the Prospects module
- **WhatsApp Business Cloud API (Meta)** — the WhatsApp module and WhatsApp broadcasts
- **jose + bcryptjs** — signed session cookies, hashed passwords
- **Tailwind CSS** — matches the black-and-gold RIDGE brand

## Getting started

```bash
npm install
cp .env.example .env
# edit .env: DATABASE_URL, SESSION_SECRET at minimum
npx prisma generate
npx prisma migrate dev --name init
npm run seed        # creates default templates/settings + your first admin login
npm run dev
```

Visit `http://localhost:3000/admin/login` and sign in with the
`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` you set in `.env`.

### Environment variables

See `.env.example` for the full list with comments. The two you cannot skip:

- `DATABASE_URL` — a Postgres connection string (Neon, Supabase, Railway, RDS, etc. all work)
- `SESSION_SECRET` — any random string 32+ characters (`openssl rand -base64 32`)

`BREVO_API_KEY` is optional for local development — without it, emails are
logged to the console instead of sent, so you can test the full registration
flow without live email credentials.

## Connecting the existing RIDGE frontend

In `register.html` and `index.html`, replace the Apps Script URL:

```js
// old:
var RIDGE_SCRIPT_URL = 'https://script.google.com/macros/s/.../exec';
fetch(RIDGE_SCRIPT_URL, { method: 'POST', mode: 'no-cors', body: formData });

// new:
const res = await fetch('https://your-domain.com/api/public/registrations', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(Object.fromEntries(formData)),
});
if (res.ok) { /* show success overlay */ } else { /* show the actual error */ }
```

Two changes worth making at the same time, now that you own the backend:

1. **Drop `mode: 'no-cors'`.** It made the Apps Script response unreadable,
   which is why the old code showed "success" on a fixed timer regardless of
   what actually happened. A same-origin (or CORS-enabled) JSON API lets you
   show a real error to someone whose registration failed instead of a fake
   success screen.
2. **Send JSON, not FormData.** The API routes here expect
   `application/json`; swap `body: formData` for
   `body: JSON.stringify(Object.fromEntries(formData))`.

For the brochure modal in `index.html`, same idea against
`/api/public/brochure-requests`.

## Deploying

1. Push this repo, connect it to **Vercel**.
2. Provision Postgres (Neon or Supabase both have a one-click Vercel integration).
3. Set the environment variables from `.env.example` in Vercel's project settings.
4. Run `npx prisma migrate deploy` against the production `DATABASE_URL` (Vercel's
   build step, or a one-off local run pointed at production).
5. Run `npm run seed` once (locally, pointed at production `DATABASE_URL`, or as a
   one-off script) to create your first admin login.
6. In Brevo (Transactional > Settings > Webhooks), add a webhook pointed at
   `https://your-domain.com/api/webhooks/brevo` for Delivered, Opened, Hard bounce,
   Soft bounce, Blocked, Invalid email and Spam. This populates the
   Delivered/Opened/Bounced stats on the dashboard. Set an authentication token on the
   webhook and put the same value in `BREVO_WEBHOOK_SECRET`. `EMAIL_FROM` must be a
   sender or domain you have verified in Brevo.

### Prospects (Google Sheets)

1. In Google Cloud, create a service account, enable the Google Sheets API, and create a
   JSON key. Set `GOOGLE_SERVICE_ACCOUNT_JSON` to the whole key file (or set
   `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`).
2. Share your Prospects sheet with the service account's email as **Editor**.
3. In the dashboard: Prospects > Sheets > connect the sheet (link + tab name). The first
   row of the tab must be the column headings. A `RIDGE ID` column is added on the right
   so rows can be found again after sorting.
4. If a sheet uses different column names (for example a digital marketing leads sheet),
   use **Match columns** to pick the right column for each field.

### WhatsApp (Meta Cloud API)

Set `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
`WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN`. In the Meta developer console, set the
webhook to `https://your-domain.com/api/webhooks/whatsapp` with your verify token and
subscribe to the `messages` field. Broadcasts and first messages use approved templates
(WhatsApp rules); free-text replies work within 24 hours of a person's last message.

## Importing existing registrations

If people already registered through the old Google Sheets / Apps Script
system, backfill them with `prisma/import-registrations.ts`:

```bash
# From Google Sheets: File > Download > Comma Separated Values (.csv)
npm run import:registrations -- path/to/export.csv --dry-run   # preview first
npm run import:registrations -- path/to/export.csv             # then actually import
```

It recognizes common header names automatically (Full Name, Email, Phone,
Country, Organization, Notes, Timestamp — see the comment at the top of the
script for the full list and how to adjust it for a differently-named
export). It upserts by email, so it's safe to re-run if you get an updated
export later — existing rows get updated, not duplicated. **It never sends
confirmation or notification emails** — this is a historical backfill, not
new registrations, so nobody gets a "you're registered" email for something
that happened months ago.

## What's been verified vs. what hasn't

Honest status, not a blanket "it works":

- **Full `next build` passes** — every page and API route compiles and
  type-checks against the exact shape of the Prisma schema (all 22 routes,
  middleware included). This was run and re-run in the process of building
  it, catching and fixing a real edge-runtime bug (bcryptjs doesn't run in
  Next.js Middleware) and a relation-typing gap along the way.
- **Not verified: a live database round-trip.** The sandbox this was built in
  can't reach `binaries.prisma.sh` (Prisma's engine download host), so
  `prisma generate`'s real output — and therefore an actual `npm run dev`
  against a real Postgres database — hasn't been exercised end to end here.
  That command works normally on a real machine, in CI, or on Vercel; it's a
  restriction specific to the sandbox this was authored in. Your first
  `npx prisma generate && npx prisma migrate dev` locally is the first real
  test of the schema against a live database — if anything's off, that's
  where it'll surface, and it's a fast loop to fix from there.
- **Not verified: live Brevo, Google Sheets and WhatsApp calls** — the code follows
  each provider's documented request/webhook shape, but none of them has been called
  with real credentials in this environment.

## Project structure

```
prisma/schema.prisma          Database schema
prisma/seed.ts                 Default templates/settings + first admin
src/lib/prisma.ts              Prisma client singleton
src/lib/auth.ts                Sessions, password hashing
src/lib/email.ts               Branded HTML rendering + Gmail/Brevo sending
src/lib/notifications.ts       Orchestrates confirmation + internal emails
src/lib/settings.ts            Business config defaults + template merging
src/middleware.ts              Protects /admin and /api/admin routes
src/app/api/public/            Registration + brochure form submission
src/app/api/admin/             Admin-only: registrations, templates, settings, admins
src/app/api/webhooks/brevo/    Delivery/open/bounce tracking
src/app/api/webhooks/whatsapp/ WhatsApp incoming messages + delivery status
src/lib/google-sheets.ts       Service-account Sheets client
src/lib/prospects.ts           Sheet sync + write-back
src/lib/whatsapp.ts            WhatsApp Cloud API client + webhook handling
src/app/admin/                 The dashboard UI itself
```
