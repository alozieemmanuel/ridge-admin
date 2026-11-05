import type { Prisma } from "@prisma/client";
import { isFollowUpStatus } from "@/lib/followUp";

/**
 * Filters shared by the contact list and the CSV export, so a download always matches what the list shows.
 * Query values: search (name, email, phone), followUp (one status, or "CONTACTED" for anyone already called),
 * seat ("RESERVED" | "NOT_RESERVED" | "INVITED" | "AWAITING" | "NOT_INVITED").
 */
const INVITED: Prisma.RegistrationWhereInput = { OR: [{ inviteSentAt: { not: null } }, { reservedAt: { not: null } }] };

export const SEAT_FILTER_LABELS: Record<string, string> = {
  RESERVED: "reserved",
  NOT_RESERVED: "not-reserved",
  INVITED: "invited",
  AWAITING: "awaiting-reply",
  NOT_INVITED: "not-invited",
};

export function seatFilter(seat: string | null): Prisma.RegistrationWhereInput {
  switch (seat) {
    case "RESERVED":
      return { reservedAt: { not: null } };
    case "NOT_RESERVED":
      return { reservedAt: null };
    case "INVITED": // an invitation went out (including those who already reserved)
      return INVITED;
    case "AWAITING": // invited, no reply yet
      return { inviteSentAt: { not: null }, reservedAt: null };
    case "NOT_INVITED":
      return { inviteSentAt: null, reservedAt: null };
    default:
      return {};
  }
}

export function registrationWhere(eventId: string, params: { search?: string | null; followUp?: string | null; seat?: string | null }): Prisma.RegistrationWhereInput {
  const search = params.search?.trim() || "";
  const followUp = params.followUp ?? null;
  return {
    AND: [
      { eventId },
      search
        ? {
            OR: [
              { fullName: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } },
              { phone: { contains: search } },
            ],
          }
        : {},
      isFollowUpStatus(followUp) ? { followUpStatus: followUp } : followUp === "CONTACTED" ? { followUpStatus: { not: "NOT_CONTACTED" } } : {},
      seatFilter(params.seat ?? null),
    ],
  };
}
