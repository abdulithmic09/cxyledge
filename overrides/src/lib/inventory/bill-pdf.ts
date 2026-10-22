import type { PaymentStatus, YardInfo } from "@/lib/inventory/api";
import { rupeesInWords } from "@/lib/inventory/words";

/** One line on a bill: a gas type with its serials. */
export type BillLine = {
  cylinderType: string;
  serials: string[];
  quantity: number;
  price: number | null;
};

/** Everything printed on one bill (or on the credit note that cancels it). */
export type BillData = {
  yard: YardInfo;
  kind: "sale" | "purchase";
  billNo: string;
  date: string; // YYYY-MM-DD
  company: string;
  companyPhone?: string;
  lines: BillLine[];
  /** Final amount; null means "the subtotal". */
  total: number | null;
  payment: PaymentStatus;
  paid: number | null;
  note: string;
  /** Present when this document is a credit note cancelling `billNo`. */
  credit?: { no: string; date: string; reason: string };
  /** Heading instead of BILL, e.g. "HOLDING CHARGES". */
  title?: string;
  /** What the quantity counts (default "cylinder"), e.g. "cylinder-day". */
  unit?: string;
};

export type ReceiptData = {
  yard: YardInfo;
  direction: "in" | "out";
  receiptNo: string;
  date: string;
  company: string;
  amount: number;
  mode: string;
  reference: string;
  billNo: string;
  note: string;
  balanceAfter: number | null;
  /** Heading instead of RECEIPT, e.g. "DEPOSIT RECEIPT". */
  title?: string;
};

export function lineAmount(line: BillLine) {
  return line.price != null ? Math.round(line.quantity * line.price * 100) / 100 : 0;
}

export function billTotals(bill: BillData) {
  const priced = bill.lines.some((line) => line.price != null);
  const subtotal = priced ? Math.round(bill.lines.reduce((sum, line) => sum + lineAmount(line), 0) * 100) / 100 : (bill.total ?? 0);
  const total = bill.total ?? subtotal;
  const adjustment = Math.round((total - subtotal) * 100) / 100;
  const paid = bill.paid ?? (bill.payment === "received" ? total : 0);
  const due = Math.max(0, Math.round((total - paid) * 100) / 100);
  const quantity = bill.lines.reduce((sum, line) => sum + line.quantity, 0);
  return { subtotal, total, adjustment, paid, due, quantity };
}

export function dmy(iso: string) {
  return iso ? iso.slice(0, 10).split("-").reverse().join("/") : "";
}

