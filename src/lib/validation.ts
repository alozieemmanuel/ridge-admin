import { z } from "zod";
import { isValidEmailAddress } from "@/lib/email";

export const registrationSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required.").max(200),
  email: z.string().trim().email("A valid email is required.").max(320),
  phone: z.string().trim().min(5, "A valid phone number is required.").max(40),
  country: z.string().trim().min(2, "Country is required.").max(100),
  organization: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  regType: z.enum(["early_bird", "late"]).optional().default("early_bird"),
});

export const brochureRequestSchema = z.object({
  fullName: z.string().trim().min(2, "Full name is required.").max(200),
  email: z.string().trim().email("A valid email is required.").max(320),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

export const createAdminSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email(),
  password: z.string().min(10, "Password must be at least 10 characters."),
  role: z.enum(["OWNER", "ADMIN"]).default("ADMIN"),
});

// Reply-To may be a real address, a single {{token}} such as {{contact_email}}
// (the seeded default — merged at send time), or empty.
const SINGLE_TOKEN = /^\{\{\s*[a-zA-Z0-9_]+\s*\}\}$/;

export const updateTemplateSchema = z.object({
  subject: z.string().trim().min(1, "Subject can't be empty.").max(300, "Subject is too long (max 300 characters)."),
  body: z.string().trim().min(1, "Body can't be empty.").max(20000, "Body is too long (max 20,000 characters)."),
  replyTo: z
    .string()
    .trim()
    .refine(
      (v) => v === "" || SINGLE_TOKEN.test(v) || isValidEmailAddress(v),
      "Reply-To must be an email address like ridge@example.com (or the {{contact_email}} token), or left empty."
    )
    .nullable()
    .optional(),
});

export const updateSettingsSchema = z.record(z.string(), z.string().max(2000));

export const updateSeatStatusSchema = z.object({
  status: z.enum(["OPEN", "RESERVED", "TAKEN", "BLOCKED"]),
});

// Admins confirm a payment by amount only — NOT_PAID / PARTIAL / PAID is
// derived server-side by comparing amountPaid against the registration's
// expected fee. `note` is an optional free-text remark (e.g. a bank ref).
export const confirmPaymentSchema = z.object({
  amountPaid: z.coerce
    .number({ invalid_type_error: "Enter a valid amount." })
    .min(0, "Amount can't be negative.")
    .max(10_000_000, "That amount looks too large — double check it."),
  note: z.string().trim().max(500).optional().or(z.literal("")),
  // Approving uploaded receipts: mark them approved, and optionally email the participant.
  approveProofIds: z.array(z.string()).max(20).optional(),
  sendConfirmation: z.boolean().optional(),
  // A payment recorded in the currency it was received in. When present it is ADDED to what is on file.
  payment: z
    .object({
      currency: z.enum(["USD", "USD_NG", "CAD", "NGN"]),
      amount: z.coerce.number().positive("Enter the amount received.").max(1_000_000_000, "That amount looks too large. Double check it."),
      rate: z.coerce.number().positive("Enter a valid exchange rate.").max(1_000_000),
    })
    .optional(),
});

export const sendReplySchema = z.object({
  body: z.string().trim().min(1, "Write a reply first.").max(10000, "Reply is too long (max 10,000 characters)."),
});

export const registrationActionSchema = z.object({
  action: z.enum(["resend_confirmation", "send_seat_invite", "send_payment_reminder"]),
});

// Bulk-delete for clearing test data. The literal confirmation guards against a stray click.
export const clearDataSchema = z.object({
  target: z.enum(["registrations", "brochure_requests", "all"]),
  confirm: z.literal("DELETE", { errorMap: () => ({ message: "Type DELETE to confirm." }) }),
});

export const sendCampaignSchema = z.object({
  audience: z.enum([
    "ALL",
    "EARLY_BIRD",
    "LATE",
    "NOT_PAID",
    "PARTIAL",
    "PAID",
    "CHECKED_IN",
    "NOT_CHECKED_IN",
  ]),
  subject: z.string().trim().min(1, "Subject can't be empty.").max(300),
  body: z.string().trim().min(1, "Message can't be empty.").max(20000),
});



// ---------------------------------------------------------------------------
// Prospects
// ---------------------------------------------------------------------------

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

// Only the fields admins edit here (and that are written back to the sheet).
export const updateProspectSchema = z
  .object({
    callRequested: optionalText(100),
    callSchedule: optionalText(200),
    callCompleted: z.boolean().optional(),
    callFeedback: optionalText(5000),
    followUpRequired: z.boolean().optional(),
    confirmation: optionalText(200),
  })
  .strict();

export const convertProspectSchema = z.object({
  email: z.string().trim().email("A valid email is required.").max(320),
  phone: z.string().trim().min(5, "A valid phone number is required.").max(40),
  country: z.string().trim().min(2, "Country is required.").max(100),
  organization: z.string().trim().max(200).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  regType: z.enum(["early_bird", "late"]).default("early_bird"),
  sendConfirmation: z.boolean().default(false),
});

export const createProspectSourceSchema = z.object({
  name: z.string().trim().min(2, "Give the sheet a name.").max(100),
  spreadsheet: z.string().trim().min(5, "Paste the Google Sheet link or its id.").max(500),
  sheetTab: z.string().trim().min(1, "Enter the tab name.").max(100),
});

export const updateProspectSourceSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    sheetTab: z.string().trim().min(1).max(100).optional(),
    active: z.boolean().optional(),
    // { fieldKey: "Header in the sheet" }; an empty string clears that override.
    columnMap: z.record(z.string(), z.string().max(200)).optional(),
  })
  .strict();


// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

export const startConversationSchema = z.object({
  phone: z.string().trim().min(5, "Enter a phone number.").max(40),
  name: z.string().trim().max(200).optional(),
});

export const sendWhatsAppMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    body: z.string().trim().min(1, "Write a message first.").max(4096, "Message is too long (max 4,096 characters)."),
  }),
  z.object({
    type: z.literal("template"),
    templateName: z.string().trim().min(1).max(512),
    language: z.string().trim().min(2).max(20),
    params: z.array(z.string().max(1024)).max(20).default([]),
  }),
]);

export const WHATSAPP_AUDIENCES = [
  "ALL",
  "EARLY_BIRD",
  "LATE",
  "NOT_PAID",
  "PARTIAL",
  "PAID",
  "CHECKED_IN",
  "NOT_CHECKED_IN",
  "PROSPECTS_ALL",
  "PROSPECTS_NOT_REGISTERED",
  "PROSPECTS_FOLLOW_UP",
] as const;

export const sendWhatsAppBroadcastSchema = z.object({
  audience: z.enum(WHATSAPP_AUDIENCES),
  templateName: z.string().trim().min(1, "Pick a template.").max(512),
  language: z.string().trim().min(2).max(20),
  params: z.array(z.string().max(1024)).max(20).default([]),
});
