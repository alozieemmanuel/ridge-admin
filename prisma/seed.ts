import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { TABLE_COUNT, SEATS_PER_TABLE, tableLabel, seatLabel } from "../src/lib/seating";

const prisma = new PrismaClient();

const DEFAULT_TEMPLATES = [
  {
    key: "registration_confirmation",
    subject: "You're registered: {{programme_name}}",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

Thank you for registering for {{programme_name}}. We've received your details, and a member of the RIDGE team will follow up within 48 hours to confirm your seat.

Early Bird pricing is valid until {{early_bird_deadline}}. Use your full name as the payment reference, and send your payment receipt to {{contact_email}} once complete.`,
  },
  {
    key: "brochure_confirmation",
    subject: "Your RIDGE 2026 Brochure",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

Here's the brochure for {{programme_name}}. A member of our team will also reach out shortly with more details and to answer any questions.`,
  },
  {
    key: "internal_registration_notification",
    subject: "New RIDGE registration: {{full_name}}",
    replyTo: "",
    body: `Name: {{full_name}}
Email: {{email}}
Phone: {{phone}}
Country: {{country}}
Organization: {{organization}}
Registration type: {{reg_type_label}}
Notes: {{notes}}`,
  },
  {
    key: "internal_brochure_notification",
    subject: "New RIDGE brochure request: {{full_name}}",
    replyTo: "",
    body: `Name: {{full_name}}
Email: {{email}}`,
  },
  {
    key: "seat_selection_invite",
    subject: "Pick your seat for RIDGE Day 7",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

Your payment has been confirmed — thank you. You can now choose your seat for the Day 7 Graduation & Investor's Dinner.

Pick your seat here: {{seat_selection_url}}?rid={{registration_id}}

If you won't be able to make it to the venue in person, you'll be able to select "Attending Online" instead on that page.`,
  },
  {
    key: "payment_reminder",
    subject: "Reminder: complete your payment for {{programme_name}}",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

This is a friendly reminder that we haven't yet received your full payment for {{programme_name}}.

Account Name: {{payment_account_name}}
Bank: {{payment_bank_name}}
Account Number: {{payment_account_number}}
Currency: {{currency}}

Once you've made your payment, please send your receipt to {{contact_email}} so we can confirm it and unlock your seat selection.`,
  },
];

async function main() {
  console.log("Seeding settings...");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value },
    });
  }

  console.log("Seeding email templates...");
  for (const t of DEFAULT_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { key: t.key },
      update: {},
      create: t,
    });
  }

  console.log(`Seeding venue layout (${TABLE_COUNT} tables × ${SEATS_PER_TABLE} seats)...`);
  for (let i = 0; i < TABLE_COUNT; i++) {
    const label = tableLabel(i);
    const table = await prisma.eventTable.upsert({
      where: { label },
      update: { order: i },
      create: { label, order: i },
    });

    for (let seatNumber = 1; seatNumber <= SEATS_PER_TABLE; seatNumber++) {
      const label = seatLabel(i, seatNumber);
      await prisma.seat.upsert({
        where: { label },
        update: {}, // never overwrite status/assignment on re-seed
        create: { tableId: table.id, seatNumber, label },
      });
    }
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const adminName = process.env.SEED_ADMIN_NAME || "Admin";

  if (adminEmail && adminPassword) {
    const existing = await prisma.admin.findUnique({ where: { email: adminEmail.toLowerCase() } });
    if (existing) {
      console.log(`Admin ${adminEmail} already exists — skipping.`);
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await prisma.admin.create({
        data: {
          name: adminName,
          email: adminEmail.toLowerCase(),
          passwordHash,
          role: "OWNER",
        },
      });
      console.log(`Created owner admin: ${adminEmail}`);
    }
  } else {
    console.log(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — no admin account created. " +
        "Set them in your environment and re-run `npm run seed` to create your first login."
    );
  }

  console.log("Seed complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
