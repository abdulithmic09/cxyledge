import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Search, Trash2 } from "lucide-react";
import { deletePayment, listCompanyMeta, saveDocument, type Entry, type Payment, type YardInfo } from "@/lib/inventory/api";
import { companyBalances } from "@/lib/inventory/analyse";
import { createHoldingCharge, deleteStockMove, getTracking, saveHoldTerms, saveStockMove, type StockMove, type StockMoveKind } from "@/lib/inventory/tracking";
import { cylinderIndex, cylinderStatus, holdingRows, WHERE_LABEL, yardStock, type CylinderEvent, type HoldRow } from "@/lib/inventory/stock";
import { blobToDataUrl, dmy, makeBillPdf, pdfName, type BillLine } from "@/lib/inventory/bill-pdf";
import { downloadBlob } from "@/lib/inventory/files";
import { rupee, splitSerials } from "@/lib/inventory/serials";
import { todayISO } from "@/lib/inventory/model";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { TypePicker } from "@/components/yard/type-picker";
import { Field, PageHead, Panel, Tally } from "@/components/yard/ui";
import { takeCylinderRequest } from "@/lib/inventory/nav-requests";

type Note = { tone: "ok" | "bad"; text: string } | null;

function StatusNote({ note }: { note: Note }) {
  if (!note) return null;
  return (
    <p className={cn("text-sm", note.tone === "ok" ? "text-pine" : "text-rust")} role="status">
      {note.text}
    </p>
  );
}

const EVENT_WORD: Record<CylinderEvent["kind"], string> = {
  delivery: "Delivered to",
  return: "Returned by",
  purchase: "Bought from",
  to_plant: "Sent to plant",
  from_plant: "Back full from plant",
};

/** Yard stock, refilling plant, cylinder lookup and holding charges. */
type StockTab = "plant" | "count" | "find" | "holding";
const STOCK_TABS: Array<{ id: StockTab; label: string }> = [
  { id: "plant", label: "Plant trips" },
  { id: "count", label: "Stock count" },
  { id: "find", label: "Find a cylinder" },
  { id: "holding", label: "Holding charges" },
];
let lastStockTab: StockTab = "plant";
let cylinderAsk: string | null = null;
const peekCylinder = () => {
  if (!cylinderAsk) cylinderAsk = takeCylinderRequest();
  return cylinderAsk;
};

export function StockView({ yard, entries, payments, onChanged }: { yard: YardInfo; entries: Entry[]; payments: Payment[]; onChanged: () => void }) {
  const client = useQueryClient();
  const tracking = useQuery({ queryKey: ["tracking"], queryFn: () => getTracking() });
  const moves = useMemo(() => tracking.data?.moves ?? [], [tracking.data]);
  const balances = useMemo(() => companyBalances(entries, payments), [entries, payments]);
  const rows = useMemo(() => yardStock(entries, moves, balances, yard.cylinderTypes), [entries, moves, balances, yard.cylinderTypes]);
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["tracking"] });
    onChanged();
  };
  const [tab, setTabState] = useState<StockTab>(() => (peekCylinder() ? "find" : lastStockTab));
  const [counting, setCounting] = useState(false);
  const setTab = (next: StockTab) => {
    lastStockTab = next;
    setTabState(next);
  };
  const totals = rows.reduce((sum, row) => ({ full: sum.full + row.full, empty: sum.empty + row.empty, plant: sum.plant + row.plant, customers: sum.customers + row.customers }), { full: 0, empty: 0, plant: 0, customers: 0 });

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Stock" detail="Cylinders at the yard, the plant and with customers" />
      <Tally
        items={[
          { label: "Full at yard", value: totals.full, tone: totals.full < 0 ? "rust" : undefined },
          { label: "Empty at yard", value: totals.empty, tone: totals.empty < 0 ? "rust" : undefined },
          { label: "At the plant", value: totals.plant },
          { label: "With customers", value: totals.customers },
        ]}
      />

      {counting ? (
        <CountWizard
          rows={rows}
          types={yard.cylinderTypes}
          onClose={() => setCounting(false)}
          onSaved={() => {
            setCounting(false);
            refresh();
          }}
        />
      ) : (
        <StockTable rows={rows} onCount={() => setCounting(true)} />
      )}

      <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Stock tasks">
        <div className="tabs">
          {STOCK_TABS.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      {tab === "plant" ? (
        <>
          <PlantPanel yard={yard} moves={moves} onSaved={refresh} />
          <MovesList moves={moves} onChanged={refresh} />
        </>
      ) : null}
      {tab === "count" ? <CountPanel yard={yard} onSaved={refresh} /> : null}
      {tab === "find" ? <FindCylinder entries={entries} moves={moves} /> : null}
      {tab === "holding" ? <HoldingPanel yard={yard} entries={entries} payments={payments} tracking={tracking.data} onChanged={refresh} /> : null}
    </div>
  );
}

