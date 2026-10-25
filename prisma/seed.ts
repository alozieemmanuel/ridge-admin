import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_SETTINGS } from "../src/lib/settings";
import { DEFAULT_EMAIL_TEMPLATES } from "../src/lib/emailDefaults";

const prisma = new PrismaClient();

async function main() {
  console.log("Creating the first event (if there is none)...");
  let event = await prisma.event.findFirst({ orderBy: { createdAt: "asc" } });
  if (!event) {
    event = await prisma.event.create({
      data: { slug: "investor-hangout", name: "Investor Hangout", modules: ["invitations", "attendance", "campaigns"] },
    });
  }

  console.log("Seeding settings...");
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.setting.upsert({
      where: { eventId_key: { eventId: event.id, key } },
      update: {},
      create: { eventId: event.id, key, value },
    });
  }

  console.log("Seeding email templates...");
  for (const t of DEFAULT_EMAIL_TEMPLATES) {
    await prisma.emailTemplate.upsert({
      where: { eventId_key: { eventId: event.id, key: t.key } },
      update: {},
      create: { ...t, eventId: event.id },
    });
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
