-- A draft event is visible to owners only. (Kept in its own migration: a new enum value cannot be used in the transaction that adds it.)
ALTER TYPE "EventStatus" ADD VALUE IF NOT EXISTS 'DRAFT' BEFORE 'ACTIVE';