function StockTable({ rows: all, onCount }: { rows: ReturnType<typeof yardStock>; onCount: () => void }) {
  const { canEdit } = useRole();
  const [showAll, setShowAll] = useState(false);
  const active = all.filter((row) => row.countedOn || row.full || row.empty || row.plant || row.customers);
  const rows = showAll || !active.length ? all : active;
  const uncounted = active.length === 0 || active.some((row) => !row.countedOn);
  return (
    <Panel title="By gas type">
      {uncounted ? (
        <div className="mb-3 flex flex-col gap-2 rounded-md border border-line bg-sand px-3 py-2.5 text-sm sm:flex-row sm:items-center">
          <p className="min-w-0 flex-1">
            {all.some((row) => row.full < 0 || row.empty < 0) ? "Numbers below zero mean the yard hasn't been counted yet. " : ""}
            Count it once; after that the book keeps it right.
          </p>
          {canEdit ? (
            <button type="button" className="btn btn-pine h-9 min-h-0 w-fit gap-1.5 px-3 text-sm" onClick={onCount}>
              <ClipboardCheck className="size-4" aria-hidden /> Start stock count
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="-mx-1 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-1 py-2 font-semibold">Gas type</th>
              <th className="px-1 py-2 text-right font-semibold">Full</th>
              <th className="px-1 py-2 text-right font-semibold">Empty</th>
              <th className="px-1 py-2 text-right font-semibold">Plant</th>
              <th className="px-1 py-2 text-right font-semibold" title="With customers">Out</th>
              <th className="px-1 py-2 text-right font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const total = row.full + row.empty + row.plant + row.customers;
              return (
                <tr key={row.type} className="border-b border-line/60">
                  <td className="px-1 py-2">
                    <span className="font-medium">{row.type}</span>
                    <span className="block text-xs text-muted">{row.countedOn ? `Counted ${dmy(row.countedOn)}` : "Not counted yet"}</span>
                  </td>
                  <td className={cn("px-1 py-2 text-right tabular-nums", row.full < 0 && "font-semibold text-rust")}>{row.full}</td>
                  <td className={cn("px-1 py-2 text-right tabular-nums", row.empty < 0 && "font-semibold text-rust")}>{row.empty}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{row.plant}</td>
                  <td className="px-1 py-2 text-right tabular-nums">{row.customers}</td>
                  <td className="px-1 py-2 text-right font-semibold tabular-nums">{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {all.length > active.length && active.length ? (
        <button type="button" className="btn btn-ghost mt-3 h-9 px-3 text-sm" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show only gas types in use" : `Show all ${all.length} gas types`}
        </button>
      ) : null}
      {rows.some((row) => row.full < 0 || row.empty < 0) ? <p className="mt-2 text-xs text-rust">Below zero: more went out than was counted in. Count that gas again.</p> : null}
    </Panel>
  );
}

function PlantPanel({ yard, moves, onSaved }: { yard: YardInfo; moves: StockMove[]; onSaved: () => void }) {
  const { canEdit } = useRole();
  const [kind, setKind] = useState<Exclude<StockMoveKind, "count">>("to_plant");
  const [plant, setPlant] = useState("");
  const [gasType, setGasType] = useState("");
  const [serials, setSerials] = useState("");
  const [qty, setQty] = useState("");
  const [challan, setChallan] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Note>(null);
  const plants = useMemo(() => [...new Set(moves.map((move) => move.plant).filter(Boolean))].sort(), [moves]);
  const counted = splitSerials(serials).length;

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveStockMove({ data: { kind, plant, gasType, serialNo: serials, quantity: Number(qty) || 0, fullCount: null, emptyCount: null, challanNo: challan, note, date } });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      setStatus({ tone: "ok", text: `${counted || qty} × ${gasType} ${kind === "to_plant" ? "sent to" : "back from"} ${plant}.` });
      setSerials("");
      setQty("");
      setChallan("");
      setNote("");
      onSaved();
    } catch {
      setStatus({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Refilling plant">
      {canEdit ? (
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            {(["to_plant", "from_plant"] as const).map((item) => (
              <button key={item} type="button" className={cn("btn text-sm", kind === item ? "btn-pine" : "btn-ghost")} onClick={() => setKind(item)}>
                {item === "to_plant" ? "Send empties" : "Fulls came back"}
              </button>
            ))}
          </div>
          <Field label="Plant">
            <input className="field" value={plant} list="plant-names" maxLength={120} onChange={(event) => setPlant(event.target.value)} placeholder="e.g. Bhosari Oxygen Plant" />
            <datalist id="plant-names">
              {plants.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
          <TypePicker value={gasType} types={yard.cylinderTypes} onChange={setGasType} />
          <Field label="Serial numbers" hint={counted ? `${counted} counted` : "Or leave empty and type how many below."}>
            <textarea className="field field-area min-h-20" value={serials} onChange={(event) => setSerials(event.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="How many">
              <input className={cn("field tabular-nums", counted && "bg-sand")} inputMode="numeric" readOnly={Boolean(counted)} value={counted ? String(counted) : qty} onChange={(event) => setQty(event.target.value.replace(/[^\d]/g, ""))} />
            </Field>
            <Field label="Date">
              <input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Challan no.">
              <input className="field" value={challan} maxLength={40} onChange={(event) => setChallan(event.target.value)} />
            </Field>
            <Field label="Note">
              <input className="field" value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          <StatusNote note={status} />
          <button type="button" className="btn btn-rust" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : kind === "to_plant" ? "Record empties sent" : "Record fulls received"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted">View-only access: you can see plant trips below but not add them.</p>
      )}
    </Panel>
  );
}

function CountPanel({ yard, onSaved }: { yard: YardInfo; onSaved: () => void }) {
  const { canEdit } = useRole();
  const [gasType, setGasType] = useState("");
  const [full, setFull] = useState("");
  const [empty, setEmpty] = useState("");
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Note>(null);

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveStockMove({
        data: { kind: "count", plant: "", gasType, serialNo: "", quantity: 0, fullCount: full === "" ? null : Number(full), emptyCount: empty === "" ? null : Number(empty), challanNo: "", note: "", date },
      });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      setStatus({ tone: "ok", text: `Count saved for ${gasType}.` });
      setFull("");
      setEmpty("");
      onSaved();
    } catch {
      setStatus({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Stock count">
      <p className="mb-3 text-sm text-muted">Count what is physically at the yard for one gas type. The yard numbers start again from this count.</p>
      {canEdit ? (
        <div className="grid gap-3">
          <TypePicker value={gasType} types={yard.cylinderTypes} onChange={setGasType} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Full">
              <input className="field tabular-nums" inputMode="numeric" value={full} onChange={(event) => setFull(event.target.value.replace(/[^\d]/g, ""))} />
            </Field>
            <Field label="Empty">
              <input className="field tabular-nums" inputMode="numeric" value={empty} onChange={(event) => setEmpty(event.target.value.replace(/[^\d]/g, ""))} />
            </Field>
            <div className="col-span-2 sm:col-span-1">
              <Field label="Date">
                <input type="date" className="field" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
            </div>
          </div>
          <StatusNote note={status} />
          <button type="button" className="btn btn-pine" disabled={busy || (!full && !empty)} onClick={() => void save()}>
            {busy ? "Saving…" : "Save count"}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

function FindCylinder({ entries, moves }: { entries: Entry[]; moves: StockMove[] }) {
  const [query, setQuery] = useState(() => {
    const asked = cylinderAsk ?? "";
    cylinderAsk = null;
    return asked;
  });
  const index = useMemo(() => cylinderIndex(entries, moves), [entries, moves]);
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => (q ? [...index.entries()].filter(([key]) => key.includes(q)).slice(0, 8) : []), [index, q]);
  const exact = q ? index.get(q) : undefined;
  const shown = exact ?? (matches.length === 1 ? matches[0]![1] : undefined);
  const status = shown ? cylinderStatus(shown.serial, shown.events) : null;

  return (
    <Panel title="Find a cylinder">
      <label className="relative block">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input className="field pl-9" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type a serial number, e.g. OX-1101" aria-label="Serial number" />
      </label>
      <p className="mt-2 text-xs text-muted">{index.size} cylinders with serial numbers in this book.</p>
      {!shown && matches.length > 1 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {matches.map(([key, slot]) => (
            <button key={key} type="button" className="btn btn-ghost h-9 px-3 text-sm" onClick={() => setQuery(slot.serial)}>
              {slot.serial}
            </button>
          ))}
        </div>
      ) : null}
      {q && !shown && !matches.length ? <p className="mt-3 text-sm text-muted">No cylinder with that serial yet.</p> : null}
      {status ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-[16rem_1fr]">
          <div className={cn("rounded-xl p-4", status.where === "customer" ? "bg-rust/10" : status.where === "plant" ? "bg-sand" : "bg-pine/10")}>
            <p className="text-lg font-semibold">{status.serial}</p>
            <p className="text-sm text-muted">{status.type}</p>
            <p className="mt-3 text-sm font-semibold">{WHERE_LABEL[status.where]}</p>
            {status.where === "customer" || status.where === "plant" ? <p className="text-sm">{status.party}</p> : null}
            <p className="mt-1 text-sm text-muted">
              Since {dmy(status.since)} · {status.days} day{status.days === 1 ? "" : "s"}
            </p>
          </div>
          <ol className="relative border-l border-line pl-4">
            {[...status.events].reverse().map((event) => (
              <li key={event.key} className="mb-3 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-rust" aria-hidden />
                <p className="text-sm">
                  <span className="font-medium">{EVENT_WORD[event.kind]}</span> {event.party}
                </p>
                <p className="text-xs text-muted">
                  {dmy(event.date)} · {event.type}
                  {event.ref ? ` · ${event.kind === "to_plant" || event.kind === "from_plant" ? "challan" : "bill"} ${event.ref}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </Panel>
  );
}

function HoldingPanel({
  yard,
  entries,
  payments,
  tracking,
  onChanged,
}: {
  yard: YardInfo;
  entries: Entry[];
  payments: Payment[];
  tracking: Awaited<ReturnType<typeof getTracking>> | undefined;
  onChanged: () => void;
}) {
  const { canEdit, isOwner } = useRole();
  const metaQuery = useQuery({ queryKey: ["company-meta"], queryFn: () => listCompanyMeta() });
  const rows = useMemo(() => holdingRows(entries, payments, tracking), [entries, payments, tracking]);
  const [free, setFree] = useState<string | null>(null);
  const [rate, setRate] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Note>(null);
  const terms = tracking?.terms ?? { freeDays: 30, rate: 0 };
  const charges = payments.filter((payment) => payment.direction === "charge");
  const totalDue = rows.reduce((sum, row) => sum + row.amount, 0);

  async function saveTerms(company?: string, next?: { freeDays: number | null; rate: number | null }) {
    setBusy(true);
    setStatus(null);
    try {
      const value = next ?? { freeDays: Number(free ?? terms.freeDays), rate: Number(rate ?? terms.rate) };
      const result = await saveHoldTerms({ data: { companyName: company, ...value } });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      setStatus({ tone: "ok", text: company ? `Terms saved for ${company}.` : "Holding charge terms saved." });
      setFree(null);
      setRate(null);
      onChanged();
    } catch {
      setStatus({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  async function bill(row: HoldRow) {
    setBusy(true);
    setStatus(null);
    try {
      const today = todayISO();
      const byType = new Map<string, { serials: string[]; days: number }>();
      for (const line of row.lines) {
        if (!line.chargeDays) continue;
        const slot = byType.get(line.type) ?? { serials: [], days: 0 };
        slot.days += line.chargeDays * line.qty;
        slot.serials.push(line.serial ? `${line.serial} (${line.chargeDays}d)` : `${line.qty} cyl. × ${line.chargeDays}d`);
        byType.set(line.type, slot);
      }
      const lines: BillLine[] = [...byType.entries()].map(([type, slot]) => ({ cylinderType: `Holding charges · ${type}`, serials: slot.serials, quantity: slot.days, price: row.terms.rate }));
      const phone = metaQuery.data?.find((meta) => meta.companyName === row.company)?.phone ?? "";
      const detail = `${row.overFree} cylinders · ${row.cylinderDays} days over ${row.terms.freeDays} free days · up to ${dmy(today)}`;
      const preview = { yard, kind: "sale" as const, date: today, company: row.company, companyPhone: phone, lines, total: row.amount, payment: "unpaid" as const, paid: null, note: `${row.terms.freeDays} free days, then ₹${row.terms.rate} per cylinder per day. ${row.lastBilled ? `Charged from ${dmy(row.lastBilled)}.` : ""}`, title: "HOLDING CHARGES", unit: "cylinder-day" };
      // Number comes from the server; make the PDF after it answers.
      const result = await createHoldingCharge({ data: { companyName: row.company, amount: row.amount, upTo: today, detail } });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      const pdf = await makeBillPdf({ ...preview, billNo: result.number });
      downloadBlob(pdfName(result.number, row.company), pdf);
      await saveDocument({ data: { companyName: row.company, title: pdfName(result.number, row.company), kind: "bill", mime: "application/pdf", content: await blobToDataUrl(pdf) } });
      setStatus({ tone: "ok", text: `${result.number}: ${rupee(row.amount)} added to ${row.company}'s balance. The PDF is in their files and was downloaded.` });
      onChanged();
    } catch {
      setStatus({ tone: "bad", text: "Couldn't bill. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Holding charges">
      <p className="text-sm text-muted">
        Cylinders kept longer than the free period are charged per cylinder per day. {terms.rate > 0 ? `Now: ${terms.freeDays} free days, then ${rupee(terms.rate)} per cylinder per day.` : "Charges are off until you set a daily rate."}
      </p>
      {isOwner ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Free days">
            <input className="field w-28 tabular-nums" inputMode="numeric" value={free ?? String(terms.freeDays)} onChange={(event) => setFree(event.target.value.replace(/[^\d]/g, ""))} />
          </Field>
          <Field label="₹ per cylinder per day">
            <input className="field w-36 tabular-nums" inputMode="decimal" value={rate ?? String(terms.rate)} onChange={(event) => setRate(event.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <button type="button" className="btn btn-pine" disabled={busy || (free == null && rate == null)} onClick={() => void saveTerms()}>
            Save terms
          </button>
        </div>
      ) : null}
      <StatusNote note={status} />
      {totalDue > 0 ? <p className="mt-3 text-sm font-semibold">Not billed yet: {rupee(totalDue)} across {rows.filter((row) => row.amount > 0).length} companies.</p> : null}
      <ul className="mt-3 divide-y divide-line">
        {rows.length === 0 ? <li className="py-3 text-sm text-muted">No cylinders are with customers right now.</li> : null}
        {rows.map((row) => (
          <li key={row.company} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button type="button" className="min-w-0 text-left" onClick={() => setOpen(open === row.company ? null : row.company)} aria-expanded={open === row.company}>
                <p className="font-semibold">{row.company}</p>
                <p className="text-xs text-muted">
                  {row.cylinders} out · {row.overFree} past {row.terms.freeDays} free days
                  {row.lastBilled ? ` · billed up to ${dmy(row.lastBilled)}` : ""}
                  {tracking?.companyTerms[row.company] ? " · own terms" : ""}
                </p>
              </button>
              <div className="text-right">
                <p className={cn("font-semibold tabular-nums", row.amount > 0 ? "text-rust" : "text-muted")}>{rupee(row.amount)}</p>
                <p className="text-xs text-muted">{row.cylinderDays} cylinder-days</p>
              </div>
            </div>
            {open === row.company ? (
              <div className="mt-3 grid gap-3 rounded-lg bg-paper/70 p-3">
                <ul className="grid gap-1 text-sm">
                  {row.lines.slice(0, 40).map((line, index) => (
                    <li key={`${line.serial ?? "q"}-${index}`} className="flex justify-between gap-2">
                      <span className="min-w-0 truncate">
                        {line.serial ?? `${line.qty} cylinders`} · {line.type}
                      </span>
                      <span className="shrink-0 tabular-nums text-muted">
                        since {dmy(line.since)} · {line.heldDays}d{line.chargeDays ? ` · ${line.chargeDays}d charged` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                {isOwner ? (
                  <CompanyTerms
                    company={row.company}
                    own={tracking?.companyTerms[row.company]}
                    busy={busy}
                    onSave={(next) => void saveTerms(row.company, next)}
                  />
                ) : null}
                {canEdit && row.amount > 0 ? (
                  <button type="button" className="btn btn-rust w-fit" disabled={busy} onClick={() => void bill(row)}>
                    Bill {rupee(row.amount)} holding charges
                  </button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {charges.length ? (
        <div className="mt-4 border-t border-line pt-3">
          <p className="text-sm font-semibold">Billed holding charges</p>
          <ul className="mt-2 grid gap-1 text-sm">
            {charges.slice(0, 20).map((charge) => (
              <li key={charge.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {charge.receiptNo} · {charge.companyName} · up to {dmy(charge.paidOn)}
                </span>
                <span className="flex items-center gap-2 tabular-nums">
                  {rupee(charge.amount)}
                  {isOwner ? (
                    <button
                      type="button"
                      className="grid size-8 place-items-center rounded-md text-muted hover:bg-sand hover:text-rust"
                      aria-label={`Remove ${charge.receiptNo}`}
                      onClick={() => void deletePayment({ data: charge.id }).then(() => onChanged())}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function CompanyTerms({ company, own, busy, onSave }: { company: string; own?: { freeDays?: number; rate?: number }; busy: boolean; onSave: (next: { freeDays: number | null; rate: number | null }) => void }) {
  const [free, setFree] = useState(own?.freeDays != null ? String(own.freeDays) : "");
  const [rate, setRate] = useState(own?.rate != null ? String(own.rate) : "");
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label={`Free days for ${company}`}>
        <input className="field w-28 tabular-nums" inputMode="numeric" placeholder="Book" value={free} onChange={(event) => setFree(event.target.value.replace(/[^\d]/g, ""))} />
      </Field>
      <Field label="₹ per day">
        <input className="field w-28 tabular-nums" inputMode="decimal" placeholder="Book" value={rate} onChange={(event) => setRate(event.target.value.replace(/[^\d.]/g, ""))} />
      </Field>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onSave({ freeDays: free === "" ? null : Number(free), rate: rate === "" ? null : Number(rate) })}>
        Save for this company
      </button>
    </div>
  );
}

function MovesList({ moves, onChanged }: { moves: StockMove[]; onChanged: () => void }) {
  const { isOwner } = useRole();
  const [limit, setLimit] = useState(15);
  if (!moves.length) return null;
  return (
    <Panel title="Plant trips and counts">
      <ul className="divide-y divide-line">
        {moves.slice(0, limit).map((move) => (
          <li key={move.id} className="flex items-start justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {move.kind === "count" ? `Count · ${move.gasType}` : `${move.kind === "to_plant" ? "Sent to" : "Back from"} ${move.plant}`}
              </p>
              <p className="text-xs text-muted">
                {dmy(move.date)}
                {move.kind === "count" ? ` · ${move.fullCount ?? "-"} full · ${move.emptyCount ?? "-"} empty` : ` · ${move.quantity} × ${move.gasType}`}
                {move.challanNo ? ` · challan ${move.challanNo}` : ""}
                {move.note ? ` · ${move.note}` : ""}
              </p>
            </div>
            {isOwner ? (
              <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sand hover:text-rust" aria-label="Remove this record" onClick={() => void deleteStockMove({ data: move.id }).then(onChanged)}>
                <Trash2 className="size-4" aria-hidden />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {moves.length > limit ? (
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => setLimit((value) => value + 30)}>
          Show more
        </button>
      ) : null}
    </Panel>
  );
}

/** One gas type at a time: how many full and empty cylinders are in the yard right now. */
function CountWizard({ rows, types, onClose, onSaved }: { rows: ReturnType<typeof yardStock>; types: string[]; onClose: () => void; onSaved: () => void }) {
  const active = rows.filter((row) => row.countedOn || row.full || row.empty || row.plant || row.customers).map((row) => row.type);
  const [list, setList] = useState<string[]>(() => (active.length ? active : types.slice(0, 6)));
  const [step, setStep] = useState(0);
  const [counts, setCounts] = useState<Record<string, { full: string; empty: string }>>({});
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);
  const date = todayISO();
  const done = step >= list.length;
  const type = list[step];
  const value = type ? (counts[type] ?? { full: "", empty: "" }) : { full: "", empty: "" };
  const filled = list.filter((item) => counts[item] && (counts[item]!.full !== "" || counts[item]!.empty !== ""));

  useEffect(() => {
    setNote(null);
  }, [step]);

  const set = (patch: Partial<{ full: string; empty: string }>) => type && setCounts({ ...counts, [type]: { ...value, ...patch } });

  async function saveAll() {
    setBusy(true);
    setNote(null);
    try {
      for (const item of filled) {
        const row = counts[item]!;
        const result = await saveStockMove({
          data: { kind: "count", plant: "", gasType: item, serialNo: "", quantity: 0, fullCount: row.full === "" ? 0 : Number(row.full), emptyCount: row.empty === "" ? 0 : Number(row.empty), challanNo: "", note: "Stock count", date },
        });
        if (!result.ok) {
          setNote({ tone: "bad", text: `${item}: ${result.error}` });
          return;
        }
      }
      onSaved();
    } catch {
      setNote({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Stock count">
      <div className="mb-3 flex items-center justify-between gap-2 text-sm text-muted">
        <span>{done ? "Check and save" : `Gas ${step + 1} of ${list.length}`} · {dmy(date)}</span>
        <button type="button" className="underline" onClick={onClose}>
          Cancel
        </button>
      </div>
      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-sand">
        <div className="h-full rounded-full bg-pine transition-all" style={{ width: `${Math.round((Math.min(step, list.length) / Math.max(1, list.length)) * 100)}%` }} />
      </div>
      {!done && type ? (
        <div className="grid gap-4">
          <div>
            <p className="text-lg font-semibold">{type}</p>
            <p className="text-sm text-muted">Count the cylinders standing in your yard right now. Leave a box empty if there are none.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Full">
              <input className="field text-center text-2xl tabular-nums" inputMode="numeric" autoFocus value={value.full} onChange={(event) => set({ full: event.target.value.replace(/[^\d]/g, "") })} placeholder="0" />
            </Field>
            <Field label="Empty">
              <input className="field text-center text-2xl tabular-nums" inputMode="numeric" value={value.empty} onChange={(event) => set({ empty: event.target.value.replace(/[^\d]/g, "") })} placeholder="0" />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            {step > 0 ? (
              <button type="button" className="btn btn-ghost" onClick={() => setStep(step - 1)}>
                Back
              </button>
            ) : null}
            <button type="button" className="btn btn-pine flex-1" onClick={() => setStep(step + 1)}>
              {value.full === "" && value.empty === "" ? "Skip this gas" : "Next"}
            </button>
          </div>
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-3">
            <div className="min-w-0 flex-1">
              <TypePicker value={adding} types={types} onChange={setAdding} />
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!adding || list.includes(adding)}
              onClick={() => {
                setList([...list, adding]);
                setAdding("");
              }}
            >
              Add this gas to the count
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {filled.length ? (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {filled.map((item) => (
                <li key={item} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="font-medium">{item}</span>
                  <span className="tabular-nums">
                    <span className="text-pine">{counts[item]!.full || 0} full</span> · {counts[item]!.empty || 0} empty
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing counted yet.</p>
          )}
          <StatusNote note={note} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={() => setStep(Math.max(0, list.length - 1))}>
              Back
            </button>
            <button type="button" className="btn btn-pine flex-1" disabled={busy || !filled.length} onClick={() => void saveAll()}>
              {busy ? "Saving…" : `Save count for ${filled.length} gas${filled.length === 1 ? "" : "es"}`}
            </button>
          </div>
        </div>
      )}
    </Panel>
  );
}
