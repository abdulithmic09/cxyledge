import { useState } from "react";
import { saveDocument, type Entry, type PaymentStatus, type YardInfo } from "@/lib/inventory/api";
import { cancelBill, getCancelledBill, type CancelledBill } from "@/lib/inventory/billing";
import type { Challan } from "@/lib/inventory/tracking";
import { splitSerials } from "@/lib/inventory/serials";
import { downloadBlob, shareBlob } from "@/lib/inventory/files";
import { billTotals, blobToDataUrl, dmy, lineAmount, makeBillPdf, pdfName, STATUS_WORD, type BillData, type BillLine } from "@/lib/inventory/bill-pdf";
import { rupeesInWords } from "@/lib/inventory/words";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/yard/ui";

type BillKind = "sale" | "purchase";

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function inr(value: number) {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A saved bill, rebuilt from its book lines. */
export type SavedBill = {
  billNo: string;
  kind: BillKind;
  date: string;
  company: string;
  entries: Entry[];
  lines: BillLine[];
  total: number | null;
  paid: number | null;
  payment: PaymentStatus;
  note: string;
};

export function groupBills(entries: Entry[]): SavedBill[] {
  const map = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!entry.billNo || entry.movement === "return") continue;
    const list = map.get(entry.billNo) ?? [];
    list.push(entry);
    map.set(entry.billNo, list);
  }
  return [...map.entries()]
    .map(([billNo, list]) => billFromEntries(billNo, list))
    .sort((a, b) => (a.date === b.date ? b.billNo.localeCompare(a.billNo, "en", { numeric: true }) : b.date.localeCompare(a.date)));
}

export function billFromEntries(billNo: string, list: Entry[]): SavedBill {
  const sorted = [...list].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt) || a.id.localeCompare(b.id));
  const first = sorted[0]!;
  const dues = sorted.map((entry) => entry.amountDue);
  const paids = sorted.map((entry) => entry.amountPaid);
  return {
    billNo,
    kind: first.movement === "purchase" ? "purchase" : "sale",
    date: first.entryDate,
    company: first.companyName,
    entries: sorted,
    lines: sorted.map((entry) => ({ cylinderType: entry.cylinderType, serials: splitSerials(entry.serialNo), quantity: entry.quantity, price: entry.unitPrice })),
    total: dues.every((value) => value == null) ? null : dues.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    paid: paids.every((value) => value == null) ? null : paids.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    payment: first.paymentStatus,
    note: first.note,
  };
}

