import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { listCompanyMeta, type Entry, type PaymentStatus, type YardInfo } from "@/lib/inventory/api";
import { billPrefix, listCancelledBills, nextNumber, saveBill, type CancelledBill } from "@/lib/inventory/billing";
import { paymentLabel } from "@/lib/inventory/analyse";
import { rupee, splitSerials } from "@/lib/inventory/serials";
import { TypePicker } from "@/components/yard/type-picker";
import { csvBlob, downloadBlob, shareBlob, toCsv } from "@/lib/inventory/files";
import { blobToDataUrl, dmy, lineAmount, makeBillPdf, pdfName, printPdf, type BillData, type BillLine } from "@/lib/inventory/bill-pdf";
import { cn } from "@/lib/cn";
import { Field, Panel } from "@/components/yard/ui";
import { useRole } from "@/lib/inventory/role";
import { BillPreview, BillRegister, groupBills, type SavedBill } from "@/components/yard/bill-views";

type BillKind = "sale" | "purchase";

type LineState = {
  key: string;
  cylinderType: string;
  serialNo: string;
  qtyOverride: boolean;
  quantity: number;
  price: number | null;
  /** Where the price came from when it was filled in for you. */
  priceFrom: "" | "rate" | "last";
};

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

let lineSeq = 0;
function blankLine(cylinderType = ""): LineState {
  lineSeq += 1;
  return { key: `l${lineSeq}`, cylinderType, serialNo: "", qtyOverride: false, quantity: 0, price: null, priceFrom: "" };
}

function lineQty(line: LineState) {
  return line.qtyOverride ? line.quantity : splitSerials(line.serialNo).length;
}

