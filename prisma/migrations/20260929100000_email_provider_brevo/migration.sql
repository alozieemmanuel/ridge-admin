-- Campaign email moves from Resend to Brevo. RESEND stays in the enum so
-- historical EmailEvent rows remain valid; new rows use BREVO.
ALTER TYPE "EmailProvider" ADD VALUE IF NOT EXISTS 'BREVO';
