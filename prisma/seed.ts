import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { TABLE_COUNT, SEATS_PER_TABLE, tableLabel, seatLabel } from "../src/lib/seating";

const prisma = new PrismaClient();

const DEFAULT_TEMPLATES = [
  {
    key: "registration_confirmation",
    subject: "You're registered for RIDGE 2026",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

    Thank you for registering for RIDGE 2026: Executive Wealth Creation Programme. We have received your details and we are glad you are joining us.

    The programme promises to give you the training, mentorship, platforms and inventory you need to build wealth on purpose. It runs {{cohort_dates}}, and every day is built to move you closer to that goal.

    One of our team members will be in touch shortly with your next steps.`,
  },
  {
    key: "brochure_confirmation",
    subject: "Your RIDGE 2026 Brochure",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

Here's the brochure for {{programme_name}}. A member of our team will also reach out shortly with more details and to answer any questions.`,
  },
  {
    key: "seat_selection_invite",
    subject: "Pick your seat for RIDGE Day 7",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

Your payment has been confirmed. Thank you. You can now choose your seat for the Day 7 Graduation and Investor's Dinner using the button below.

If you will not be able to come to the venue in person, you can choose to attend online on the same page.`,
  },
  {
    key: "payment_reminder",
    subject: "A gentle reminder about your RIDGE registration",
    replyTo: "{{contact_email}}",
    body: `Dear {{first_name}},

We hope you are keeping well.

Thank you for registering for {{programme_name}}. We noticed that your payment has not been completed yet, and we would be delighted to have you with us from {{cohort_dates}}.

If you have already paid, thank you, and please disregard this note. You are welcome to upload your receipt at any time using the button below.

Otherwise, the button below takes you back to the payment page, where you can choose the currency you prefer and the payment method that suits you.

If you have any questions or need a hand, simply reply to this email or reach us on WhatsApp. We are always happy to help.

Warm regards,
The RIDGE Team`,
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
