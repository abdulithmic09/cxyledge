import { useState } from "react";
import { saveDocument, type Entry, type PaymentStatus, type YardInfo } from "@/lib/inventory/api";
import { cancelBill, getCancelledBill, unbillMonthly, type CancelledBill } from "@/lib/inventory/billing";
import type { BillMeta, Challan } from "@/lib/inventory/tracking";
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
  /** Monthly bills: the month they cover and every delivery, for the delivery list in the PDF. */
  monthly?: { month: string; annex: NonNullable<BillData["annex"]> };
};

export function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

/** The note printed on a monthly bill: what it covers, then the note typed for it. */
export function monthlyNote(month: string, deliveries: Array<{ entryDate: string }>, note: string) {
  const dates = deliveries.map((entry) => entry.entryDate).sort();
  const range = dates.length ? `, ${dmy(dates[0]!)} to ${dmy(dates[dates.length - 1]!)}` : "";
  return [`Cylinders supplied in ${monthName(month)}: ${deliveries.length} ${deliveries.length === 1 ? "delivery" : "deliveries"}${range}.`, note.trim()].filter(Boolean).join(" ");
}

/** One line per gas for a monthly bill, from its deliveries. */
export function monthlyLines(deliveries: Entry[]): BillLine[] {
  const map = new Map<string, Entry[]>();
  for (const entry of deliveries) {
    const type = entry.cylinderType.trim() || "Cylinders";
    map.set(type, [...(map.get(type) ?? []), entry]);
  }
  return [...map.entries()].map(([type, list]) => {
    const quantity = list.reduce((sum, entry) => sum + entry.quantity, 0);
    const prices = [...new Set(list.map((entry) => entry.unitPrice))];
    const amount = list.reduce((sum, entry) => sum + (entry.amountDue ?? 0), 0);
    const price = prices.length === 1 ? prices[0]! : quantity ? Math.round((amount / quantity) * 100) / 100 : null;
    return { cylinderType: type, serials: list.flatMap((entry) => splitSerials(entry.serialNo)), quantity, price };
  });
}

