-- A third role: super admin (everything an owner can do, without the technical details).
ALTER TYPE "AdminRole" ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
