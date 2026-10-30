function pdfEscape(value: string): string {
  return value
    .replace(/₹\s?/g, "Rs. ")
    .replace(/[·•]/g, "-")
    .replace(/×/g, "x")
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\u00a0/g, " ")
    .replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[^\x20-\x7E]/g, "?");
}

function wrapLines(lines: string[]): string[] {
  const wrapped: string[] = [];
  for (const line of lines) {
    const clean = line.replace(/\t/g, "  ");
    if (!clean) {
      wrapped.push("");
      continue;
    }
    for (let index = 0; index < clean.length; index += 90) wrapped.push(clean.slice(index, index + 90));
  }
  return wrapped;
}

export function makePdf(title: string, lines: string[]): Blob {
  const wrapped = wrapLines(lines);
  const perPage = 46;
  const pages: string[][] = [];
  for (let index = 0; index < Math.max(wrapped.length, 1); index += perPage) {
    pages.push(wrapped.slice(index, index + perPage));
  }
  if (pages.length === 0) pages.push(["Nothing in this report."]);

  const objects: string[] = [];
  const fontId = 1;
  const pagesId = 2;
  const catalogId = 3;
  objects[fontId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  let next = 4;
  for (let index = 0; index < pages.length; index += 1) {
    pageIds.push(next);
    next += 1;
    contentIds.push(next);
    next += 1;
  }
  objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[catalogId] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;

  pages.forEach((pageLines, index) => {
    const commands = [
      "BT",
      "/F1 16 Tf",
      "48 800 Td",
      `(${pdfEscape(title)}) Tj`,
      "/F1 9 Tf",
      "0 -16 Td",
      `(${pdfEscape(`Cxyledge    page ${index + 1} of ${pages.length}`)}) Tj`,
      "0 -20 Td",
    ];
    pageLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) commands.push("0 -13 Td");
      commands.push(`(${pdfEscape(line || " ")}) Tj`);
    });
    commands.push("ET");
    const stream = commands.join("\n");
    objects[contentIds[index]!] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
    objects[pageIds[index]!] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Contents ${contentIds[index]} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  const size = objects.length;
  for (let id = 1; id < size; id += 1) {
    offsets[id] = pdf.length;
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${size}\n`;
  pdf += "0000000000 65535 f \n";
  for (let id = 1; id < size; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([pdf], { type: "application/pdf" });
}

export function toCsv(headers: string[], rows: string[][]): string {
  // A leading = + @ (or - before a letter) makes Excel run the cell as a formula, so those get a ' in front.
  const cell = (value: string) => {
    const text = /^[=+@\t\r]|^-[^\d.]/.test(value) ? `'${value}` : value;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return `\uFEFF${[headers, ...rows].map((row) => row.map((value) => cell(value)).join(",")).join("\n")}`;
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function shareBlob(filename: string, blob: Blob, title: string): Promise<"shared" | "saved"> {
  const file = new File([blob], filename, { type: blob.type || "application/octet-stream" });
  try {
    if (typeof navigator.share === "function") {
      const payload: ShareData = { title, files: [file] };
      if (!navigator.canShare || navigator.canShare(payload)) {
        await navigator.share(payload);
        return "shared";
      }
      await navigator.share({ title, text: title });
      return "shared";
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return "shared";
  }
  downloadBlob(filename, blob);
  return "saved";
}

/** Print a ready-made HTML page from a hidden frame (no pop-up needed, and the app's screen layout isn't used). */
export function printHtml(html: string): boolean {
  if (typeof document === "undefined") return false;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return false;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    frame.contentWindow?.focus();
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  const img = doc.querySelector("img");
  if (img && !img.complete) img.addEventListener("load", go, { once: true });
  else window.setTimeout(go, 150);
  return true;
}

export function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** A clean A4 page of report lines (balance summary, ledger, payments, activity). */
export function printLines(title: string, lines: string[]) {
  const now = new Date();
  const printed = `${now.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" })}, ${now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit" })}`;
  const body = lines
    .map((line) => (line.trim() ? `<div class="row">${escapeHtml(line).replace(/\t/g, "&emsp;")}</div>` : '<div class="gap"></div>'))
    .join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
@page{size:A4;margin:14mm 14mm 16mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font-family:"Helvetica Neue",Arial,sans-serif;color:#1c1915;font-size:10.5pt;line-height:1.45}
h1{font-family:Georgia,"Times New Roman",serif;font-size:17pt;color:#1e4d3c;margin:0 0 2px}
.meta{font-size:9pt;color:#6b6257;border-bottom:2.5px solid #1e4d3c;padding-bottom:8px;margin-bottom:10px}
.row{padding:4px 2px;border-bottom:1px solid #ece5d8;white-space:pre-wrap;break-inside:avoid}
.gap{height:10px}
footer{margin-top:16px;padding-top:6px;border-top:1px solid #e4dccd;font-size:8.5pt;color:#6b6257}
</style></head><body><h1>${escapeHtml(title)}</h1><div class="meta">Printed ${escapeHtml(printed)}</div>${body}<footer>Made with Cxyledge</footer></body></html>`;
  return printHtml(html);
}

export function csvBlob(csv: string): Blob {
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}
