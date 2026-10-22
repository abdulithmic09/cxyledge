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
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
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

export function printLines(title: string, lines: string[]) {
  const escape = (value: string) =>
    value.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escape(title)}</title>
    <style>body{font-family:Georgia,serif;color:#1c1915;padding:32px} h1{font-size:22px;margin:0 0 8px} p{color:#5e574e} pre{white-space:pre-wrap;font-family:inherit;font-size:14px}</style>
    </head><body><h1>${escape(title)}</h1><p>Cxyledge</p><pre>${lines.map(escape).join("\n")}</pre></body></html>`;
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return false;
  popup.document.write(html);
  popup.document.close();
  popup.focus();
  popup.print();
  return true;
}

export function csvBlob(csv: string): Blob {
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}
