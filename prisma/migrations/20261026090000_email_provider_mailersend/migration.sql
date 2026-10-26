-- A new enum value cannot be used in the transaction that adds it, so it has its own migration.
ALTER TYPE "EmailProvider" ADD VALUE IF NOT EXISTS 'MAILERSEND';
