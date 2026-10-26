# Investor Hangout Admin

The admin dashboard for the **Investor Breakfast Hangout**, a strictly by-invitation event.
Next.js (App Router) + TypeScript + Prisma + Postgres. It started life as the RIDGE admin and was repurposed;
the code for the modules that are switched off is still in the repository.

## What it does

| Page | Purpose |
|------|---------|
| **Overview** | Live numbers: guests, seats reserved vs. the limit, invited, awaiting a reply, checked in, phone follow-up |
| **Registrations** | The guest list (name, email, phone, follow-up, seat reserved). Click a guest for everything: call feedback, notes, extra CSV columns, invitation / ticket history. **Import CSV** loads your offline list |
| **Attendance** | Seat limit, bulk invitations and reminders, check-in (search or ticket code) |
| **Campaigns** | One-off emails to a group of guests |
| **Email templates** | Wording of the invitation and reminder emails |
| **Settings** | Event details (date, time, venue, seats, contact) and the light/dark appearance |

### How a guest gets a seat

1. Import the guest list (CSV). Nobody is emailed by importing.
2. In **Attendance**, send the invitation. Every guest receives their **own unique link** (`/reserve?t=...`).
3. The guest opens it, sees their details and the event, and presses **Reserve My Seat**. There is no seat map.
4. Their **ticket** (QR code + ticket code) is emailed straight away and also shown on that page.
5. At the entrance, search by name or type / scan the ticket code in **Attendance** and press *Check in*.

The seat limit is enforced: reservations are counted one at a time, so the room can never be oversold.

## Switched-off modules

## Events

The dashboard manages several events from one place.

- `/event` is the list of events an admin can open, with their numbers.
- `/event/<slug>` is one event: Overview, Contacts (with the live sheet), Attendance, Campaigns, Settings, Activity log.
- `/event/<slug>/reserve?t=TOKEN` is the guest's own link.
- `/event/new` (owners) creates an event. `/event/team` (owners) manages admins and which events each admin can open.

Every event has its own contacts, settings, email templates, campaigns, activity log and live sheet. Owners open every event.
Other admins open only the events they were added to. Invitations, Attendance and Campaigns can be switched on or off per
event (Settings, Data tab, owners only).

Prospects, Payments and Brochure Requests are parked in `src/app/_parked` (Next ignores that folder) and their
endpoints answer 404 (see `src/lib/modules.ts`). WhatsApp is live per event (see below).

### Creating and editing an event

`/event/new` is a seven-step wizard (Basics, Brand, Wording, Contacts, Features, Payments for paid events, Team, Review) with a live preview.
Owners edit an event any time: Settings, **Edit event** (name, kind, parts, time zone, archive), **Branding** (colour, logos, wording),
**Contacts source**, **Payments** (paid events only). Event cards on the home page have an Edit link for owners.

### Contacts source

Each event picks one source in Settings, Contacts source: a live Google Sheet, a form on your website, a Supabase table, or manual.
- Form: the event gets a secret address, `POST /event/api/public/intake/<slug>`, with a key. Settings shows a ready-made form.
- Supabase: project address, table and key (stored on the server only). The table needs email and name columns.
- Sheet and Supabase are read on a schedule by `/event/api/cron/sheet-sync`.
- Add contact (Contacts page) adds one person by hand. CSV import works for every source.

### Email sender pool

`/event/senders` (owners edit) lists the senders in order of preference with a daily limit each: Gmail / Workspace, Brevo, MailerSend.
Campaign emails use the first sender with room. A failing sender is skipped for a minute. When every limit is used, the rest wait
in a queue and go out after midnight (Lagos time) through `/event/api/cron/email-queue`, or with "Send waiting emails now" on the
Campaigns page. Tickets and confirmations ignore the limits. With no senders listed, the old rule applies (campaigns via Brevo, the
rest via Gmail). Keys stay in the environment.

### WhatsApp

One company number, switched on per event (Settings, Edit event). Each event has an Inbox (one to one, with replies) and Broadcast
(approved templates to a group). Setup steps: `docs/WHATSAPP_SETUP.md`.

### Payments (paid events)

Price, currency and how guests pay (bank transfer, payment link, pay at the door). Guests see it on their page, and
`{{ticket_price}}` and `{{payment_instructions}}` work in email templates. Card checkout and payment tracking are not built yet.

### Scheduled jobs

Set `CRON_SECRET`, then call these every few minutes from cron-job.org or GitHub Actions (Vercel's free plan runs a job once a day):
`/event/api/cron/sheet-sync?key=<CRON_SECRET>` every 5 minutes and `/event/api/cron/email-queue?key=<CRON_SECRET>` every 15 minutes.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env: DATABASE_URL, DIRECT_URL, SESSION_SECRET, APP_BASE_URL, GMAIL_USER, GMAIL_APP_PASSWORD
npx prisma migrate deploy   # applies every migration, including the multi-event one
npm run seed                # first event if none exists, default templates/settings + your first admin login
npm run dev
```

Open `http://localhost:3000/event/login` and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
Open the event, then fill in the **date and venue** in Settings: invitations are blocked until both are set.

## CSV import

Upload any CSV with a header row. Columns are recognised by name (name, email, phone, company, follow-up
status, call feedback, and common variants). The import screen shows how each column was understood and lets
you change it. Any other column is kept on the guest's record. Rows without a valid email are listed so you can
fix them. Importing the same file twice is safe (existing emails are skipped, or updated if you choose).

## Branding

The name and logo live in `src/lib/brand.ts`. The logo is loaded from the Pertinence Group URL; set
`NEXT_PUBLIC_LOGO_URL` to change it. Colours are white and lemon green and are defined in `src/app/globals.css`
(dashboard) and `src/lib/email.ts` (emails). Add the site icon by replacing `src/app/icon.png`,
`src/app/apple-icon.png` and `src/app/favicon.ico`.
