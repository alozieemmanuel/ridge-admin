import { z } from "zod";

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

export const updateTemplateSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20000),
  replyTo: z.string().trim().email().optional().or(z.literal("")),
});

export const updateSettingsSchema = z.record(z.string(), z.string().max(2000));

export const updateSeatStatusSchema = z.object({
  status: z.enum(["OPEN", "RESERVED", "TAKEN", "BLOCKED"]),
});

export const updateRegistrationSchema = z.object({
  paymentStatus: z.enum(["NOT_PAID", "PARTIAL", "PAID"]).optional(),
  paymentNote: z.string().max(500).optional().or(z.literal("")),
});

export const registrationActionSchema = z.object({
  action: z.enum(["resend_confirmation", "send_seat_invite", "send_payment_reminder"]),
});
