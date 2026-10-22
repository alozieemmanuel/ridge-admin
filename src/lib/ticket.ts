import crypto from "node:crypto";
import QRCode from "qrcode";
import { appBaseUrl } from "@/lib/email";

// No 0/O or 1/I/L, so a code read out loud or typed from a printout is hard to get wrong.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** "IH-7K3F9Q": printed on the ticket and encoded in its QR code. */
export function generateTicketCode(): string {
  let out = "";
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `IH-${out}`;
}

/** What the QR code holds: a link that opens the Attendance page already looking at this ticket. */
export function ticketVerifyUrl(ticketCode: string): string {
  return `${appBaseUrl()}/admin/attendance?code=${encodeURIComponent(ticketCode)}`;
}

const QR_OPTIONS = {
  errorCorrectionLevel: "M" as const,
  margin: 1,
  color: { dark: "#141C08", light: "#FFFFFF" },
};

/** The QR as an SVG string, for the reserve page. */
export async function ticketQrSvg(ticketCode: string): Promise<string> {
  return QRCode.toString(ticketVerifyUrl(ticketCode), { ...QR_OPTIONS, type: "svg", width: 220 });
}

/** The QR as a PNG, attached to the ticket email (mail apps show an attached image reliably; they don't show SVG). */
export async function ticketQrPng(ticketCode: string): Promise<Buffer> {
  return QRCode.toBuffer(ticketVerifyUrl(ticketCode), { ...QR_OPTIONS, type: "png", width: 440 });
}