function money(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function nextBillNo(entries: Entry[], cancelled: CancelledBill[], date: string) {
  return nextNumber([...entries.map((entry) => entry.billNo), ...cancelled.map((bill) => bill.billNo)], billPrefix(date));
}

export function BillsView({ yard, entries, onChanged }: { yard: YardInfo; entries: Entry[]; onChanged: () => void }) {
  const { canEdit, isOwner } = useRole();
  const [tab, setTab] = useState<"new" | "all">("new");
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });
  const cancelledQuery = useQuery({ queryKey: ["cancelled-bills"], queryFn: () => listCancelledBills() });
  const cancelled = useMemo(() => cancelledQuery.data ?? [], [cancelledQuery.data]);

  const [editing, setEditing] = useState<string | null>(null);
  const [kind, setKind] = useState<BillKind>("sale");
  const [date, setDate] = useState(todayISO);
  const [billNo, setBillNo] = useState("");
  const [billNoTouched, setBillNoTouched] = useState(false);
  const [company, setCompany] = useState("");
  const [lines, setLines] = useState<LineState[]>(() => [blankLine()]);
  const [finalAmount, setFinalAmount] = useState<number | null>(null);
  const [finalTouched, setFinalTouched] = useState(false);
  const [payment, setPayment] = useState<PaymentStatus>("unpaid");
  const [paid, setPaid] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [pending, setPending] = useState(false);
  const [exportNote, setExportNote] = useState("");

  // Keep the suggested bill number fresh until someone types their own.
  useEffect(() => {
    if (!editing && !billNoTouched) setBillNo(nextBillNo(entries, cancelled, date));
  }, [entries, cancelled, date, editing, billNoTouched]);

  const names = useMemo(() => [...new Set(entries.map((entry) => entry.companyName))].sort(), [entries]);
  const meta = metaQuery.data?.find((row) => row.companyName.toLowerCase() === company.trim().toLowerCase());
  const rates = meta?.prices ?? {};

  /** Latest price used for each company + gas type. */
  const lastPrices = useMemo(() => {
    const map = new Map<string, number>();
    const sorted = [...entries].sort((a, b) => a.entryDate.localeCompare(b.entryDate) || a.updatedAt.localeCompare(b.updatedAt));
    for (const entry of sorted) {
      if (entry.unitPrice == null || entry.movement === "return") continue;
      map.set(`${entry.companyName.toLowerCase()}|${entry.cylinderType.toLowerCase()}`, entry.unitPrice);
    }
    return map;
  }, [entries]);

  function suggestPrice(type: string, forCompany = company): { price: number | null; from: LineState["priceFrom"] } {
    if (!type.trim()) return { price: null, from: "" };
    const rowMeta = metaQuery.data?.find((row) => row.companyName.toLowerCase() === forCompany.trim().toLowerCase());
    const rate = Object.entries(rowMeta?.prices ?? {}).find(([key]) => key.toLowerCase() === type.toLowerCase())?.[1];
    if (rate != null) return { price: rate, from: "rate" };
    const last = lastPrices.get(`${forCompany.trim().toLowerCase()}|${type.toLowerCase()}`);
    if (last != null) return { price: last, from: "last" };
    return { price: null, from: "" };
  }

  function updateLine(key: string, patch: Partial<LineState>) {
    setLines((all) => all.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function setLineType(line: LineState, type: string) {
    const auto = line.price == null || line.priceFrom !== "";
    const hint = suggestPrice(type);
    updateLine(line.key, auto && hint.price != null ? { cylinderType: type, price: hint.price, priceFrom: hint.from } : { cylinderType: type });
  }

  function onCompany(value: string) {
    setCompany(value);
    // Refill prices that were filled in for you, using this company's rates.
    setLines((all) =>
      all.map((line) => {
        if (line.price != null && line.priceFrom === "") return line;
        const hint = suggestPrice(line.cylinderType, value);
        return hint.price != null ? { ...line, price: hint.price, priceFrom: hint.from } : { ...line, price: line.priceFrom ? null : line.price, priceFrom: "" };
      }),
    );
  }

  const billLines: BillLine[] = lines.map((line) => ({ cylinderType: line.cylinderType, serials: splitSerials(line.serialNo), quantity: lineQty(line), price: line.price }));
  const goods = billLines.some((line) => line.price != null) ? Math.round(billLines.reduce((sum, line) => sum + lineAmount(line), 0) * 100) / 100 : null;
  const total = finalTouched ? finalAmount : goods;
  const bill: BillData = {
    yard,
    kind,
    billNo,
    date,
    company: company.trim() || "Company",
    companyPhone: meta?.phone ?? "",
    lines: billLines,
    total,
    payment,
    paid,
    note,
  };
  const fileName = pdfName(billNo, company);
  const csv = toCsv(
    ["Bill", "Date", "Kind", "Company", "Gas type", "Serials", "Qty", "Price", "Amount"],
    billLines.map((line) => [billNo, dmy(date), kind, company, line.cylinderType, line.serials.join(" "), String(line.quantity), line.price == null ? "" : String(line.price), line.price == null ? "" : String(lineAmount(line))]),
  );

  function resetForm() {
    setEditing(null);
    setBillNoTouched(false);
    setLines([blankLine()]);
    setFinalAmount(null);
    setFinalTouched(false);
    setPaid(null);
    setPayment("unpaid");
    setNote("");
  }

  function loadBill(savedBill: SavedBill) {
    setTab("new");
    setEditing(savedBill.billNo);
    setBillNoTouched(true);
    setKind(savedBill.kind);
    setDate(savedBill.date);
    setBillNo(savedBill.billNo);
    setCompany(savedBill.company);
    setLines(
      savedBill.entries.map((entry) => {
        const line = blankLine(entry.cylinderType);
        const serials = splitSerials(entry.serialNo);
        return { ...line, serialNo: serials.join("\n"), qtyOverride: serials.length !== entry.quantity, quantity: entry.quantity, price: entry.unitPrice };
      }),
    );
    const sum = Math.round(savedBill.lines.reduce((acc, line) => acc + lineAmount(line), 0) * 100) / 100;
    const differs = savedBill.total != null && Math.abs(savedBill.total - sum) > 0.004;
    setFinalTouched(differs);
    setFinalAmount(differs ? savedBill.total : null);
    setPayment(savedBill.payment);
    setPaid(savedBill.paid);
    setNote(savedBill.note);
    setError("");
    setSaved("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save() {
    setError("");
    setSaved("");
    if (!company.trim()) {
      setError("Enter the company name.");
      return;
    }
    setPending(true);
    try {
      const pdf = await blobToDataUrl(await makeBillPdf(bill));
      const result = await saveBill({
        data: {
          originalBillNo: editing ?? "",
          kind,
          billNo,
          date,
          company,
          lines: lines.map((line) => ({ cylinderType: line.cylinderType, serialNo: line.serialNo, quantity: lineQty(line), qtyOverride: line.qtyOverride, unitPrice: line.price })),
          total,
          payment,
          paid,
          note,
          pdf,
        },
      });
      if (!result.ok) {
        setError(result.error);
        if ("suggestion" in result && result.suggestion) {
          setBillNo(result.suggestion);
          setBillNoTouched(true);
        }
        return;
      }
      setSaved(editing ? `Bill ${billNo} updated. The new PDF is in ${company.trim()}'s files.` : `Bill ${billNo} saved in the book and in ${company.trim()}'s files.`);
      resetForm();
      onChanged();
    } catch {
      setError("Could not save. Check your internet connection.");
    } finally {
      setPending(false);
    }
  }

  const bills = useMemo(() => groupBills(entries), [entries]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-3xl">Bills</h2>
          <p className="mt-1 text-sm text-muted">Sale and purchase bills on your letterhead, numbered by financial year and kept in each company&apos;s files.</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-card p-1" role="tablist">
          {(["new", "all"] as const).map((item) => (
            <button key={item} type="button" role="tab" aria-selected={tab === item} className={cn("btn h-9 px-4 text-sm", tab === item ? "btn-pine" : "")} onClick={() => setTab(item)}>
              {item === "new" ? (editing ? "Edit bill" : "New bill") : `All bills (${bills.length})`}
            </button>
          ))}
        </div>
      </div>

      {tab === "all" ? (
        <BillRegister
          yard={yard}
          bills={bills}
          cancelled={cancelled}
          metaPhone={(name) => metaQuery.data?.find((row) => row.companyName === name)?.phone ?? ""}
          canEdit={canEdit}
          isOwner={isOwner}
          onEdit={loadBill}
          onChanged={() => {
            void cancelledQuery.refetch();
            onChanged();
          }}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={editing ? `Editing bill ${editing}` : "New bill"}>
            <div className="grid gap-3">
              {editing ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sand px-3 py-2 text-sm">
                  <span>Saving replaces the old lines and PDF of this bill.</span>
                  <button type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => resetForm()}>
                    Stop editing
                  </button>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {(["sale", "purchase"] as const).map((item) => (
                  <button key={item} type="button" className={cn("btn", kind === item ? "btn-pine" : "btn-ghost")} onClick={() => setKind(item)}>
                    {item === "sale" ? "Sale" : "Purchase"}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Bill number" hint={`${billPrefix(date)}… starts again every April`}>
                  <input
                    className="field"
                    value={billNo}
                    maxLength={40}
                    onChange={(event) => {
                      setBillNo(event.target.value);
                      setBillNoTouched(true);
                    }}
                  />
                </Field>
                <Field label="Date">
                  <input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} />
                </Field>
              </div>
              <Field label="Company">
                <input className="field" value={company} list="bill-companies" onChange={(event) => onCompany(event.target.value)} placeholder="Sharma Stores" />
                <datalist id="bill-companies">
                  {names.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </Field>
              {company.trim() && Object.keys(rates).length ? <p className="-mt-1 text-xs text-pine">{Object.keys(rates).length} rates saved for this company. Prices fill in by themselves.</p> : null}

              <div className="flex flex-col gap-3">
                {lines.map((line, index) => (
                  <LineEditor
                    key={line.key}
                    index={index}
                    count={lines.length}
                    line={line}
                    types={yard.cylinderTypes}
                    onType={(type) => setLineType(line, type)}
                    onChange={(patch) => updateLine(line.key, patch)}
                    onRemove={() => setLines((all) => all.filter((item) => item.key !== line.key))}
                  />
                ))}
                {lines.length < 25 ? (
                  <button type="button" className="btn btn-soft justify-center gap-2" onClick={() => setLines((all) => [...all, blankLine()])}>
                    <Plus className="size-4" aria-hidden /> Add another gas
                  </button>
                ) : null}
              </div>

              <p className="text-sm">
                Subtotal <span className="font-semibold tabular-nums">{rupee(goods)}</span>
                <span className="text-muted"> · {billLines.reduce((sum, line) => sum + line.quantity, 0)} cylinders</span>
              </p>
              <Field label="Final amount (₹)" hint={finalTouched ? "Changed by hand. The difference shows on the bill as a discount or adjustment." : "Follows the subtotal. Change it for a discount or round-off."}>
                <div className="flex gap-2">
                  <input
                    className="field tabular-nums"
                    inputMode="decimal"
                    value={total ?? ""}
                    onChange={(event) => {
                      setFinalTouched(true);
                      setFinalAmount(money(event.target.value));
                    }}
                  />
                  {finalTouched ? (
                    <button type="button" className="btn btn-ghost shrink-0 px-3 text-sm" onClick={() => setFinalTouched(false)}>
                      Use subtotal
                    </button>
                  ) : null}
                </div>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                {(["received", "partial", "unpaid"] as const).map((item) => (
                  <button key={item} type="button" className={cn("btn px-2 text-xs", payment === item ? "btn-pine" : "btn-ghost")} onClick={() => setPayment(item)}>
                    {paymentLabel(item)}
                  </button>
                ))}
              </div>
              <Field label="Amount received (₹)">
                <input className="field tabular-nums" inputMode="decimal" value={paid ?? ""} onChange={(event) => setPaid(money(event.target.value))} />
              </Field>
              <Field label="Notes">
                <input className="field" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
              </Field>
              {error ? <p className="text-sm text-rust">{error}</p> : null}
              {saved ? <p className="text-sm text-pine">{saved}</p> : null}
              {canEdit ? (
                <button type="button" className="btn btn-rust" disabled={pending} onClick={() => void save()}>
                  {pending ? "Saving…" : editing ? "Save changes" : "Save bill"}
                </button>
              ) : (
                <p className="text-sm text-muted">View-only access: you can preview and print bills, but not save them.</p>
              )}
            </div>
          </Panel>
          <Panel title="Preview">
            <BillPreview bill={bill} />
            <ExportButtons onPdf={() => makeBillPdf(bill)} fileName={fileName} shareTitle={`${billNo} · ${yard.name}`} csv={csv} note={exportNote} setNote={setExportNote} />
          </Panel>
        </div>
      )}
    </div>
  );
}

function LineEditor({
  index,
  count,
  line,
  types,
  onType,
  onChange,
  onRemove,
}: {
  index: number;
  count: number;
  line: LineState;
  types: string[];
  onType: (type: string) => void;
  onChange: (patch: Partial<LineState>) => void;
  onRemove: () => void;
}) {
  const serials = splitSerials(line.serialNo);
  const qty = lineQty(line);
  return (
    <div className={cn("grid gap-3", count > 1 && "rounded-xl border border-line bg-paper/60 p-3")}>
      {count > 1 ? (
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-rust">Gas {index + 1}</span>
          <button type="button" className="grid size-9 place-items-center rounded-lg text-muted hover:bg-sand hover:text-rust" aria-label={`Remove gas ${index + 1}`} onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
      <TypePicker value={line.cylinderType} types={types} onChange={onType} />
      <Field label="Serial numbers" hint={serials.length ? `${serials.length} counted` : "The quantity follows these serials."}>
        <textarea className="field field-area min-h-20" value={line.serialNo} onChange={(event) => onChange({ serialNo: event.target.value })} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cylinders">
          <input
            className={cn("field tabular-nums", !line.qtyOverride && "bg-sand")}
            readOnly={!line.qtyOverride}
            inputMode="numeric"
            value={String(qty)}
            onChange={(event) => onChange({ quantity: Number(event.target.value.replace(/[^\d]/g, "") || "0") })}
          />
        </Field>
        <Field label="Price each (₹)">
          <input className="field tabular-nums" inputMode="decimal" value={line.price ?? ""} onChange={(event) => onChange({ price: money(event.target.value), priceFrom: "" })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-muted">
          <input
            type="checkbox"
            className="size-4 accent-[var(--color-pine)]"
            checked={line.qtyOverride}
            onChange={(event) => onChange({ qtyOverride: event.target.checked, quantity: event.target.checked ? qty || 1 : line.quantity })}
          />
          Type the quantity myself
        </label>
        <span className={cn(line.priceFrom ? "text-pine" : "text-muted")}>
          {line.priceFrom === "rate" ? "Price from this company's rates" : line.priceFrom === "last" ? "Last price used for this company" : line.price != null ? `Line ${rupee(Math.round(qty * line.price * 100) / 100)}` : ""}
        </span>
      </div>
    </div>
  );
}

export function ExportButtons({
  onPdf,
  fileName,
  shareTitle,
  csv,
  note,
  setNote,
}: {
  onPdf: () => Promise<Blob>;
  fileName: string;
  shareTitle: string;
  csv?: string;
  note: string;
  setNote: (note: string) => void;
}) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-pine"
          onClick={() =>
            void onPdf().then((pdf) => {
              downloadBlob(fileName, pdf);
              setNote("PDF saved.");
            })
          }
        >
          Download PDF
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => void onPdf().then((pdf) => shareBlob(fileName, pdf, shareTitle)).then((result) => setNote(result === "shared" ? "Share sheet opened." : "PDF saved on this device."))}
        >
          Share
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => void onPdf().then((pdf) => setNote(printPdf(pdf) ? "Print dialog opened." : "Allow pop-ups to print, or download the PDF instead."))}>
          Print
        </button>
        {csv ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              downloadBlob(fileName.replace(/\.pdf$/, ".csv"), csvBlob(csv));
              setNote("Spreadsheet saved.");
            }}
          >
            Spreadsheet
          </button>
        ) : null}
      </div>
      {note ? (
        <p className="text-sm text-muted" role="status">
          {note}
        </p>
      ) : null}
    </div>
  );
}

