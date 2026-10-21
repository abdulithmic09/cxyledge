import type { PaymentStatus, YardInfo } from "@/lib/inventory/api";
import { rupeesInWords } from "@/lib/inventory/words";

/** Everything printed on one bill. */
export type BillData = {
  yard: YardInfo;
  kind: "sale" | "purchase";
  billNo: string;
  date: string; // YYYY-MM-DD
  company: string;
  companyPhone?: string;
  cylinderType: string;
  serials: string[];
  quantity: number;
  price: number | null;
  total: number | null;
  payment: PaymentStatus;
  paid: number | null;
  note: string;
};

export function billTotals(bill: BillData) {
  const subtotal = bill.price != null ? Math.round(bill.quantity * bill.price * 100) / 100 : (bill.total ?? 0);
  const total = bill.total ?? subtotal;
  const adjustment = Math.round((total - subtotal) * 100) / 100;
  const paid = bill.paid ?? (bill.payment === "received" ? total : 0);
  const due = Math.max(0, Math.round((total - paid) * 100) / 100);
  return { subtotal, total, adjustment, paid, due };
}

export function dmy(iso: string) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
}

export function rs(value: number) {
  return `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const STATUS_WORD: Record<PaymentStatus, string> = { received: "Paid", partial: "Part paid", unpaid: "Unpaid" };

// ---------------------------------------------------------------------------
// A tiny PDF writer: A4, Helvetica + Helvetica-Bold, filled shapes, lines, one JPEG image.
// ---------------------------------------------------------------------------

const W = 595.28;
const H = 841.89;
type RGB = [number, number, number];
const INK: RGB = [0.11, 0.098, 0.082];
const RUST: RGB = [0.56, 0.24, 0.086];
const MUTED: RGB = [0.37, 0.34, 0.3];
const LINE: RGB = [0.86, 0.83, 0.78];
const SAND: RGB = [0.953, 0.937, 0.902];
const WHITE: RGB = [1, 1, 1];

const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99,
};

function pdfText(text: string): string {
  let out = "";
  for (const ch of text.replace(/₹\s?/g, "Rs. ").replace(/→/g, "->")) {
    let code = ch.charCodeAt(0);
    if (WIN_ANSI[ch]) code = WIN_ANSI[ch]!;
    else if (code > 255) code = 63; // "?"
    if (ch === "(" || ch === ")" || ch === "\\") out += `\\${ch}`;
    else if (code < 32 || code > 126) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return out;
}

let measureCtx: CanvasRenderingContext2D | null = null;
function textWidth(text: string, size: number, bold: boolean) {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * size * 0.5;
  measureCtx.font = `${bold ? "bold " : ""}${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text.replace(/₹\s?/g, "Rs. ")).width;
}

