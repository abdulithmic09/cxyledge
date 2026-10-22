import { useState } from "react";
import { csvBlob, downloadBlob, makePdf, printLines, shareBlob } from "@/lib/inventory/files";

export function ExportBar({
  title,
  filename,
  lines,
  csv,
}: {
  title: string;
  filename: string;
  lines: string[];
  csv: string;
}) {
  const [note, setNote] = useState("");

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            downloadBlob(`${filename}.pdf`, makePdf(title, lines));
            setNote("PDF saved.");
          }}
        >
          PDF
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            downloadBlob(`${filename}.csv`, csvBlob(csv));
            setNote("Spreadsheet saved.");
          }}
        >
          Spreadsheet
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            void shareBlob(`${filename}.pdf`, makePdf(title, lines), title).then((result) => {
              setNote(result === "shared" ? "Share sheet opened." : "PDF saved on this device.");
            });
          }}
        >
          Share
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            const opened = printLines(title, lines);
            setNote(opened ? "Print dialog opened." : "Allow pop-ups to print, or save a PDF instead.");
          }}
        >
          Print
        </button>
      </div>
      {note ? <p className="text-sm text-pine">{note}</p> : null}
    </div>
  );
}
