export const SEATS_PER_TABLE = 10;
export const TABLE_COUNT = 30; // 30 x 10 = 300 capacity
export const TABLES_PER_ROW = 6;

/** 0 -> "A", 25 -> "Z", 26 -> "AA", 29 -> "AD" (spreadsheet-column style). */
export function tableLabel(index: number): string {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    n--;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

export function seatLabel(tableIndex: number, seatNumber: number): string {
  return `${tableLabel(tableIndex)}${seatNumber}`;
}

export type SeatStatus = "OPEN" | "RESERVED" | "TAKEN" | "BLOCKED";

// Deliberately high-contrast and semantically conventional (green = free to
// pick, amber = held, red = gone, gray = disabled) rather than brand-matched
// gold tones — status needs to be readable at a glance across 300 seats.
export const SEAT_STATUS_META: Record<SeatStatus, { label: string; fill: string; stroke: string }> = {
  OPEN: { label: "Open", fill: "#0F2E1E", stroke: "#34D399" },
  RESERVED: { label: "Reserved", fill: "#3A2E0A", stroke: "#F5B93D" },
  TAKEN: { label: "Taken", fill: "#3A0F12", stroke: "#EF4444" },
  BLOCKED: { label: "Blocked", fill: "#242424", stroke: "#9CA3AF" },
};