class Page {
  ops: string[] = [];
  color(c: RGB, stroke = false) {
    this.ops.push(`${c.map((v) => v.toFixed(3)).join(" ")} ${stroke ? "RG" : "rg"}`);
  }
  rect(x: number, top: number, w: number, h: number, fill: RGB) {
    this.color(fill);
    this.ops.push(`${x.toFixed(2)} ${(H - top - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }
  line(x1: number, y1: number, x2: number, y2: number, c: RGB = LINE, width = 0.6) {
    this.color(c, true);
    this.ops.push(`${width} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S`);
  }
  /** `top` is the text baseline measured from the top of the page. */
  text(str: string, x: number, top: number, size: number, opts: { bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; spacing?: number } = {}) {
    if (!str) return;
    const bold = Boolean(opts.bold);
    const width = textWidth(str, size, bold) + (opts.spacing ?? 0) * Math.max(0, str.length - 1);
    const left = opts.align === "right" ? x - width : opts.align === "center" ? x - width / 2 : x;
    this.color(opts.color ?? INK);
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${opts.spacing ? `${opts.spacing} Tc ` : ""}${left.toFixed(2)} ${(H - top).toFixed(2)} Td (${pdfText(str)}) Tj${opts.spacing ? " 0 Tc" : ""} ET`);
  }
  image(x: number, top: number, w: number, h: number) {
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - top - h).toFixed(2)} cm /Im1 Do Q`);
  }
}

function wrap(text: string, size: number, maxWidth: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next, size, bold) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

/** Logo (any image data URL) as JPEG bytes on white, so it can be embedded directly. */
async function logoJpeg(dataUrl: string): Promise<{ bytes: Uint8Array; w: number; h: number } | null> {
  if (!dataUrl.startsWith("data:image/")) return null;
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const b64 = canvas.toDataURL("image/jpeg", 0.9).split(",")[1] ?? "";
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return { bytes, w, h };
  } catch {
    return null;
  }
}

function assemble(content: string, logo: { bytes: Uint8Array; w: number; h: number } | null): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (chunk: string | Uint8Array) => {
    const bytes = typeof chunk === "string" ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    size += bytes.length;
  };
  const obj = (id: number, body: string | Array<string | Uint8Array>) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    for (const piece of Array.isArray(body) ? body : [body]) push(piece);
    push("\nendobj\n");
  };
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const resources = `<< /Font << /F1 3 0 R /F2 4 0 R >>${logo ? " /XObject << /Im1 6 0 R >>" : ""} >>`;
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, "<< /Type /Pages /Kids [5 0 R] /Count 1 >>");
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  obj(5, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources ${resources} /Contents 7 0 R >>`);
  if (logo) {
    obj(6, [`<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`, logo.bytes, "\nendstream"]);
  } else {
    obj(6, "<< >>");
  }
  obj(7, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
  const xref = size;
  push(`xref\n0 8\n0000000000 65535 f \n`);
  for (let id = 1; id <= 7; id += 1) push(`${String(offsets[id]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** A designed, single-page A4 bill on the book's letterhead. */
export async function makeBillPdf(bill: BillData): Promise<Blob> {
  const { yard } = bill;
  const t = billTotals(bill);
  const sale = bill.kind === "sale";
  const p = new Page();
  const M = 40;
  const R = W - M;

  // Header band
  p.rect(0, 0, W, 78, INK);
  p.rect(0, 78, W, 4, RUST);
  p.text(sale ? "BILL" : "PURCHASE BILL", M, 48, 26, { bold: true, color: WHITE, spacing: 1.5 });
  p.text(yard.name, M, 64, 9.5, { color: [0.8, 0.77, 0.72] });
  p.text("Bill no.", R - 150, 36, 8, { color: [0.75, 0.72, 0.67] });
  p.text(bill.billNo || "-", R, 36, 11, { bold: true, color: WHITE, align: "right" });
  p.text("Date", R - 150, 56, 8, { color: [0.75, 0.72, 0.67] });
  p.text(dmy(bill.date), R, 56, 11, { bold: true, color: WHITE, align: "right" });

  // From (letterhead) and Bill to
  let y = 112;
  const logo = await logoJpeg(yard.logo);
  if (logo) {
    const lh = 46;
    const lw = Math.min(150, (logo.w / logo.h) * lh);
    p.image(M, y - 10, lw, lh);
    y += lh + 6;
  }
  p.text("FROM", M, y, 7.5, { bold: true, color: RUST, spacing: 1.2 });
  y += 16;
  p.text(yard.name, M, y, 13, { bold: true });
  y += 15;
  for (const line of wrap(yard.address || "", 9.5, 240)) {
    if (!line) continue;
    p.text(line, M, y, 9.5, { color: MUTED });
    y += 12.5;
  }
  const ids = [yard.phone && `Phone ${yard.phone}`, yard.gst && `GSTIN ${yard.gst}`, yard.pan && `PAN ${yard.pan}`].filter(Boolean) as string[];
  for (const line of ids) {
    p.text(line, M, y, 9.5, { color: MUTED });
    y += 12.5;
  }

  const BX = 330;
  let by = logo ? 158 : 112;
  p.rect(BX - 14, by - 22, R - BX + 14, 92, SAND);
  p.text(sale ? "BILL TO" : "SUPPLIER", BX, by - 4, 7.5, { bold: true, color: RUST, spacing: 1.2 });
  by += 13;
  for (const line of wrap(bill.company || "Company", 12, R - BX - 10, true).slice(0, 2)) {
    p.text(line, BX, by, 12, { bold: true });
    by += 14;
  }
  if (bill.companyPhone) {
    p.text(`Phone ${bill.companyPhone}`, BX, by, 9.5, { color: MUTED });
    by += 13;
  }
  p.text(`Payment: ${STATUS_WORD[bill.payment]}`, BX, (logo ? 158 : 112) + 58, 9.5, { bold: true, color: bill.payment === "received" ? [0.12, 0.31, 0.23] : RUST });

  // Items table
  y = Math.max(y, (logo ? 158 : 112) + 70) + 22;
  const cols = { no: M + 10, desc: M + 34, qty: 360, rate: 455, amt: R - 10 };
  p.rect(M, y, R - M, 24, INK);
  const hy = y + 15.5;
  p.text("#", cols.no, hy, 8.5, { bold: true, color: WHITE });
  p.text("DESCRIPTION", cols.desc, hy, 8.5, { bold: true, color: WHITE, spacing: 0.6 });
  p.text("QTY", cols.qty, hy, 8.5, { bold: true, color: WHITE, align: "right", spacing: 0.6 });
  p.text("RATE", cols.rate, hy, 8.5, { bold: true, color: WHITE, align: "right", spacing: 0.6 });
  p.text("AMOUNT", cols.amt, hy, 8.5, { bold: true, color: WHITE, align: "right", spacing: 0.6 });
  y += 24;

  const descWidth = cols.qty - 50 - cols.desc;
  const serialLines = bill.serials.length ? wrap(`Serial nos.: ${bill.serials.join(", ")}`, 8.5, descWidth) : [];
  const shownSerials = serialLines.slice(0, 14);
  if (serialLines.length > shownSerials.length) shownSerials[shownSerials.length - 1] += " …";
  const rowH = 30 + shownSerials.length * 11;
  p.text("1", cols.no, y + 19, 10);
  p.text(bill.cylinderType || "Gas cylinders", cols.desc, y + 19, 10.5, { bold: true });
  let sy = y + 32;
  for (const line of shownSerials) {
    p.text(line, cols.desc, sy, 8.5, { color: MUTED });
    sy += 11;
  }
  p.text(String(bill.quantity), cols.qty, y + 19, 10, { align: "right" });
  p.text(bill.price != null ? rs(bill.price) : "-", cols.rate, y + 19, 10, { align: "right" });
  p.text(rs(t.subtotal), cols.amt, y + 19, 10, { bold: true, align: "right" });
  y += rowH;
  p.line(M, y, R, y, LINE, 0.8);

  // Totals (right) and words / notes (left)
  y += 20;
  const TL = 345;
  let ty = y;
  const row = (label: string, value: string, bold = false) => {
    p.text(label, TL, ty, 9.5, { color: bold ? INK : MUTED, bold });
    p.text(value, R - 10, ty, 9.5, { align: "right", bold });
    ty += 17;
  };
  row("Subtotal", rs(t.subtotal));
  if (t.adjustment) row(t.adjustment < 0 ? "Discount / round-off" : "Adjustment / round-off", `${t.adjustment < 0 ? "- " : ""}${rs(Math.abs(t.adjustment))}`);
  p.line(TL, ty - 9, R, ty - 9, LINE);
  ty += 3;
  row("Total", rs(t.total), true);
  row(sale ? "Received" : "Paid", rs(t.paid));
  ty += 2;
  p.rect(TL - 12, ty - 4, R - TL + 12, 30, INK);
  p.text("BALANCE DUE", TL, ty + 15, 9, { bold: true, color: WHITE, spacing: 1 });
  p.text(rs(t.due), R - 10, ty + 15.5, 12.5, { bold: true, color: WHITE, align: "right" });
  ty += 30;

  let ly = y;
  p.text("AMOUNT IN WORDS", M, ly, 7.5, { bold: true, color: RUST, spacing: 1.2 });
  ly += 15;
  for (const line of wrap(rupeesInWords(t.total), 10, TL - M - 40, true)) {
    p.text(line, M, ly, 10, { bold: true });
    ly += 13;
  }
  if (bill.note.trim()) {
    ly += 12;
    p.text("NOTES", M, ly, 7.5, { bold: true, color: RUST, spacing: 1.2 });
    ly += 15;
    for (const line of wrap(bill.note.trim(), 9.5, TL - M - 40).slice(0, 6)) {
      p.text(line, M, ly, 9.5, { color: MUTED });
      ly += 12.5;
    }
  }

  // Signatures
  const sigY = Math.max(ty, ly) + 70 > H - 120 ? Math.max(ty, ly) + 50 : H - 150;
  p.line(M, sigY, M + 190, sigY, INK, 0.7);
  p.text(sale ? "Receiver's signature" : "Supplier's signature", M, sigY + 14, 9, { color: MUTED });
  p.text(bill.company || "", M, sigY + 27, 9.5, { bold: true });
  p.line(R - 190, sigY, R, sigY, INK, 0.7);
  p.text("Authorised signatory", R, sigY + 14, 9, { color: MUTED, align: "right" });
  p.text(`For ${yard.name}`, R, sigY + 27, 9.5, { bold: true, align: "right" });

  // Footer
  p.line(M, H - 48, R, H - 48, LINE);
  p.text("Thank you for your business.", M, H - 32, 8.5, { color: MUTED });
  p.text(`${bill.billNo || ""}  ·  ${dmy(bill.date)}  ·  Made with Cxyledge`, R, H - 32, 8, { color: MUTED, align: "right" });

  return assemble(p.ops.join("\n"), logo);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the bill."));
    reader.readAsDataURL(blob);
  });
}