export function rs(value: number) {
  return `Rs. ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const STATUS_WORD: Record<PaymentStatus, string> = { received: "Paid", partial: "Part paid", unpaid: "Unpaid" };

// ---------------------------------------------------------------------------
// A tiny PDF writer: A4 pages, Helvetica + Helvetica-Bold, filled shapes, lines, one JPEG image.
// ---------------------------------------------------------------------------

const W = 595.28;
const H = 841.89;
const M = 40;
const R = W - M;
type RGB = [number, number, number];
const INK: RGB = [0.11, 0.098, 0.082];
const RUST: RGB = [0.56, 0.24, 0.086];
const PINE: RGB = [0.12, 0.31, 0.23];
const MUTED: RGB = [0.37, 0.34, 0.3];
const LINE: RGB = [0.86, 0.83, 0.78];
const SAND: RGB = [0.953, 0.937, 0.902];
const WHITE: RGB = [1, 1, 1];
const DIM: RGB = [0.75, 0.72, 0.67];

const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "„": 0x84, "…": 0x85, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "™": 0x99,
};

function pdfText(text: string): string {
  let out = "";
  for (const ch of text.replace(/₹\s?/g, "Rs. ").replace(/→/g, "->").replace(/▸/g, ">")) {
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

type TextOpts = { bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; spacing?: number };

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
  text(str: string, x: number, top: number, size: number, opts: TextOpts = {}) {
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

type Logo = { bytes: Uint8Array; w: number; h: number };

/** Logo (any image data URL) as JPEG bytes on white, so it can be embedded directly. */
async function logoJpeg(dataUrl: string): Promise<Logo | null> {
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

/** Objects: 1 catalog, 2 pages, 3/4 fonts, 5 image (or empty), then content+page pairs. */
function assemble(pages: Page[], logo: Logo | null): Blob {
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
  const pageIds = pages.map((_, index) => 7 + index * 2);
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const resources = `<< /Font << /F1 3 0 R /F2 4 0 R >>${logo ? " /XObject << /Im1 5 0 R >>" : ""} >>`;
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  if (logo) {
    obj(5, [`<< /Type /XObject /Subtype /Image /Width ${logo.w} /Height ${logo.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`, logo.bytes, "\nendstream"]);
  } else {
    obj(5, "<< >>");
  }
  pages.forEach((page, index) => {
    const content = page.ops.join("\n");
    const contentId = 6 + index * 2;
    obj(contentId, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
    obj(pageIds[index]!, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
  });
  const count = 6 + pages.length * 2;
  const xref = size;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= count; id += 1) push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

/** Dark header band with the document title, plus number and date on the right. */
function header(p: Page, title: string, sub: string, fields: Array<[string, string]>, accent: RGB = RUST) {
  p.rect(0, 0, W, 78, INK);
  p.rect(0, 78, W, 4, accent);
  p.text(title, M, 48, title.length > 10 ? 22 : 26, { bold: true, color: WHITE, spacing: 1.5 });
  p.text(sub, M, 64, 9.5, { color: [0.8, 0.77, 0.72] });
  fields.slice(0, 3).forEach(([label, value], index) => {
    const y = fields.length > 2 ? 28 + index * 18 : 36 + index * 20;
    p.text(label, R - 160, y, 8, { color: DIM });
    p.text(value, R, y, 10.5, { bold: true, color: WHITE, align: "right" });
  });
}

/** Letterhead block on the left; returns the y below it and whether a logo was drawn. */
function letterhead(p: Page, yard: YardInfo, logo: Logo | null): number {
  let y = 112;
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
  return y;
}

/** Sand box on the right with the other party. */
function partyBox(p: Page, top: number, label: string, name: string, extra: Array<{ text: string; bold?: boolean; color?: RGB }>) {
  const BX = 330;
  p.rect(BX - 14, top - 22, R - BX + 14, 92, SAND);
  p.text(label, BX, top - 4, 7.5, { bold: true, color: RUST, spacing: 1.2 });
  let by = top + 13;
  for (const line of wrap(name || "Company", 12, R - BX - 10, true).slice(0, 2)) {
    p.text(line, BX, by, 12, { bold: true });
    by += 14;
  }
  for (const item of extra) {
    p.text(item.text, BX, by, 9.5, { color: item.color ?? MUTED, bold: item.bold });
    by += 13;
  }
}

function signatures(p: Page, top: number, leftLabel: string, leftName: string, yardName: string) {
  p.line(M, top, M + 190, top, INK, 0.7);
  p.text(leftLabel, M, top + 14, 9, { color: MUTED });
  p.text(leftName, M, top + 27, 9.5, { bold: true });
  p.line(R - 190, top, R, top, INK, 0.7);
  p.text("Authorised signatory", R, top + 14, 9, { color: MUTED, align: "right" });
  p.text(`For ${yardName}`, R, top + 27, 9.5, { bold: true, align: "right" });
}

function footer(p: Page, left: string, right: string) {
  p.line(M, H - 48, R, H - 48, LINE);
  p.text(left, M, H - 32, 8.5, { color: MUTED });
  p.text(right, R, H - 32, 8, { color: MUTED, align: "right" });
}

/** A designed A4 bill (or credit note) on the book's letterhead. Long bills continue on more pages. */
export async function makeBillPdf(bill: BillData): Promise<Blob> {
  const { yard } = bill;
  const t = billTotals(bill);
  const sale = bill.kind === "sale";
  const credit = bill.credit;
  const logo = await logoJpeg(yard.logo);
  const pages: Page[] = [];
  let p = new Page();
  pages.push(p);

  const title = credit ? "CREDIT NOTE" : (bill.title ?? (sale ? "BILL" : "PURCHASE BILL"));
  const fields: Array<[string, string]> = credit
    ? [["Credit note", credit.no], ["Date", dmy(credit.date)], ["Against bill", bill.billNo || "-"]]
    : [["Bill no.", bill.billNo || "-"], ["Date", dmy(bill.date)]];
  header(p, title, yard.name, fields, credit ? PINE : RUST);

  const y0 = letterhead(p, yard, logo);
  const boxTop = logo ? 158 : 112;
  const extra: Array<{ text: string; bold?: boolean; color?: RGB }> = [];
  if (bill.companyPhone) extra.push({ text: `Phone ${bill.companyPhone}` });
  if (credit) extra.push({ text: `Bill dated ${dmy(bill.date)}`, bold: true, color: PINE });
  else extra.push({ text: `Payment: ${STATUS_WORD[bill.payment]}`, bold: true, color: bill.payment === "received" ? PINE : RUST });
  partyBox(p, boxTop, credit ? "ISSUED TO" : sale ? "BILL TO" : "SUPPLIER", bill.company, extra);

  // Items table
  let y = Math.max(y0, boxTop + 70) + 22;
  const cols = { no: M + 10, desc: M + 34, qty: 360, rate: 455, amt: R - 10 };
  const tableHead = () => {
    p.rect(M, y, R - M, 24, INK);
    const hy = y + 15.5;
    p.text("#", cols.no, hy, 8.5, { bold: true, color: WHITE });
    p.text("DESCRIPTION", cols.desc, hy, 8.5, { bold: true, color: WHITE, spacing: 0.6 });
    p.text("QTY", cols.qty, hy, 8.5, { bold: true, color: WHITE, align: "right", spacing: 0.6 });
    p.text("RATE", cols.rate, hy, 8.5, { bold: true, color: WHITE, align: "right", spacing: 0.6 });
    p.text("AMOUNT", cols.amt, hy, 8.5, { bold: true, color: WHITE, align: "right", spacing: 0.6 });
    y += 24;
  };
  const newPage = () => {
    footer(p, "Continued on the next page", `${credit ? credit.no : bill.billNo}  ·  page ${pages.length}`);
    p = new Page();
    pages.push(p);
    p.rect(0, 0, W, 6, INK);
    p.text(`${title} ${credit ? credit.no : bill.billNo} (continued)`, M, 34, 10, { bold: true });
    p.text(bill.company, R, 34, 10, { align: "right", color: MUTED });
    y = 52;
    tableHead();
  };
  tableHead();

  const descWidth = cols.qty - 50 - cols.desc;
  const lines = bill.lines.length ? bill.lines : [{ cylinderType: "", serials: [], quantity: 0, price: null }];
  lines.forEach((line, index) => {
    const serialLines = line.serials.length ? wrap(`Serial nos.: ${line.serials.join(", ")}`, 8.5, descWidth) : [];
    const shown = serialLines.slice(0, 10);
    if (serialLines.length > shown.length) shown[shown.length - 1] += " …";
    const rowH = 30 + shown.length * 11;
    if (y + rowH > H - 90) newPage();
    if (index % 2 === 1) p.rect(M, y, R - M, rowH, [0.985, 0.978, 0.965]);
    p.text(String(index + 1), cols.no, y + 19, 10);
    p.text(line.cylinderType || "Gas cylinders", cols.desc, y + 19, 10.5, { bold: true });
    let sy = y + 32;
    for (const text of shown) {
      p.text(text, cols.desc, sy, 8.5, { color: MUTED });
      sy += 11;
    }
    p.text(String(line.quantity), cols.qty, y + 19, 10, { align: "right" });
    p.text(line.price != null ? rs(line.price) : "-", cols.rate, y + 19, 10, { align: "right" });
    p.text(line.price != null ? rs(lineAmount(line)) : "-", cols.amt, y + 19, 10, { bold: true, align: "right" });
    y += rowH;
    p.line(M, y, R, y, LINE, 0.6);
  });
  p.text(`${t.quantity} ${bill.unit ?? "cylinder"}${t.quantity === 1 ? "" : "s"} in all`, cols.desc, y + 14, 8.5, { color: MUTED });

  // Totals (right) and words / notes (left) — keep them together on one page.
  const notes = [credit ? `Reason: ${credit.reason || "Bill cancelled"}` : "", bill.note.trim()].filter(Boolean).join("\n");
  const noteLines = notes ? wrap(notes, 9.5, 345 - M - 40).slice(0, 6) : [];
  const blockH = 140 + noteLines.length * 12.5;
  if (y + 24 + blockH > H - 150) newPage();
  y += 30;
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
  row(credit ? "Bill total" : "Total", rs(t.total), true);
  if (!credit) row(sale ? "Received" : "Paid", rs(t.paid));
  ty += 2;
  p.rect(TL - 12, ty - 4, R - TL + 12, 30, credit ? PINE : INK);
  p.text(credit ? "AMOUNT CREDITED" : "BALANCE DUE", TL, ty + 15, 9, { bold: true, color: WHITE, spacing: 1 });
  p.text(rs(credit ? t.total : t.due), R - 10, ty + 15.5, 12.5, { bold: true, color: WHITE, align: "right" });
  ty += 30;

  let ly = y;
  p.text("AMOUNT IN WORDS", M, ly, 7.5, { bold: true, color: RUST, spacing: 1.2 });
  ly += 15;
  for (const line of wrap(rupeesInWords(t.total), 10, TL - M - 40, true)) {
    p.text(line, M, ly, 10, { bold: true });
    ly += 13;
  }
  if (noteLines.length) {
    ly += 12;
    p.text(credit ? "REASON / NOTES" : "NOTES", M, ly, 7.5, { bold: true, color: RUST, spacing: 1.2 });
    ly += 15;
    for (const line of noteLines) {
      p.text(line, M, ly, 9.5, { color: MUTED });
      ly += 12.5;
    }
  }

  const sigY = Math.max(ty, ly) + 70 > H - 120 ? Math.max(ty, ly) + 50 : H - 150;
  signatures(p, sigY, credit ? "Received by" : sale ? "Receiver's signature" : "Supplier's signature", bill.company, yard.name);
  const tag = credit ? `${credit.no}  ·  ${dmy(credit.date)}` : `${bill.billNo || ""}  ·  ${dmy(bill.date)}`;
  footer(p, credit ? "This credit note cancels the bill named above." : "Thank you for your business.", `${tag}  ·  ${pages.length > 1 ? `page ${pages.length}  ·  ` : ""}Made with Cxyledge`);

  return assemble(pages, logo);
}

/** Payment receipt (money in) or voucher (money paid out) in the same design. */
export async function makeReceiptPdf(r: ReceiptData): Promise<Blob> {
  const received = r.direction === "in";
  const logo = await logoJpeg(r.yard.logo);
  const p = new Page();
  header(p, r.title ?? (received ? "RECEIPT" : "PAYMENT VOUCHER"), r.yard.name, [["Receipt no.", r.receiptNo], ["Date", dmy(r.date)]], received ? PINE : RUST);
  const y0 = letterhead(p, r.yard, logo);
  const boxTop = logo ? 158 : 112;
  partyBox(p, boxTop, received ? "RECEIVED FROM" : "PAID TO", r.company, []);

  let y = Math.max(y0, boxTop + 70) + 30;
  // Big amount band
  p.rect(M, y, R - M, 62, SAND);
  p.rect(M, y, 5, 62, received ? PINE : RUST);
  p.text(received ? "AMOUNT RECEIVED" : "AMOUNT PAID", M + 20, y + 22, 8, { bold: true, color: RUST, spacing: 1.2 });
  p.text(rs(r.amount), M + 20, y + 47, 22, { bold: true });
  const words = wrap(rupeesInWords(r.amount), 10, 250, true);
  words.slice(0, 3).forEach((line, index) => p.text(line, R - 14, y + 24 + index * 13, 10, { bold: index === 0, align: "right", color: index ? MUTED : INK }));
  y += 92;

  const rows: Array<[string, string]> = [
    ["Mode", r.mode],
    ["Reference", r.reference || "-"],
    ["Against bill", r.billNo || "-"],
  ];
  if (r.note) rows.push(["Note", r.note]);
  if (received && r.balanceAfter != null) rows.push(["Balance still due", rs(r.balanceAfter)]);
  for (const [label, value] of rows) {
    p.text(label, M, y, 9.5, { color: MUTED });
    const lines = wrap(value, 10, R - M - 160, label === "Balance still due");
    lines.slice(0, 3).forEach((line, index) => p.text(line, M + 150, y + index * 13, 10, { bold: label === "Balance still due" }));
    y += Math.max(1, Math.min(3, lines.length)) * 13 + 11;
    p.line(M, y - 14, R, y - 14, LINE, 0.5);
  }

  signatures(p, Math.max(y + 70, H - 190), received ? "Paid by" : "Received by", r.company, r.yard.name);
  footer(p, received ? "Received with thanks." : "Payment made as above.", `${r.receiptNo}  ·  ${dmy(r.date)}  ·  Made with Cxyledge`);
  return assemble([p], logo);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(blob);
  });
}

/** Open the system print dialog for a PDF (phones get the PDF opened instead). */
export function printPdf(pdf: Blob): boolean {
  const url = URL.createObjectURL(pdf);
  const touch = window.matchMedia("(pointer: coarse)").matches;
  if (touch) {
    const opened = window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return Boolean(opened);
  }
  const frame = document.createElement("iframe");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.src = url;
  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      window.open(url, "_blank");
    }
    setTimeout(() => {
      frame.remove();
      URL.revokeObjectURL(url);
    }, 60_000);
  };
  document.body.appendChild(frame);
  return true;
}

/** File-safe name, e.g. "CX-2026-27-0001 City Hospital.pdf". */
export function pdfName(no: string, company: string) {
  return `${no || "Bill"} ${company.trim() || "bill"}.pdf`.replace(/[\\/:*?"<>|]+/g, "-");
}