/** Every bill in the book, with download, edit and cancel. */
export function BillRegister({
  challans,
  yard,
  bills,
  cancelled,
  metaPhone,
  canEdit,
  isOwner,
  onEdit,
  onChanged,
}: {
  challans: Challan[];
  yard: YardInfo;
  bills: SavedBill[];
  cancelled: CancelledBill[];
  metaPhone: (company: string) => string;
  canEdit: boolean;
  isOwner: boolean;
  onEdit: (bill: SavedBill) => void;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [limit, setLimit] = useState(30);

  const q = query.trim().toLowerCase();
  const shown = bills.filter(
    (bill) =>
      !q ||
      bill.billNo.toLowerCase().includes(q) ||
      bill.company.toLowerCase().includes(q) ||
      dmy(bill.date).includes(q) ||
      bill.lines.some((line) => line.cylinderType.toLowerCase().includes(q) || line.serials.some((serial) => serial.toLowerCase().includes(q))),
  );
  const shownCancelled = cancelled.filter((bill) => !q || bill.billNo.toLowerCase().includes(q) || bill.creditNoteNo.toLowerCase().includes(q) || bill.company.toLowerCase().includes(q));

  const challanOf = (no: string) => challans.find((challan) => challan.challanNo === no);
  const pdfOf = (bill: SavedBill) => {
    const slip = bill.billNo.startsWith("DC/") ? challanOf(bill.billNo) : undefined;
    return makeBillPdf(bill.billNo.startsWith("DC/") ? { ...asData(bill), challan: { vehicle: slip?.vehicle ?? "", driver: slip?.driver ?? "", receiver: slip?.receiver ?? "", signature: slip?.signature ?? "" } } : asData(bill));
  };
  const asData = (bill: SavedBill): BillData => ({
    yard,
    kind: bill.kind,
    billNo: bill.billNo,
    date: bill.date,
    company: bill.company,
    companyPhone: metaPhone(bill.company),
    lines: bill.lines,
    total: bill.total,
    payment: bill.payment,
    paid: bill.paid,
    note: bill.note,
  });

  async function doCancel(bill: SavedBill) {
    setBusy(true);
    setNote(null);
    try {
      const result = await cancelBill({ data: { billNo: bill.billNo, reason, date: todayISO() } });
      if (!result.ok) {
        setNote({ tone: "bad", text: result.error });
        return;
      }
      const pdf = await makeBillPdf({ ...asData(bill), credit: { no: result.creditNoteNo, date: result.date, reason } });
      await saveDocument({ data: { companyName: bill.company, title: pdfName(result.creditNoteNo, bill.company), kind: "bill", mime: "application/pdf", content: await blobToDataUrl(pdf) } });
      downloadBlob(pdfName(result.creditNoteNo, bill.company), pdf);
      setNote({ tone: "ok", text: `Bill ${bill.billNo} cancelled. Credit note ${result.creditNoteNo} is in ${bill.company}'s files and was downloaded.` });
      setConfirm(null);
      setReason("");
      onChanged();
    } catch {
      setNote({ tone: "bad", text: "Could not cancel. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  async function creditPdf(bill: CancelledBill) {
    const rows = await getCancelledBill({ data: bill.billNo });
    if (!rows.length) return;
    const savedBill = billFromEntries(bill.billNo, rows);
    const pdf = await makeBillPdf({ ...asData(savedBill), credit: { no: bill.creditNoteNo, date: bill.cancelledAt.slice(0, 10), reason: bill.reason } });
    downloadBlob(pdfName(bill.creditNoteNo, bill.company), pdf);
  }

  return (
    <div className="flex flex-col gap-4">
      <input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a bill no., company, gas type, serial or date" aria-label="Find a bill" />
      {note ? (
        <p className={cn("rounded-lg px-3 py-2 text-sm", note.tone === "ok" ? "bg-pine/10 text-pine" : "bg-rust/10 text-rust")} role="status">
          {note.text}
        </p>
      ) : null}
      <Panel title={`Bills (${shown.length})`}>
        {shown.length === 0 ? <p className="text-sm text-muted">{bills.length ? "No bill matches that search." : "No bills yet. Make one on the New bill tab."}</p> : null}
        <ul className="divide-y divide-line">
          {shown.slice(0, limit).map((bill) => {
            const t = billTotals(asData(bill));
            const isChallan = bill.billNo.startsWith("DC/");
            return (
              <li key={bill.billNo} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {bill.billNo} <span className="font-normal text-muted">· {dmy(bill.date)}</span>
                      {bill.kind === "purchase" ? <span className="ml-2 rounded bg-sand px-1.5 py-0.5 text-xs font-medium">Purchase</span> : null}
                      {isChallan ? <span className="ml-2 rounded bg-pine/15 px-1.5 py-0.5 text-xs font-medium text-pine">Challan{challanOf(bill.billNo)?.signature ? " · signed" : ""}</span> : null}
                    </p>
                    <p className="truncate text-sm">{bill.company}</p>
                    <p className="text-xs text-muted">{bill.lines.map((line) => `${line.quantity} × ${line.cylinderType || "cylinders"}`).join(" · ")}</p>
                  </div>
                  {isChallan ? (
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{t.quantity} cyl.</p>
                      <p className="text-xs font-semibold text-rust">Not billed yet</p>
                    </div>
                  ) : (
                    <div className="text-right">
                      <p className="font-semibold tabular-nums">{inr(t.total)}</p>
                      <p className={cn("text-xs font-semibold", t.due > 0 ? "text-rust" : "text-pine")}>{t.due > 0 ? `${inr(t.due)} due` : STATUS_WORD.received}</p>
                    </div>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => void pdfOf(bill).then((pdf) => downloadBlob(pdfName(bill.billNo, bill.company), pdf))}>
                    PDF
                  </button>
                  <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => void pdfOf(bill).then((pdf) => shareBlob(pdfName(bill.billNo, bill.company), pdf, `${bill.billNo} · ${yard.name}`))}>
                    Share
                  </button>
                  {canEdit ? (
                    <button type="button" className={cn("btn h-9 px-3 text-sm", isChallan ? "btn-pine" : "btn-ghost")} onClick={() => onEdit(bill)}>
                      {isChallan ? "Make bill" : "Edit"}
                    </button>
                  ) : null}
                  {isOwner ? (
                    <button
                      type="button"
                      className="btn btn-ghost h-9 px-3 text-sm text-rust"
                      onClick={() => {
                        setConfirm(confirm === bill.billNo ? null : bill.billNo);
                        setReason("");
                      }}
                    >
                      Cancel bill
                    </button>
                  ) : null}
                </div>
                {confirm === bill.billNo ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-rust/40 bg-rust/5 p-3">
                    <p className="text-sm">
                      Cancelling takes this bill&apos;s cylinders and amount off {bill.company}&apos;s balance and makes a credit note. Payments already recorded stay, so money already received becomes a credit for the company.
                    </p>
                    <input className="field" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Reason, e.g. wrong company or duplicate bill" aria-label="Reason for cancelling" />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void doCancel(bill)}>
                        {busy ? "Cancelling…" : "Cancel bill and make credit note"}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                        Keep bill
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
        {shown.length > limit ? (
          <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => setLimit((value) => value + 30)}>
            Show more ({shown.length - limit} left)
          </button>
        ) : null}
      </Panel>
      {shownCancelled.length ? (
        <Panel title={`Cancelled bills (${shownCancelled.length})`}>
          <ul className="divide-y divide-line">
            {shownCancelled.map((bill) => (
              <li key={`${bill.billNo}-${bill.creditNoteNo}`} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-semibold">
                    <span className="line-through decoration-rust/70">{bill.billNo}</span> <span className="font-normal text-muted">· credit note {bill.creditNoteNo}</span>
                  </p>
                  <p className="truncate text-sm">
                    {bill.company} · {inr(bill.total)} · cancelled {dmy(bill.cancelledAt.slice(0, 10))}
                  </p>
                  {bill.reason ? <p className="text-xs text-muted">{bill.reason}</p> : null}
                </div>
                <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => void creditPdf(bill)}>
                  Credit note PDF
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
    </div>
  );
}

/** On-screen bill that mirrors the PDF layout. */
export function BillPreview({ bill }: { bill: BillData }) {
  const { yard } = bill;
  const t = billTotals(bill);
  const sale = bill.kind === "sale";
  const ids = [yard.phone && `Phone ${yard.phone}`, yard.gst && `GSTIN ${yard.gst}`, yard.pan && `PAN ${yard.pan}`].filter(Boolean) as string[];
  const label = "text-[10px] font-bold uppercase tracking-[0.14em] text-rust";
  const grid = "grid grid-cols-[1fr_auto_auto] gap-3 @md:grid-cols-[1fr_3rem_6rem_6.5rem]";
  return (
    <article className="@container overflow-hidden rounded-xl border border-line bg-white text-[13px] text-[#1c1915] shadow-sm">
      <header className="flex items-start justify-between gap-3 border-b-4 border-rust bg-[#1c1915] px-4 py-4 text-white @md:px-5">
        <div className="min-w-0">
          <p className="font-display text-2xl font-bold tracking-wide @md:text-3xl">{sale ? "BILL" : "PURCHASE BILL"}</p>
          <p className="truncate text-xs text-white/70">{yard.name}</p>
        </div>
        <dl className="grid shrink-0 grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-right text-xs">
          <dt className="text-white/60">Bill no.</dt>
          <dd className="font-semibold">{bill.billNo || "-"}</dd>
          <dt className="text-white/60">Date</dt>
          <dd className="font-semibold tabular-nums">{dmy(bill.date)}</dd>
        </dl>
      </header>

      <div className="grid gap-4 px-4 py-4 @md:grid-cols-2 @md:px-5">
        <div className="min-w-0">
          {yard.logo ? <img src={yard.logo} alt="" className="mb-2 h-10 w-auto max-w-[150px] object-contain" /> : null}
          <p className={label}>From</p>
          <p className="mt-1 text-base font-bold">{yard.name}</p>
          {yard.address ? <p className="whitespace-pre-wrap text-[#5e574d]">{yard.address}</p> : null}
          {ids.map((line) => (
            <p key={line} className="text-[#5e574d]">
              {line}
            </p>
          ))}
          {!yard.address && !ids.length ? <p className="text-xs text-[#5e574d]">Add your letterhead in Settings.</p> : null}
        </div>
        <div className="min-w-0 self-start rounded-lg bg-[#f3efe6] p-3">
          <p className={label}>{sale ? "Bill to" : "Supplier"}</p>
          <p className="mt-1 break-words text-base font-bold">{bill.company}</p>
          {bill.companyPhone ? <p className="text-[#5e574d]">Phone {bill.companyPhone}</p> : null}
          <p className={cn("mt-2 text-xs font-bold", bill.payment === "received" ? "text-pine" : "text-rust")}>Payment: {STATUS_WORD[bill.payment]}</p>
        </div>
      </div>

      <div className="px-4 @md:px-5">
        <div className="overflow-hidden rounded-md border border-[#ddd4c7]">
          <div className={cn(grid, "bg-[#1c1915] px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white")}>
            <span>Description</span>
            <span className="text-right">Qty</span>
            <span className="hidden text-right @md:block">Rate</span>
            <span className="text-right">Amount</span>
          </div>
          {bill.lines.map((line, index) => (
            <div key={index} className={cn(grid, "px-3 py-3", index > 0 && "border-t border-[#ece5d8]", index % 2 === 1 && "bg-[#fbf9f5]")}>
              <div className="min-w-0">
                <p className="font-bold">{line.cylinderType || "Gas cylinders"}</p>
                <p className="mt-0.5 break-words text-xs text-[#5e574d]">{line.serials.length ? `Serial nos.: ${line.serials.join(", ")}` : "No serials yet"}</p>
                <p className="text-xs text-[#5e574d] @md:hidden">{line.price != null ? `@ ${inr(line.price)}` : ""}</p>
              </div>
              <span className="text-right tabular-nums">{line.quantity}</span>
              <span className="hidden text-right tabular-nums @md:block">{line.price != null ? inr(line.price) : "-"}</span>
              <span className="text-right font-semibold tabular-nums">{line.price != null ? inr(lineAmount(line)) : "-"}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 px-1 text-[11px] text-[#5e574d]">
          {t.quantity} cylinder{t.quantity === 1 ? "" : "s"} in all
        </p>
      </div>

      <div className="grid gap-4 px-4 py-4 @md:grid-cols-[1fr_15rem] @md:px-5">
        <div className="order-2 min-w-0 @md:order-1">
          <p className={label}>Amount in words</p>
          <p className="mt-1 font-semibold">{rupeesInWords(t.total)}</p>
          {bill.note.trim() ? (
            <>
              <p className={cn(label, "mt-3")}>Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-[#5e574d]">{bill.note.trim()}</p>
            </>
          ) : null}
        </div>
        <dl className="order-1 grid grid-cols-[1fr_auto] gap-y-1.5 tabular-nums @md:order-2">
          <dt className="text-[#5e574d]">Subtotal</dt>
          <dd className="text-right">{inr(t.subtotal)}</dd>
          {t.adjustment ? (
            <>
              <dt className="text-[#5e574d]">{t.adjustment < 0 ? "Discount / round-off" : "Adjustment"}</dt>
              <dd className="text-right">
                {t.adjustment < 0 ? "- " : ""}
                {inr(Math.abs(t.adjustment))}
              </dd>
            </>
          ) : null}
          <dt className="border-t border-[#ddd4c7] pt-1.5 font-bold">Total</dt>
          <dd className="border-t border-[#ddd4c7] pt-1.5 text-right font-bold">{inr(t.total)}</dd>
          <dt className="text-[#5e574d]">{sale ? "Received" : "Paid"}</dt>
          <dd className="text-right">{inr(t.paid)}</dd>
          <div className="col-span-2 mt-1 flex items-center justify-between gap-3 rounded-md bg-[#1c1915] px-3 py-2.5 text-white">
            <dt className="text-[11px] font-bold uppercase tracking-wider">Balance due</dt>
            <dd className="text-base font-bold">{inr(t.due)}</dd>
          </div>
        </dl>
      </div>

      <div className="grid grid-cols-2 gap-6 px-4 pb-4 pt-6 text-xs @md:px-5">
        <div>
          <div className="border-t border-[#1c1915] pt-1 text-[#5e574d]">{sale ? "Receiver's signature" : "Supplier's signature"}</div>
          <p className="truncate font-semibold">{bill.company}</p>
        </div>
        <div className="text-right">
          <div className="border-t border-[#1c1915] pt-1 text-[#5e574d]">Authorised signatory</div>
          <p className="truncate font-semibold">For {yard.name}</p>
        </div>
      </div>
      <footer className="flex justify-between gap-2 border-t border-[#ddd4c7] px-4 py-2 text-[11px] text-[#5e574d] @md:px-5">
        <span>Thank you for your business.</span>
        <span className="truncate">Made with Cxyledge</span>
      </footer>
    </article>
  );
}
