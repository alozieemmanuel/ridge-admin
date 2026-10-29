/**
 * Draws the guest's ticket on a canvas and saves it as a PNG or a PDF, all in the browser.
 * It is drawn by hand (not copied from the page), so the file looks the same on every phone and in dark mode.
 */
export interface TicketData {
  eventName: string;
  guest: string;
  date: string;
  time: string;
  venue: string;
  code: string;
  qrSvg: string;
  color?: string | null;
}

const W = 1500;
const H = 1200;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

function parseHex(hex: string | null | undefined): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return [163, 230, 53];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    kept[maxLines - 1] = kept[maxLines - 1].replace(/\s*\S*$/, "") + "…";
    return kept;
  }
  return lines;
}

function loadQr(svg: string): Promise<HTMLImageElement> {
  const sized = svg.replace(/<svg([^>]*)>/, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="640" height="640">`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml;charset=utf-8" }));
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The QR code could not be drawn."));
    };
    img.src = url;
  });
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The same layout as the ticket on the page: colour band on top, details, a tear line, then the QR code beside the ticket code. */
export async function drawTicket(t: TicketData): Promise<HTMLCanvasElement> {
  try {
    await document.fonts?.ready;
  } catch {}
  const qr = await loadQr(t.qrSvg);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  const [r, g, b] = parseHex(t.color);
  const brand = `rgb(${r},${g},${b})`;
  const tint = `rgb(${Math.round(r * 0.1 + 255 * 0.9)},${Math.round(g * 0.1 + 255 * 0.9)},${Math.round(b * 0.1 + 255 * 0.9)})`;
  const dark = 0.299 * r + 0.587 * g + 0.114 * b > 150;
  const onBrand = dark ? "#141C08" : "#FFFFFF";
  const ink = "#141414";
  const grey = "#6B6B6B";
  const R = 44;

  // White page behind the rounded ticket, so the PNG has no see-through corners.
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  roundedRect(ctx, 6, 6, W - 12, H - 12, R);
  ctx.clip();
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(0, 0, W, H);
  // Header band
  ctx.fillStyle = brand;
  ctx.fillRect(0, 0, W, 200);
  // Bottom area
  ctx.fillStyle = tint;
  ctx.fillRect(0, 720, W, H - 720);
  ctx.restore();
  ctx.strokeStyle = brand;
  ctx.lineWidth = 6;
  roundedRect(ctx, 6, 6, W - 12, H - 12, R);
  ctx.stroke();

  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = onBrand;
  ctx.font = `bold 26px ${FONT}`;
  ctx.fillText("ADMIT ONE  ·  BY INVITATION".split("").join(String.fromCharCode(8202)), 70, 80);
  ctx.font = `bold 68px ${FONT}`;
  wrap(ctx, t.eventName, W - 140, 1).forEach((line) => ctx.fillText(line, 70, 160));

  const label = (text: string, x: number, y: number) => {
    ctx.fillStyle = grey;
    ctx.font = `600 22px ${FONT}`;
    ctx.fillText(text.toUpperCase().split("").join(String.fromCharCode(8202)), x, y);
  };
  const value = (text: string, x: number, y: number, size: number, width: number) => {
    ctx.fillStyle = ink;
    ctx.font = `600 ${size}px ${FONT}`;
    wrap(ctx, text || "To be announced", width, 1).forEach((line) => ctx.fillText(line, x, y));
  };

  label("Guest", 70, 275);
  value(t.guest, 70, 335, 54, W - 140);
  label("Date", 70, 425);
  value(t.date, 70, 480, 42, 700);
  label("Time", 860, 425);
  value(t.time, 860, 480, 42, 570);
  label("Venue", 70, 570);
  value(t.venue, 70, 625, 42, W - 140);

  // Tear line
  ctx.strokeStyle = brand;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = 4;
  ctx.setLineDash([16, 12]);
  ctx.beginPath();
  ctx.moveTo(30, 720);
  ctx.lineTo(W - 30, 720);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // QR in a white rounded box on the left
  const box = 380;
  const bx = 70;
  const by = 760;
  ctx.fillStyle = "#FFFFFF";
  roundedRect(ctx, bx, by, box, box, 28);
  ctx.fill();
  ctx.drawImage(qr, bx + 24, by + 24, box - 48, box - 48);

  const tx = bx + box + 70;
  label("Ticket code", tx, 880);
  ctx.fillStyle = ink;
  ctx.font = `bold 84px "Courier New", ui-monospace, monospace`;
  ctx.fillText(t.code, tx, 975);
  ctx.fillStyle = grey;
  ctx.font = `30px ${FONT}`;
  wrap(ctx, "Show this at the entrance. Take a screenshot so you have it even without a signal.", W - tx - 70, 3).forEach((line, i) => ctx.fillText(line, tx, 1045 + i * 42));
  return canvas;
}

function fileName(t: TicketData, ext: string) {
  const base = (t.eventName + " ticket " + t.code).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base}.${ext}`;
}

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export async function downloadTicketPng(t: TicketData): Promise<void> {
  const canvas = await drawTicket(t);
  const blob: Blob | null = await new Promise((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("The ticket image could not be made.");
  save(blob, fileName(t, "png"));
}

/** A one-page PDF with the ticket as a picture (a JPEG inside a hand-written PDF, so no extra library is needed). */
export async function downloadTicketPdf(t: TicketData): Promise<void> {
  const canvas = await drawTicket(t);
  const jpeg = canvas.toDataURL("image/jpeg", 0.95).split(",")[1];
  const bin = atob(jpeg);
  const img = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) img[i] = bin.charCodeAt(i);

  const pw = 560;
  const ph = Math.round((560 * H) / W);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  push("%PDF-1.4\n");
  const obj = (n: number, body: string | (() => void)) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    if (typeof body === "string") push(body);
    else body();
    push("\nendobj\n");
  };
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${W} /Height ${H} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.length} >>\nstream\n`);
    push(img);
    push("\nendstream");
  });
  const content = `q ${pw} 0 0 ${ph} 0 0 cm /Im0 Do Q`;
  obj(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n`);
  for (let n = 1; n <= 5; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  const out = new Uint8Array(length);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  save(new Blob([out], { type: "application/pdf" }), fileName(t, "pdf"));
}