export function groupBills(entries: Entry[], meta: BillMeta[] = []): SavedBill[] {
  const metaOf = new Map(meta.map((row) => [row.billNo, row]));
  const map = new Map<string, Entry[]>();
  for (const entry of entries) {
    if (!entry.billNo || entry.movement === "return") continue;
    const list = map.get(entry.billNo) ?? [];
    list.push(entry);
    map.set(entry.billNo, list);
  }
  return [...map.entries()]
    .map(([billNo, list]) => {
      const bill = billFromEntries(billNo, list);
      const own = metaOf.get(billNo);
      if (own?.kind !== "monthly") return bill;
      const deliveries = [...list].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
      const total = bill.total;
      const paid = bill.paid;
      return {
        ...bill,
        date: own.date,
        lines: monthlyLines(deliveries),
        note: monthlyNote(own.month, deliveries, own.note),
        payment: (total != null && total > 0 && (paid ?? 0) >= total - 0.004 ? "received" : (paid ?? 0) > 0 ? "partial" : "unpaid") as PaymentStatus,
        monthly: { month: own.month, annex: deliveries.map((entry) => ({ date: entry.entryDate, gas: entry.cylinderType || "Cylinders", quantity: entry.quantity, serials: splitSerials(entry.serialNo) })) },
      };
    })
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
  leftOf,
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
  /** What's still owed on a sale bill after all money received (payments against it, then oldest first). */
  leftOf?: (billNo: string) => number;
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
    annex: bill.monthly?.annex,
  });

  async function doUnbill(bill: SavedBill) {
    setBusy(true);
    setNote(null);
    try {
      const result = await unbillMonthly({ data: bill.billNo });
      if (!result.ok) {
        setNote({ tone: "bad", text: result.error });
        return;
      }
      setConfirm(null);
      setNote({ tone: "ok", text: `${bill.billNo} unbilled. Its ${result.deliveries} deliveries can go on a new monthly bill.` });
      onChanged();
    } catch {
      setNote({ tone: "bad", text: "Couldn't unbill. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

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
            const due = bill.kind === "sale" && leftOf ? leftOf(bill.billNo) : t.due;
            return (
              <li key={bill.billNo} className="py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {bill.billNo} <span className="font-normal text-muted">· {dmy(bill.date)}</span>
                      {bill.kind === "purchase" ? <span className="ml-2 rounded bg-sand px-1.5 py-0.5 text-xs font-medium">Purchase</span> : null}
                      {isChallan ? <span className="ml-2 rounded bg-pine/15 px-1.5 py-0.5 text-xs font-medium text-pine">Challan{challanOf(bill.billNo)?.signature ? " · signed" : ""}</span> : null}
                      {bill.monthly ? <span className="ml-2 rounded bg-brand-soft px-1.5 py-0.5 text-xs font-medium text-brand">Monthly · {monthName(bill.monthly.month)}</span> : null}
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
                      <p className={cn("text-xs font-semibold", due > 0 ? "text-rust" : "text-pine")}>{due > 0 ? `${inr(due)} due` : STATUS_WORD.received}</p>
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
                  {canEdit && bill.monthly ? (
                    <button
                      type="button"
                      className="btn btn-ghost h-9 px-3 text-sm"
                      onClick={() => {
                        setConfirm(confirm === bill.billNo ? null : bill.billNo);
                        setReason("");
                      }}
                    >
                      Unbill
                    </button>
                  ) : null}
                  {canEdit && !bill.monthly ? (
                    <button type="button" className={cn("btn h-9 px-3 text-sm", isChallan ? "btn-pine" : "btn-ghost")} onClick={() => onEdit(bill)}>
                      {isChallan ? "Make bill" : "Edit"}
                    </button>
                  ) : null}
                  {isOwner && !bill.monthly ? (
                    <button
                      type="button"
                      className="btn btn-ghost h-9 px-3 text-sm text-rust"
                      onClick={() => {
                        setConfirm(confirm === bill.billNo ? null : bill.billNo);
                        setReason("");
                      }}
                    >
                      {isChallan ? "Cancel challan" : "Cancel bill"}
                    </button>
                  ) : null}
                </div>
                {confirm === bill.billNo && bill.monthly ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-line bg-sand p-3">
                    <p className="text-sm">
                      Unbilling takes the bill number off its {bill.entries.length} deliveries. They stay in the book with the same rates and count for {bill.company} as before, and you can make the monthly bill again with new rates or a new date. The old PDF goes to Recently deleted.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void doUnbill(bill)}>
                        {busy ? "Unbilling…" : `Unbill ${bill.billNo}`}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                        Keep bill
                      </button>
                    </div>
                  </div>
                ) : null}
                {confirm === bill.billNo && !bill.monthly ? (
                  <div className="mt-3 grid gap-2 rounded-lg border border-rust/40 bg-rust/5 p-3">
                    <p className="text-sm">
                      {isChallan
                        ? `Cancelling takes this challan's cylinders off ${bill.company}'s balance. Use it if the cylinders never went out.`
                        : `Cancelling takes this bill's cylinders and amount off ${bill.company}'s balance and makes a credit note. Payments already recorded stay, so money already received becomes a credit for the company.`}
                    </p>
                    <input className="field" value={reason} maxLength={300} onChange={(event) => setReason(event.target.value)} placeholder="Reason, e.g. wrong company or duplicate bill" aria-label="Reason for cancelling" />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void doCancel(bill)}>
                        {busy ? "Cancelling…" : isChallan ? "Cancel challan" : "Cancel bill and make credit note"}
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => setConfirm(null)}>
                        {isChallan ? "Keep challan" : "Keep bill"}
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

/** On-screen bill that mirrors the PDF layout (formal grid). */
export function BillPreview({ bill }: { bill: BillData }) {
  const { yard } = bill;
  const t = billTotals(bill);
  const sale = bill.kind === "sale";
  const ids = [yard.gst && `GSTIN: ${yard.gst}`, yard.pan && `PAN: ${yard.pan}`].filter(Boolean).join("   ");
  const lab = "text-[10px] font-bold uppercase tracking-[0.08em] text-[#555]";
  const cols = "grid grid-cols-[2.2rem_minmax(0,1fr)_2.6rem_5.5rem] @md:grid-cols-[2.6rem_minmax(0,1fr)_3rem_5.5rem_6.5rem]";
  const unit = `${t.quantity} cylinder${t.quantity === 1 ? "" : "s"}`;
  return (
    <article className="@container overflow-hidden border-[1.5px] border-[#1c1915] bg-white text-[12.5px] text-[#1c1915] shadow-sm">
      <p className="bg-[#1c1915] py-1.5 text-center text-[11px] font-bold tracking-[0.3em] text-white">{sale ? "BILL" : "PURCHASE BILL"}</p>
      <div className="relative border-b border-[#1c1915] px-3 py-3 text-center">
        {yard.logo ? <img src={yard.logo} alt="" className="absolute left-3 top-3 hidden h-10 w-auto max-w-[110px] object-contain @md:block" /> : null}
        <p className="text-lg font-bold uppercase tracking-wide @md:text-xl">{yard.name}</p>
        {yard.address ? <p className="mx-auto max-w-[26rem] text-balance">{yard.address.replace(/\s*\n\s*/g, ", ")}</p> : null}
        {yard.phone || yard.email ? (
          <p className="break-words">{[yard.phone && `Phone: ${yard.phone}`, yard.email && `Email: ${yard.email}`].filter(Boolean).join("  |  ")}</p>
        ) : null}
        {ids ? <p className="font-bold">{ids}</p> : null}
        {!yard.address && !yard.phone && !ids ? <p className="text-xs text-[#5e574d]">Add your letterhead in Settings.</p> : null}
      </div>
      <div className="grid border-b border-[#1c1915] @md:grid-cols-[55%_45%]">
        <div className="px-3 py-2.5">
          <p className={lab}>{sale ? "Bill to" : "Supplier"}</p>
          <p className="mt-1 break-words text-[15px] font-bold">{bill.company || "Company"}</p>
          {bill.companyPhone ? <p>Phone {bill.companyPhone}</p> : null}
        </div>
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-0.5 border-t border-[#1c1915] px-3 py-2.5 @md:border-l @md:border-t-0">
          <dt className="font-bold">Bill no.</dt>
          <dd className="whitespace-nowrap">{bill.billNo || "-"}</dd>
          <dt className="font-bold">Date</dt>
          <dd className="tabular-nums">{dmy(bill.date)}</dd>
          <dt className="font-bold">Payment</dt>
          <dd>{STATUS_WORD[bill.payment]}</dd>
        </dl>
      </div>
      <div className={cn(cols, "border-b border-[#1c1915] bg-[#eeeeee] text-[11px] font-bold [&>span]:px-2 [&>span]:py-1.5 [&>span+span]:border-l [&>span+span]:border-[#1c1915]")}>
        <span>S.No.</span>
        <span>Description of goods</span>
        <span className="text-right">Qty</span>
        <span className="hidden text-right @md:block">Rate (₹)</span>
        <span className="text-right">Amount (₹)</span>
      </div>
      <div className="min-h-32">
        {bill.lines.map((line, index) => (
          <div key={index} className={cn(cols, "[&>*]:px-2 [&>*]:py-2 [&>*+*]:border-l [&>*+*]:border-[#1c1915]", index > 0 && "border-t border-[#d0d0d0]")}>
            <span>{index + 1}</span>
            <div className="min-w-0">
              <p className="font-bold">{line.cylinderType || "Gas cylinders"}</p>
              <p className="mt-0.5 break-words text-[11px] text-[#5e574d]">{line.serials.length ? `Serial nos.: ${line.serials.join(", ")}` : "No serials yet"}</p>
              <p className="text-[11px] text-[#5e574d] @md:hidden">{line.price != null ? `@ ${inr(line.price)}` : ""}</p>
            </div>
            <span className="text-right tabular-nums">{line.quantity}</span>
            <span className="hidden text-right tabular-nums @md:block">{line.price != null ? inr(line.price) : "-"}</span>
            <span className="text-right font-bold tabular-nums">{line.price != null ? inr(lineAmount(line)) : "-"}</span>
          </div>
        ))}
      </div>
      <div className="grid border-t border-[#1c1915] @md:grid-cols-[1fr_15rem]">
        <div className="order-2 px-3 py-2.5 @md:order-1">
          <p className={lab}>Amount in words</p>
          <p className="mt-0.5 font-bold">{rupeesInWords(t.total)}</p>
          {bill.note.trim() ? (
            <>
              <p className={cn(lab, "mt-2.5")}>Notes</p>
              <p className="mt-0.5 whitespace-pre-wrap">{bill.note.trim()}</p>
            </>
          ) : null}
        </div>
        <dl className="order-1 grid grid-cols-[1fr_auto] border-b border-[#1c1915] tabular-nums @md:order-2 @md:border-b-0 @md:border-l [&>*]:border-b [&>*]:border-[#d0d0d0] [&>*]:px-3 [&>*]:py-1.5">
          <dt>Total ({unit})</dt>
          <dd className="text-right">{inr(t.subtotal)}</dd>
          {t.adjustment ? (
            <>
              <dt>{t.adjustment < 0 ? "Discount / round-off" : "Adjustment"}</dt>
              <dd className="text-right">
                {t.adjustment < 0 ? "- " : ""}
                {inr(Math.abs(t.adjustment))}
              </dd>
              <dt className="font-bold">Bill total</dt>
              <dd className="text-right font-bold">{inr(t.total)}</dd>
            </>
          ) : null}
          <dt>{sale ? "Received" : "Paid"}</dt>
          <dd className="text-right">{inr(t.paid)}</dd>
          <dt className="!border-0 bg-[#1c1915] font-bold text-white">Balance due</dt>
          <dd className="!border-0 bg-[#1c1915] text-right text-[14px] font-bold text-white">{inr(t.due)}</dd>
        </dl>
      </div>
      <div className="grid h-24 grid-cols-2 border-t border-[#1c1915] text-xs">
        <div className="flex flex-col justify-between px-3 py-2">
          <span className="text-[#5e574d]">{sale ? "Receiver's signature" : "Supplier's signature"}</span>
          <span className="truncate font-bold">{bill.company}</span>
        </div>
        <div className="flex flex-col justify-between border-l border-[#1c1915] px-3 py-2 text-right">
          <span className="truncate font-bold">For {yard.name}</span>
          <span className="text-[#5e574d]">Authorised signatory</span>
        </div>
      </div>
    </article>
  );
}
