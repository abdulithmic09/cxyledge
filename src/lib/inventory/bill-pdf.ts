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
  /** Delivery challan: no prices or totals, with vehicle details and the receiver's signature. */
  challan?: { vehicle: string; driver: string; receiver: string; signature: string; billedAs?: string };
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
  image(x: number, top: number, w: number, h: number, name = "Im1") {
    this.ops.push(`q ${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${(H - top - h).toFixed(2)} cm /${name} Do Q`);
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

/** Objects: 1 catalog, 2 pages, 3/4 fonts, then one per image (Im1, Im2…), then content+page pairs. */
function assemble(pages: Page[], logo: Logo | null, extra: Logo | null = null): Blob {
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
  const images = [logo ? { name: "Im1", img: logo } : null, extra ? { name: "Im2", img: extra } : null].filter(Boolean) as Array<{ name: string; img: Logo }>;
  const first = 5 + images.length;
  const pageIds = pages.map((_, index) => first + 1 + index * 2);
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  const xobjects = images.map((item, index) => `/${item.name} ${5 + index} 0 R`).join(" ");
  const resources = `<< /Font << /F1 3 0 R /F2 4 0 R >>${images.length ? ` /XObject << ${xobjects} >>` : ""} >>`;
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  obj(3, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  obj(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  images.forEach((item, index) => {
    const { img } = item;
    obj(5 + index, [`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>\nstream\n`, img.bytes, "\nendstream"]);
  });
  pages.forEach((page, index) => {
    const content = page.ops.join("\n");
    const contentId = first + index * 2;
    obj(contentId, `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`);
    obj(pageIds[index]!, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
  });
  const count = first + pages.length * 2 - 1;
  const xref = size;
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`);
  for (let id = 1; id <= count; id += 1) push(`${String(offsets[id] ?? 0).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts as BlobPart[], { type: "application/pdf" });
}

// ---------------------------------------------------------------------------
// "Formal grid" layout: everything inside one ruled frame, like a standard Indian tax invoice.
// ---------------------------------------------------------------------------

const FX = 28; // frame left
const FR = W - 28; // frame right
const FT = 26; // frame top
const FB = H - 30; // frame bottom (footer line sits under it)
const PAD = 9;
const GRID: RGB = [0.11, 0.098, 0.082];
const HAIR: RGB = [0.8, 0.8, 0.8];
const HEAD_FILL: RGB = [0.93, 0.93, 0.93];

function hline(p: Page, y: number, x1 = FX, x2 = FR, c: RGB = GRID, w = 0.7) {
  p.line(x1, y, x2, y, c, w);
}
function vline(p: Page, x: number, y1: number, y2: number, c: RGB = GRID, w = 0.7) {
  p.line(x, y1, x, y2, c, w);
}
function frame(p: Page, top = FT, bottom = FB) {
  hline(p, top, FX, FR, GRID, 1.1);
  hline(p, bottom, FX, FR, GRID, 1.1);
  vline(p, FX, top, bottom, GRID, 1.1);
  vline(p, FR, top, bottom, GRID, 1.1);
}
/** Black title bar across the top of the frame. Returns the y below it. */
function titleBar(p: Page, title: string, top = FT): number {
  p.rect(FX, top, FR - FX, 20, GRID);
  p.text(title, W / 2, top + 14, 10.5, { bold: true, color: WHITE, align: "center", spacing: 3 });
  return top + 20;
}
/** Business name, address and tax ids, centred. Returns the y below the ruled line. */
function firmBlock(p: Page, yard: YardInfo, logo: Logo | null, top: number): number {
  let y = top + 24;
  if (logo) {
    const lh = 40;
    const lw = Math.min(110, (logo.w / logo.h) * lh);
    p.image(FX + PAD, top + 10, lw, lh);
  }
  p.text(yard.name.toUpperCase(), W / 2, y, 16, { bold: true, align: "center", spacing: 0.4 });
  y += 15;
  const addrLines = yard.address ? wrap(yard.address.replace(/\s*\n\s*/g, ", "), 9, FR - FX - (logo ? 260 : 60)).filter(Boolean).slice(0, 2) : [];
  if (yard.phone) addrLines.push(`Phone ${yard.phone}`);
  for (const line of addrLines) {
    p.text(line, W / 2, y, 9, { align: "center" });
    y += 11.5;
  }
  const ids = [yard.gst && `GSTIN: ${yard.gst}`, yard.pan && `PAN: ${yard.pan}`].filter(Boolean).join("     ");
  if (ids) {
    p.text(ids, W / 2, y, 9, { bold: true, align: "center" });
    y += 11.5;
  }
  if (!yard.address && !yard.phone && !ids) {
    p.text("Add your address, phone and GSTIN in Settings > Business details.", W / 2, y, 8.5, { align: "center", color: MUTED });
    y += 11.5;
  }
  y = Math.max(y + 2, logo ? top + 58 : y + 2);
  hline(p, y);
  return y;
}
/** Two cells: the other party on the left, document details on the right. */
function partyRow(p: Page, top: number, label: string, name: string, extra: string[], fields: Array<[string, string]>): number {
  const mid = FX + (FR - FX) * 0.55;
  let ly = top + 14;
  p.text(label.toUpperCase(), FX + PAD, ly, 7.5, { bold: true, color: MUTED, spacing: 0.8 });
  ly += 15;
  for (const line of wrap(name || "Company", 12, mid - FX - PAD * 2, true).slice(0, 2)) {
    p.text(line, FX + PAD, ly, 12, { bold: true });
    ly += 14;
  }
  for (const line of extra) {
    p.text(line, FX + PAD, ly, 9.5);
    ly += 12.5;
  }
  let ry = top + 16;
  for (const [k, v] of fields) {
    p.text(k, mid + PAD, ry, 9.5, { bold: true });
    for (const [index, line] of wrap(v || "-", 9.5, FR - mid - PAD * 2 - 78).slice(0, 2).entries()) p.text(line, mid + PAD + 78, ry + index * 12, 9.5);
    ry += wrap(v || "-", 9.5, FR - mid - PAD * 2 - 78).slice(0, 2).length * 12 + 3.5;
  }
  const bottom = Math.max(ly, ry) + 4;
  vline(p, mid, top, bottom);
  hline(p, bottom);
  return bottom;
}
/** Bottom row of two signature cells. */
function signatureRow(p: Page, top: number, leftLabel: string, leftName: string, yardName: string, sign: Logo | null = null) {
  const mid = (FX + FR) / 2;
  hline(p, top);
  vline(p, mid, top, FB);
  p.text(leftLabel, FX + PAD, top + 14, 8.5, { color: MUTED });
  if (sign) {
    const sh = 40;
    const sw = Math.min(170, (sign.w / sign.h) * sh);
    p.image(FX + PAD, top + 20, sw, sh, "Im2");
  }
  p.text(wrap(leftName, 10, mid - FX - PAD * 2, true)[0] ?? "", FX + PAD, FB - 12, 10, { bold: true });
  p.text(`For ${yardName}`, FR - PAD, top + 16, 10, { bold: true, align: "right" });
  p.text("Authorised signatory", FR - PAD, FB - 12, 8.5, { color: MUTED, align: "right" });
}
function pageFooter(p: Page, left: string, right: string) {
  p.text(left, FX, H - 16, 8, { color: MUTED });
  p.text(right, FR, H - 16, 7.5, { color: MUTED, align: "right" });
}
const plain = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** A4 bill, credit note, challan or holding-charge bill in the formal grid layout. Long bills continue on more pages. */
export async function makeBillPdf(bill: BillData): Promise<Blob> {
  const { yard } = bill;
  const t = billTotals(bill);
  const sale = bill.kind === "sale";
  const credit = bill.credit;
  const challan = bill.challan;
  const logo = await logoJpeg(yard.logo);
  const sign = challan?.signature ? await logoJpeg(challan.signature) : null;
  const pages: Page[] = [];
  let p = new Page();
  pages.push(p);

  const title = credit ? "CREDIT NOTE" : challan ? "DELIVERY CHALLAN" : (bill.title ?? (sale ? "BILL" : "PURCHASE BILL"));
  const docNo = credit ? credit.no : bill.billNo;
  const fields: Array<[string, string]> = credit
    ? [["Credit note", credit.no], ["Date", dmy(credit.date)], ["Against bill", bill.billNo || "-"], ["Bill dated", dmy(bill.date)]]
    : challan
      ? [["Challan no.", bill.billNo || "-"], ["Date", dmy(bill.date)], ["Vehicle", challan.vehicle || "-"], ["Driver", challan.driver || "-"]]
      : [["Bill no.", bill.billNo || "-"], ["Date", dmy(bill.date)], ["Payment", STATUS_WORD[bill.payment]]];
  const extra = [bill.companyPhone ? `Phone ${bill.companyPhone}` : "", challan?.billedAs ? `Billed as ${challan.billedAs}` : ""].filter(Boolean);

  let y = titleBar(p, title);
  y = firmBlock(p, yard, logo, y);
  y = partyRow(p, y, credit ? "Issued to" : challan ? "Deliver to" : sale ? "Bill to" : "Supplier", bill.company, extra, fields);

  // Items table with ruled columns. The table stretches down so totals and signatures sit at the bottom.
  const unitWord = bill.unit ?? "cylinder";
  const priced = !challan;
  const cols = challan ? { no: FX, desc: FX + 38, qty: FR - 70, rate: 0, amt: 0, end: FR } : { no: FX, desc: FX + 38, qty: FR - 225, rate: FR - 170, amt: FR - 92, end: FR };
  const SIG_H = 78;
  const notes = [credit ? `Reason: ${credit.reason || "Bill cancelled"}` : "", bill.note.trim()].filter(Boolean).join("\n");
  const noteLines = notes ? wrap(notes, 9, (challan ? FR - FX : FR - FX - 210) - PAD * 2).slice(0, 5) : [];
  const totalsH = challan ? 34 + noteLines.length * 11.5 + (challan.receiver ? 14 : 0) : Math.max(92 + (t.adjustment ? 18 : 0), 50 + noteLines.length * 11.5 + 18);
  const lastBottom = FB - SIG_H - totalsH; // where the table must end on the last page

  let tableTop = y;
  const head = () => {
    p.rect(FX + 0.5, y, FR - FX - 1, 20, HEAD_FILL);
    const hy = y + 13.5;
    p.text("S.No.", cols.no + 7, hy, 8.5, { bold: true });
    p.text(challan ? "Description of goods" : "Description of goods", cols.desc + 7, hy, 8.5, { bold: true });
    if (priced) {
      p.text("Qty", cols.rate - 7, hy, 8.5, { bold: true, align: "right" });
      p.text("Rate (Rs.)", cols.amt - 7, hy, 8.5, { bold: true, align: "right" });
      p.text("Amount (Rs.)", cols.end - 7, hy, 8.5, { bold: true, align: "right" });
    } else {
      p.text("Qty", cols.end - 7, hy, 8.5, { bold: true, align: "right" });
    }
    y += 20;
    hline(p, y);
  };
  const columnRules = (from: number, to: number) => {
    const xs = priced ? [cols.desc, cols.qty, cols.rate, cols.amt] : [cols.desc, cols.qty];
    for (const x of xs) vline(p, x, from, to);
  };
  const newPage = () => {
    columnRules(tableTop, FB);
    frame(p);
    pageFooter(p, "Continued on the next page", `${docNo || ""}  ·  page ${pages.length}`);
    p = new Page();
    pages.push(p);
    y = titleBar(p, `${title} (CONTINUED)`);
    p.text(`${docNo || ""}  ·  ${bill.company}`, W / 2, y + 14, 9.5, { bold: true, align: "center" });
    y += 22;
    hline(p, y);
    tableTop = y;
    head();
  };
  head();

  const descWidth = cols.qty - cols.desc - 14;
  const lines = bill.lines.length ? bill.lines : [{ cylinderType: "", serials: [], quantity: 0, price: null }];
  lines.forEach((line, index) => {
    const serialLines = line.serials.length ? wrap(`Serial nos.: ${line.serials.join(", ")}`, 8.5, descWidth) : [];
    const shown = serialLines.slice(0, 10);
    if (serialLines.length > shown.length) shown[shown.length - 1] += " …";
    const nameLines = wrap(line.cylinderType || "Gas cylinders", 10, descWidth, true).slice(0, 2);
    const rowH = 12 + nameLines.length * 12.5 + shown.length * 10.5 + 4;
    const room = index === lines.length - 1 ? lastBottom : FB - 4;
    if (y + rowH > room && y + rowH > FB - 4) newPage();
    let ty = y + 15;
    p.text(String(index + 1), cols.no + 7, ty, 9.5);
    for (const text of nameLines) {
      p.text(text, cols.desc + 7, ty, 10, { bold: true });
      ty += 12.5;
    }
    for (const text of shown) {
      p.text(text, cols.desc + 7, ty - 1, 8.5, { color: MUTED });
      ty += 10.5;
    }
    if (priced) {
      p.text(String(line.quantity), cols.rate - 7, y + 15, 9.5, { align: "right" });
      p.text(line.price != null ? plain(line.price) : "-", cols.amt - 7, y + 15, 9.5, { align: "right" });
      p.text(line.price != null ? plain(lineAmount(line)) : "-", cols.end - 7, y + 15, 9.5, { bold: true, align: "right" });
    } else {
      p.text(String(line.quantity), cols.end - 7, y + 15, 10.5, { bold: true, align: "right" });
    }
    y += rowH;
    if (index < lines.length - 1) hline(p, y, FX, FR, HAIR, 0.5);
  });
  // If the totals don't fit under the last row, they go on a fresh page.
  if (y > lastBottom) newPage();
  const tableEnd = lastBottom;
  columnRules(tableTop, tableEnd);
  hline(p, tableEnd);

  // Totals (right cell) and words / notes (left cell).
  const blockTop = tableEnd;
  if (challan) {
    let cy = blockTop + 15;
    p.text(`Total: ${t.quantity} ${unitWord}${t.quantity === 1 ? "" : "s"}`, FX + PAD, cy, 10, { bold: true });
    if (challan.receiver) {
      cy += 14;
      p.text(`Received by: ${challan.receiver}`, FX + PAD, cy, 9.5);
    }
    if (noteLines.length) {
      cy += 15;
      p.text("NOTES", FX + PAD, cy, 7.5, { bold: true, color: MUTED, spacing: 0.8 });
      for (const line of noteLines) {
        cy += 11.5;
        p.text(line, FX + PAD, cy, 9);
      }
    }
  } else {
    const TL = FR - 210;
    vline(p, TL, blockTop, blockTop + totalsH);
    let ty = blockTop;
    const row = (label: string, value: string, opts: { bold?: boolean; last?: boolean } = {}) => {
      p.text(label, TL + PAD, ty + 13.5, 9.5, { bold: opts.bold });
      p.text(value, FR - PAD, ty + 13.5, 9.5, { bold: opts.bold, align: "right" });
      ty += 19;
      if (!opts.last) hline(p, ty, TL, FR, HAIR, 0.5);
    };
    row(`Total (${t.quantity} ${unitWord}${t.quantity === 1 ? "" : "s"})`, plain(t.subtotal));
    if (t.adjustment) row(t.adjustment < 0 ? "Discount / round-off" : "Adjustment", `${t.adjustment < 0 ? "- " : ""}${plain(Math.abs(t.adjustment))}`);
    if (t.adjustment) row("Bill total", plain(t.total), { bold: true });
    if (!credit) row(sale ? "Received" : "Paid", plain(t.paid));
    const dueTop = blockTop + totalsH - 26;
    p.rect(TL + 0.4, dueTop, FR - TL - 0.8, 26 - 0.4, GRID);
    p.text(credit ? "Amount credited" : "Balance due", TL + PAD, dueTop + 17, 10, { bold: true, color: WHITE });
    p.text(rs(credit ? t.total : t.due), FR - PAD, dueTop + 17, 11.5, { bold: true, color: WHITE, align: "right" });

    let ly = blockTop + 15;
    p.text("AMOUNT IN WORDS", FX + PAD, ly, 7.5, { bold: true, color: MUTED, spacing: 0.8 });
    ly += 13;
    for (const line of wrap(rupeesInWords(t.total), 10, TL - FX - PAD * 2, true).slice(0, 3)) {
      p.text(line, FX + PAD, ly, 10, { bold: true });
      ly += 12.5;
    }
    if (noteLines.length) {
      ly += 6;
      p.text(credit ? "REASON / NOTES" : "NOTES", FX + PAD, ly, 7.5, { bold: true, color: MUTED, spacing: 0.8 });
      for (const line of noteLines) {
        ly += 11.5;
        p.text(line, FX + PAD, ly, 9);
      }
    }
  }

  signatureRow(p, FB - SIG_H, credit ? "Received by" : challan ? "Receiver's signature" : sale ? "Receiver's signature" : "Supplier's signature", challan?.receiver || bill.company, yard.name, sign);
  frame(p);
  const tag = credit ? `${credit.no}  ·  ${dmy(credit.date)}` : `${bill.billNo || ""}  ·  ${dmy(bill.date)}`;
  const thanks = credit ? "This credit note cancels the bill named above." : challan ? "Delivery challan, not a bill. Received the above cylinders in good condition." : "Thank you for your business.";
  pageFooter(p, thanks, `${tag}  ·  ${pages.length > 1 ? `page ${pages.length}  ·  ` : ""}Made with Cxyledge`);
  return assemble(pages, logo, sign);
}

/** Payment receipt (money in) or voucher (money paid out) in the same grid layout. */
export async function makeReceiptPdf(r: ReceiptData): Promise<Blob> {
  const received = r.direction === "in";
  const logo = await logoJpeg(r.yard.logo);
  const p = new Page();
  const title = r.title ?? (received ? "RECEIPT" : "PAYMENT VOUCHER");
  let y = titleBar(p, title);
  y = firmBlock(p, r.yard, logo, y);
  y = partyRow(p, y, received ? "Received from" : "Paid to", r.company, [], [
    ["Receipt no.", r.receiptNo],
    ["Date", dmy(r.date)],
    ["Mode", r.mode],
    ...(r.reference ? ([["Reference", r.reference]] as Array<[string, string]>) : []),
    ...(r.billNo ? ([["Against bill", r.billNo]] as Array<[string, string]>) : []),
  ]);

  // Amount band
  p.rect(FX + 0.5, y + 0.4, FR - FX - 1, 50, HEAD_FILL);
  p.text(received ? "AMOUNT RECEIVED" : "AMOUNT PAID", FX + PAD, y + 18, 7.5, { bold: true, color: MUTED, spacing: 0.8 });
  p.text(rs(r.amount), FX + PAD, y + 40, 20, { bold: true });
  const words = wrap(rupeesInWords(r.amount), 9.5, 290, true).slice(0, 3);
  words.forEach((line, index) => p.text(line, FR - PAD, y + 20 + index * 12, 9.5, { bold: true, align: "right" }));
  y += 50;
  hline(p, y);

  const rows: Array<[string, string]> = [];
  if (r.note) rows.push(["Note", r.note]);
  if (received && r.balanceAfter != null) rows.push(["Balance still due", rs(r.balanceAfter)]);
  for (const [label, value] of rows) {
    const lines = wrap(value, 9.5, FR - FX - 150).slice(0, 3);
    p.text(label, FX + PAD, y + 15, 9.5, { bold: true });
    lines.forEach((line, index) => p.text(line, FX + 140, y + 15 + index * 12, 9.5, { bold: label === "Balance still due" }));
    vline(p, FX + 130, y, y + 10 + lines.length * 12);
    y += 10 + lines.length * 12;
    hline(p, y, FX, FR, HAIR, 0.5);
  }

  // Receipts are short: the frame ends under the signatures.
  const bottom = Math.max(y + 96, 380);
  const mid = (FX + FR) / 2;
  const sigTop = bottom - 78;
  hline(p, sigTop);
  vline(p, mid, sigTop, bottom);
  p.text(received ? "Paid by" : "Received by", FX + PAD, sigTop + 14, 8.5, { color: MUTED });
  p.text(r.company, FX + PAD, bottom - 12, 10, { bold: true });
  p.text(`For ${r.yard.name}`, FR - PAD, sigTop + 16, 10, { bold: true, align: "right" });
  p.text("Authorised signatory", FR - PAD, bottom - 12, 8.5, { color: MUTED, align: "right" });
  frame(p, FT, bottom);
  p.text(received ? "Received with thanks." : "Payment made as above.", FX, bottom + 14, 8, { color: MUTED });
  p.text(`${r.receiptNo}  ·  ${dmy(r.date)}  ·  Made with Cxyledge`, FR, bottom + 14, 7.5, { color: MUTED, align: "right" });
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
