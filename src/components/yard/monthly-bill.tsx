import { useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import type { CompanyMeta, Entry, PaymentStatus, YardInfo } from "@/lib/inventory/api";
import { billPrefix, makeMonthlyBill, nextNumber, undoMonthlyBill, type CancelledBill } from "@/lib/inventory/billing";
import { blobToDataUrl, dmy, makeBillPdf, pdfName, type BillData } from "@/lib/inventory/bill-pdf";
import { rupee, splitSerials } from "@/lib/inventory/serials";
import { BillPreview } from "@/components/yard/bill-views";
import { ExportButtons } from "@/components/yard/bills";
import { offerUndo } from "@/components/yard/entry-launcher";
import { Field, Panel } from "@/components/yard/ui";
import { cn } from "@/lib/cn";

const norm = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

function todayISO() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Early in a month you're usually billing the month that just ended. */
function defaultMonth() {
  const date = new Date();
  if (date.getDate() <= 10) date.setMonth(date.getMonth() - 1, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y!, m!, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

function monthName(month: string) {
  const [y, m] = month.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

type GasRow = { type: string; deliveries: number; quantity: number; serials: string[]; suggested: number | null; from: "rate" | "lines" | "last" | "" };

let pendingCompany: string | null = null;
/** Open the Monthly bill tab for a company (from the company page). */
export function requestMonthlyBill(company: string) {
  pendingCompany = company;
}
export function takeMonthlyRequest() {
  const value = pendingCompany;
  pendingCompany = null;
  return value;
}

export function MonthlyBill({
  yard,
  entries,
  meta,
  cancelled,
  initialCompany,
  onChanged,
}: {
  yard: YardInfo;
  entries: Entry[];
  meta: CompanyMeta[];
  cancelled: CancelledBill[];
  initialCompany?: string | null;
  onChanged: () => void;
}) {
  const [company, setCompany] = useState(initialCompany ?? "");
  const [month, setMonth] = useState(defaultMonth);
  const [date, setDate] = useState(() => {
    const end = monthEnd(defaultMonth());
    const today = todayISO();
    return end < today ? end : today;
  });
  const [dateTouched, setDateTouched] = useState(false);
  const [billNo, setBillNo] = useState("");
  const [billNoTouched, setBillNoTouched] = useState(false);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<BillData | null>(null);
  const [exportNote, setExportNote] = useState("");
  const [showPreview, setShowPreview] = useState(false);

  // Bill date follows the month (its last day, or today if the month isn't over) until it's changed by hand.
  useEffect(() => {
    if (dateTouched) return;
    const end = monthEnd(month);
    const today = todayISO();
    setDate(end < today ? end : today);
  }, [month, dateTouched]);

  useEffect(() => {
    if (!billNoTouched) setBillNo(nextNumber([...entries.map((entry) => entry.billNo), ...cancelled.map((bill) => bill.billNo)], billPrefix(date)));
  }, [entries, cancelled, date, billNoTouched]);

  const inMonth = (entry: Entry) => entry.entryDate.slice(0, 7) === month;
  const deliveries = useMemo(
    () => entries.filter((entry) => entry.movement === "delivery" && !entry.parentId && norm(entry.companyName) === norm(company) && inMonth(entry)).sort((a, b) => a.entryDate.localeCompare(b.entryDate)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, company, month],
  );
  const open = deliveries.filter((entry) => !entry.billNo);
  const alreadyBilled = deliveries.filter((entry) => entry.billNo);
  const companyName = open[0]?.companyName ?? company.trim();

  // Customers with something to bill in this month come first in the list.
  const names = useMemo(() => {
    const due = new Set(entries.filter((entry) => entry.movement === "delivery" && !entry.billNo && !entry.parentId && inMonth(entry)).map((entry) => entry.companyName));
    const all = [...new Set(entries.filter((entry) => entry.movement === "delivery").map((entry) => entry.companyName))];
    return [...all.filter((name) => due.has(name)).sort(), ...all.filter((name) => !due.has(name)).sort()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, month]);

  const companyRates = meta.find((row) => norm(row.companyName) === norm(company))?.prices ?? {};

  const gases: GasRow[] = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of open) {
      const type = entry.cylinderType.trim() || "Cylinders";
      map.set(type, [...(map.get(type) ?? []), entry]);
    }
    return [...map.entries()].map(([type, list]) => {
      const rate = Object.entries(companyRates).find(([key]) => norm(key) === norm(type))?.[1];
      const prices = list.map((entry) => entry.unitPrice).filter((value): value is number => value != null);
      const common = prices.length ? [...prices].sort((a, b) => prices.filter((p) => p === b).length - prices.filter((p) => p === a).length)[0]! : null;
      return {
        type,
        deliveries: list.length,
        quantity: list.reduce((sum, entry) => sum + entry.quantity, 0),
        serials: list.flatMap((entry) => splitSerials(entry.serialNo)),
        suggested: rate ?? common,
        from: rate != null ? "rate" : common != null ? "lines" : "",
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(companyRates)]);

  const priceOf = (gas: GasRow) => {
    const typed = rates[gas.type];
    if (typed != null && typed.trim() !== "") return Number(typed.replace(/[^\d.]/g, "")) || 0;
    return gas.suggested;
  };
  const total = gases.reduce((sum, gas) => sum + (priceOf(gas) ?? 0) * gas.quantity, 0);
  const paid = open.reduce((sum, entry) => sum + (entry.amountPaid ?? 0), 0);
  const payment: PaymentStatus = total > 0 && paid >= total - 0.004 ? "received" : paid > 0 ? "partial" : "unpaid";
  const missingRate = gases.some((gas) => priceOf(gas) == null);
  const range = open.length ? `${dmy(open[0]!.entryDate)} to ${dmy(open[open.length - 1]!.entryDate)}` : "";

  const bill: BillData = {
    yard,
    kind: "sale",
    billNo,
    date,
    company: companyName || "Company",
    companyPhone: meta.find((row) => norm(row.companyName) === norm(company))?.phone ?? "",
    lines: gases.map((gas) => ({ cylinderType: gas.type, serials: gas.serials, quantity: gas.quantity, price: priceOf(gas) })),
    total: null,
    payment,
    paid: paid || null,
    annex: open.map((entry) => ({ date: entry.entryDate, gas: entry.cylinderType || "Cylinders", quantity: entry.quantity, serials: splitSerials(entry.serialNo) })),
    note: [`Cylinders supplied in ${monthName(month)}: ${open.length} ${open.length === 1 ? "delivery" : "deliveries"}${range ? `, ${range}` : ""}.`, note.trim()].filter(Boolean).join(" "),
  };

  async function make() {
    setError("");
    if (!company.trim()) return setError("Pick the company.");
    if (!open.length) return setError(`No unbilled deliveries for ${company.trim()} in ${monthName(month)}.`);
    if (missingRate) return setError("Enter a rate for every gas.");
    setBusy(true);
    try {
      const pdf = await blobToDataUrl(await makeBillPdf(bill));
      const result = await makeMonthlyBill({
        data: {
          company: companyName,
          month,
          billNo,
          date,
          ids: open.map((entry) => entry.id),
          rates: Object.fromEntries(gases.map((gas) => [gas.type, priceOf(gas)])),
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
      setDone(bill);
      const before = result.before;
      offerUndo({
        text: `Monthly bill ${result.billNo} made: ${result.quantity} cylinders, ${rupee(result.total, 0)}.`,
        revert: () => undoMonthlyBill({ data: { billNo: result.billNo, before } }),
        doneText: `Bill ${result.billNo} undone. Those deliveries are unbilled again.`,
      });
      onChanged();
    } catch {
      setError("Couldn't make the bill. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Panel title={`Bill ${done.billNo} made`}>
          <p className="text-sm">
            {done.company}, {monthName(month)}: {done.lines.reduce((sum, line) => sum + line.quantity, 0)} cylinders,{" "}
            <span className="font-semibold">{rupee(done.lines.reduce((sum, line) => sum + (line.price ?? 0) * line.quantity, 0), 0)}</span>. The deliveries now carry this bill number, and the PDF is in {done.company}&apos;s files.
          </p>
          <ExportButtons onPdf={() => makeBillPdf(done)} fileName={pdfName(done.billNo, done.company)} shareTitle={`Bill ${done.billNo}`} note={exportNote} setNote={setExportNote} />
          <button
            type="button"
            className="btn btn-ghost mt-3"
            onClick={() => {
              setDone(null);
              setCompany("");
              setRates({});
              setNote("");
              setBillNoTouched(false);
              setExportNote("");
            }}
          >
            Make another monthly bill
          </button>
        </Panel>
        <div className="lg:sticky lg:top-20">
          <BillPreview bill={done} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <Panel title="Monthly bill">
        <p className="-mt-1 mb-3 text-sm text-muted">One bill for everything a customer took in a month, one line per gas. Deliveries that already have a bill are left out. The PDF ends with a delivery list showing every date and serial number.</p>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company">
              <input className="field" list="monthly-names" value={company} placeholder="Choose a customer" onChange={(event) => setCompany(event.target.value)} />
              <datalist id="monthly-names">
                {names.map((name) => (
                  <option key={name} value={name} />
                ))}
              </datalist>
            </Field>
            <Field label="Month">
              <input className="field" type="month" value={month} max={todayISO().slice(0, 7)} onChange={(event) => event.target.value && setMonth(event.target.value)} />
            </Field>
          </div>

          {company.trim() ? (
            open.length ? (
              <>
                <p className="flex items-start gap-2 rounded-lg bg-sand px-3 py-2 text-sm">
                  <CalendarRange className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                  <span>
                    <span className="font-semibold">{open.length}</span> {open.length === 1 ? "delivery" : "deliveries"} not billed yet ({range}).
                    {alreadyBilled.length ? ` ${alreadyBilled.length} already on a bill, left out.` : ""}
                  </span>
                </p>
                <div className="overflow-hidden rounded-xl border border-line">
                  <div className="grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem] gap-2 border-b border-line bg-sand/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-muted sm:grid-cols-[minmax(0,1fr)_4rem_7rem_6rem]">
                    <span>Gas</span>
                    <span className="text-right">Cyl.</span>
                    <span className="text-right">Rate (₹)</span>
                    <span className="hidden text-right sm:block">Amount</span>
                  </div>
                  {gases.map((gas) => {
                    const price = priceOf(gas);
                    return (
                      <div key={gas.type} className="grid grid-cols-[minmax(0,1fr)_3.5rem_6.5rem] items-center gap-2 border-b border-line px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_4rem_7rem_6rem]">
                        <span className="min-w-0">
                          <span className="block font-semibold leading-snug">{gas.type}</span>
                          <span className="block text-xs text-muted">
                            {gas.deliveries} {gas.deliveries === 1 ? "delivery" : "deliveries"}
                            {gas.from === "rate" && rates[gas.type] == null ? " · from rates" : gas.from === "lines" && rates[gas.type] == null ? " · price used on them" : ""}
                          </span>
                        </span>
                        <span className="text-right tabular-nums">{gas.quantity}</span>
                        <input
                          className={cn("field h-10 text-right tabular-nums", price == null && "ring-2 ring-rust/40")}
                          inputMode="decimal"
                          aria-label={`Rate for ${gas.type}`}
                          value={rates[gas.type] ?? (gas.suggested ?? "")}
                          placeholder="Rate"
                          onChange={(event) => setRates({ ...rates, [gas.type]: event.target.value })}
                        />
                        <span className="hidden text-right tabular-nums sm:block">{price == null ? "—" : rupee(price * gas.quantity, 0)}</span>
                      </div>
                    );
                  })}
                  <div className="flex items-baseline justify-between gap-3 bg-sand/60 px-3 py-2.5">
                    <span className="text-sm text-muted">
                      Total · {gases.reduce((sum, gas) => sum + gas.quantity, 0)} cylinders
                      {paid ? ` · ${rupee(paid, 0)} already received` : ""}
                    </span>
                    <span className="font-display text-xl tabular-nums">{rupee(total, 0)}</span>
                  </div>
                </div>
                <details className="text-sm">
                  <summary className="cursor-pointer font-semibold text-pine">See the {open.length} deliveries</summary>
                  <ul className="mt-2 divide-y divide-line rounded-lg border border-line">
                    {open.map((entry) => (
                      <li key={entry.id} className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5">
                        <span>
                          {dmy(entry.entryDate)} · {entry.quantity} × {entry.cylinderType || "cylinders"}
                        </span>
                        <span className="code text-xs text-muted">{splitSerials(entry.serialNo).join(", ")}</span>
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Bill number">
                    <input
                      className="field code"
                      value={billNo}
                      maxLength={40}
                      onChange={(event) => {
                        setBillNo(event.target.value);
                        setBillNoTouched(true);
                      }}
                    />
                  </Field>
                  <Field label="Bill date">
                    <input
                      className="field"
                      type="date"
                      value={date}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        setDate(event.target.value);
                        setDateTouched(true);
                      }}
                    />
                  </Field>
                </div>
                <Field label="Note (optional)">
                  <input className="field" value={note} maxLength={200} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Please pay within 30 days" />
                </Field>
              </>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-3 py-4 text-center text-sm text-muted">
                No unbilled deliveries for {company.trim()} in {monthName(month)}.
                {alreadyBilled.length ? ` ${alreadyBilled.length} ${alreadyBilled.length === 1 ? "is" : "are"} already on a bill.` : ""}
              </p>
            )
          ) : null}

          {error ? <p className="text-sm text-rust">{error}</p> : null}
          {company.trim() && open.length ? (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
              <button type="button" className="btn btn-ghost lg:hidden" onClick={() => setShowPreview(!showPreview)}>
                {showPreview ? "Hide preview" : "Preview"}
              </button>
              <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void make()}>
                {busy ? "Making…" : "Make monthly bill"}
              </button>
            </div>
          ) : null}
        </div>
      </Panel>
      {company.trim() && open.length ? (
        <div className={cn("lg:sticky lg:top-20 lg:block", showPreview ? "block" : "hidden")}>
          <BillPreview bill={bill} />
        </div>
      ) : null}
    </div>
  );
}
