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

Prospects, Payments, Brochure Requests and WhatsApp are hidden: their pages redirect to the Overview and their
endpoints answer 404 (see `src/lib/modules.ts`). To bring one back, remove it from that file and add it to the
sidebar in `src/components/AdminShell.tsx`.

## Getting started

```bash
npm install
cp .env.example .env
# edit .env: DATABASE_URL, DIRECT_URL, SESSION_SECRET, APP_BASE_URL, GMAIL_USER, GMAIL_APP_PASSWORD
npx prisma migrate deploy   # applies every migration, including the Investor Hangout one
npm run seed                # default templates/settings + your first admin login
npm run dev
```

Open `http://localhost:3000/admin/login` and sign in with `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
Then fill in the **date and venue** in Settings: invitations are blocked until both are set.

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
