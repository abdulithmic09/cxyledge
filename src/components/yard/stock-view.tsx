import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, ClipboardCheck, Search, Trash2 } from "lucide-react";
import { deletePayment, listCompanyMeta, saveDocument, type Entry, type Payment, type YardInfo } from "@/lib/inventory/api";
import { companyBalances, type CompanyBalance } from "@/lib/inventory/analyse";
import { createHoldingCharge, deleteStockMove, getTracking, saveHoldTerms, saveStockMove, type StockMove, type StockMoveKind } from "@/lib/inventory/tracking";
import { cylinderIndex, cylinderStatus, holdingRows, WHERE_LABEL, yardStock, type CylinderEvent, type HoldRow } from "@/lib/inventory/stock";
import { blobToDataUrl, dmy, makeBillPdf, pdfName, type BillLine } from "@/lib/inventory/bill-pdf";
import { downloadBlob } from "@/lib/inventory/files";
import { rupee, splitSerials } from "@/lib/inventory/serials";
import { formatDay, todayISO } from "@/lib/inventory/model";
import { useRole } from "@/lib/inventory/role";
import { cn } from "@/lib/cn";
import { TypePicker } from "@/components/yard/type-picker";
import { Field, PageHead, Panel, Tally } from "@/components/yard/ui";
import { takeCylinderRequest } from "@/lib/inventory/nav-requests";
import { offerUndo, openEntrySheet } from "@/components/yard/entry-launcher";
import type { UndoTarget } from "@/lib/inventory/entry-actions";

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

/** Stock: what you have, find a cylinder, holding charges. Plant trips and hand counts sit under "More". */
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
  const { canEdit } = useRole();
  const [counting, setCounting] = useState(false);
  const [more, setMore] = useState(false);
  peekCylinder();
  const active = rows.filter((row) => row.countedOn || row.full || row.empty || row.plant || row.customers);
  const needsCount = active.some((row) => !row.countedOn || row.full < 0 || row.empty < 0);
  const totals = active.reduce((sum, row) => ({ full: sum.full + Math.max(0, row.full), empty: sum.empty + Math.max(0, row.empty), plant: sum.plant + row.plant, customers: sum.customers + row.customers }), { full: 0, empty: 0, plant: 0, customers: 0 });

  return (
    <div className="flex flex-col gap-3">
      <PageHead
        title="Stock"
        detail="What you have right now"
        action={
          canEdit && !counting ? (
            <button type="button" className="btn btn-pine gap-1.5" onClick={() => setCounting(true)}>
              <ClipboardCheck className="size-4" aria-hidden /> Count stock
            </button>
          ) : undefined
        }
      />

      <FindCylinder entries={entries} moves={moves} />

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
        <>
          <Tally
            items={[
              { label: "Full", value: totals.full, tone: "pine" },
              { label: "Empty", value: totals.empty },
              { label: "Customers", value: totals.customers, tone: "rust" },
            ]}
          />
          {needsCount && canEdit ? (
            <button type="button" className="card flex items-center gap-3 px-4 py-3 text-left hover:bg-sand" onClick={() => setCounting(true)}>
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold-soft text-gold">
                <ClipboardCheck className="size-5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Count your yard once</span>
                <span className="block text-sm text-muted">Tell the app how many full and empty cylinders you have. After that it keeps the numbers right by itself.</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
            </button>
          ) : null}
          <GasList rows={rows} />
        </>
      )}

      <HoldingPanel yard={yard} entries={entries} payments={payments} tracking={tracking.data} onChanged={refresh} />

      <section className="card">
        <button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left" aria-expanded={more} onClick={() => setMore((open) => !open)}>
          <span>
            <span className="block font-semibold">More stock tools</span>
            <span className="block text-sm text-muted">Plant trips, and typing a count by hand</span>
          </span>
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform", more && "rotate-180")} aria-hidden />
        </button>
      </section>
      {more ? (
        <>
          <PlantsSummary moves={moves} balances={balances} />
          <PlantPanel yard={yard} moves={moves} onSaved={refresh} />
          <CountPanel yard={yard} onSaved={refresh} />
          <MovesList moves={moves} onChanged={refresh} />
        </>
      ) : null}
    </div>
  );
}

/** One card per gas: full and empty in the yard, and with customers. */
function GasList({ rows: all }: { rows: ReturnType<typeof yardStock> }) {
  const [showAll, setShowAll] = useState(false);
  const active = all.filter((row) => row.countedOn || row.full || row.empty || row.plant || row.customers);
  const rows = showAll ? all : active;
  if (!active.length && !showAll) {
    return (
      <p className="card px-4 py-6 text-center text-sm text-muted">
        No cylinders yet. Count your yard, or give cylinders to a customer, and they show up here.
      </p>
    );
  }
  return (
    <section className="card overflow-hidden">
      <div className="label grid grid-cols-[minmax(0,1fr)_3rem_3.2rem_4.8rem] gap-2 border-b border-line bg-sand/50 px-4 py-2.5 text-right">
        <span className="text-left">Gas</span>
        <span>Full</span>
        <span>Empty</span>
        <span>Customers</span>
      </div>
      <ul>
        {rows.map((row) => {
          const off = row.full < 0 || row.empty < 0;
          return (
            <li key={row.type} className="grid grid-cols-[minmax(0,1fr)_3rem_3.2rem_4.8rem] items-center gap-2 border-b border-line px-4 py-3 text-right last:border-b-0">
              <span className="min-w-0 text-left">
                <span className="block font-semibold leading-snug">{row.type}</span>
                <span className={cn("block text-xs", off || !row.countedOn ? "text-gold" : "text-muted")}>
                  {off ? "Count needed" : row.countedOn ? `Counted ${dmy(row.countedOn)}` : "Not counted yet"}
                  {row.plant ? ` · ${row.plant} at plant` : ""}
                </span>
              </span>
              <span className={cn("font-display text-lg tabular-nums", off ? "text-muted" : "text-pine")}>{off ? "–" : row.full}</span>
              <span className={cn("font-display text-lg tabular-nums", off && "text-muted")}>{off ? "–" : row.empty}</span>
              <span className="font-display text-lg tabular-nums">{row.customers}</span>
            </li>
          );
        })}
      </ul>
      {all.length > active.length ? (
        <button type="button" className="w-full border-t border-line px-4 py-2.5 text-sm font-medium text-muted hover:bg-sand" onClick={() => setShowAll((value) => !value)}>
          {showAll ? "Show only gases in use" : `Show all ${all.length} gas types`}
        </button>
      ) : null}
    </section>
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
  const [rate, setRate] = useState("");
  const [paidNow, setPaidNow] = useState("");
  const [billNo, setBillNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Note>(null);
  const plants = useMemo(() => [...new Set(moves.map((move) => move.plant).filter(Boolean))].sort(), [moves]);
  const counted = splitSerials(serials).length;
  const howMany = counted || Number(qty) || 0;
  const refillTotal = kind === "from_plant" && Number(rate) > 0 ? Math.round(Number(rate) * howMany * 100) / 100 : 0;

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveStockMove({
        data: { kind, plant, gasType, serialNo: serials, quantity: Number(qty) || 0, fullCount: null, emptyCount: null, challanNo: challan, note, date, refillRate: kind === "from_plant" && rate ? Number(rate) : null, paidNow: paidNow ? Number(paidNow) : null, billNo },
      });
      if (!result.ok) {
        setStatus({ tone: "bad", text: result.error });
        return;
      }
      setStatus({ tone: "ok", text: `${counted || qty} × ${gasType} ${kind === "to_plant" ? "sent to" : "back from"} ${plant}.${refillTotal ? ` Refill charges ${rupee(refillTotal, 0)} added to ${plant}'s account.` : ""}` });
      offerUndo({ text: `${counted || qty} × ${gasType} ${kind === "to_plant" ? "sent to" : "back from"} ${plant}.`, undo: [{ kind: "stockMove", id: result.id }] });
      setSerials("");
      setPaidNow("");
      setBillNo("");
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
          {kind === "from_plant" ? (
            <div className="grid gap-3 rounded-lg border border-line bg-sand/40 p-3">
              <p className="text-sm font-medium">Refill charges (optional)</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="₹ per cylinder">
                  <input className="field tabular-nums" inputMode="decimal" value={rate} onChange={(event) => setRate(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
                </Field>
                <Field label="Paid now (₹)">
                  <input className="field tabular-nums" inputMode="decimal" value={paidNow} onChange={(event) => setPaidNow(event.target.value.replace(/[^\d.]/g, ""))} placeholder="0" />
                </Field>
              </div>
              <Field label="Plant's bill no.">
                <input className="field" value={billNo} maxLength={40} onChange={(event) => setBillNo(event.target.value)} placeholder="Same as challan if left empty" />
              </Field>
              <p className="text-xs text-muted">
                {refillTotal ? `${howMany} × ${rupee(Number(rate), 0)} = ${rupee(refillTotal, 0)} goes on ${plant || "the plant"}'s account, so you can see what you owe and pay it.` : "Add the plant's refill rate to keep track of what you owe them."}
              </p>
            </div>
          ) : null}
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
      offerUndo({ text: `Count saved for ${gasType}.`, undo: [{ kind: "stockMove", id: result.id }] });
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
    <Panel title="Type a count by hand">
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
  const [editTerms, setEditTerms] = useState(false);
  const [showAllRows, setShowAllRows] = useState(false);
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
    <Panel
      title="Holding charges"
      action={
        isOwner && terms.rate > 0 && !editTerms ? (
          <button type="button" className="btn btn-ghost h-9 min-h-0 px-3 text-sm" onClick={() => setEditTerms(true)}>
            Change terms
          </button>
        ) : undefined
      }
    >
      <p className="text-sm text-muted">
        {terms.rate > 0
          ? `Customers who keep cylinders more than ${terms.freeDays} days pay ${rupee(terms.rate)} per cylinder for each extra day.`
          : "Charge customers who keep cylinders too long. Set the free days and a daily rate to start."}
      </p>
      {isOwner && (terms.rate <= 0 || editTerms) ? (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <Field label="Free days">
            <input className="field w-28 tabular-nums" inputMode="numeric" value={free ?? String(terms.freeDays)} onChange={(event) => setFree(event.target.value.replace(/[^\d]/g, ""))} />
          </Field>
          <Field label="₹ per cylinder per day">
            <input className="field w-36 tabular-nums" inputMode="decimal" value={rate ?? String(terms.rate)} onChange={(event) => setRate(event.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          <button
            type="button"
            className="btn btn-pine"
            disabled={busy || (free == null && rate == null)}
            onClick={() => void saveTerms().then(() => setEditTerms(false))}
          >
            Save
          </button>
          {editTerms ? (
            <button type="button" className="btn btn-ghost" onClick={() => setEditTerms(false)}>
              Cancel
            </button>
          ) : null}
        </div>
      ) : null}
      <StatusNote note={status} />
      {totalDue > 0 ? <p className="mt-3 text-sm font-semibold">To bill: {rupee(totalDue)} from {rows.filter((row) => row.amount > 0).length} {rows.filter((row) => row.amount > 0).length === 1 ? "customer" : "customers"}</p> : null}
      <ul className="mt-3 divide-y divide-line">
        {rows.length === 0 ? <li className="py-3 text-sm text-muted">No cylinders are with customers right now.</li> : null}
        {rows.length > 0 && !rows.some((row) => row.overFree > 0) && !showAllRows ? (
          <li className="py-3 text-sm text-muted">Nobody has kept cylinders past {terms.freeDays} days.</li>
        ) : null}
        {rows.filter((row) => showAllRows || row.overFree > 0).map((row) => (
          <li key={row.company} className="py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <button type="button" className="min-w-0 text-left" onClick={() => setOpen(open === row.company ? null : row.company)} aria-expanded={open === row.company}>
                <p className="font-semibold">{row.company}</p>
                <p className="text-xs text-muted">
                  {row.cylinders} with them · {row.overFree} kept over {row.terms.freeDays} days · tap for details
                  {row.lastBilled ? ` · billed up to ${dmy(row.lastBilled)}` : ""}
                  {tracking?.companyTerms[row.company] ? " · own terms" : ""}
                </p>
              </button>
              <div className="flex items-center gap-2">
                <p className={cn("font-semibold tabular-nums", row.amount > 0 ? "text-rust" : "text-muted")}>{rupee(row.amount, 0)}</p>
                {canEdit && row.amount > 0 ? (
                  <button type="button" className="btn btn-rust h-9 min-h-0 px-3 text-sm" disabled={busy} onClick={() => void bill(row)}>
                    Bill
                  </button>
                ) : null}
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
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {rows.some((row) => row.overFree <= 0) ? (
        <button type="button" className="mt-1 text-sm font-medium text-muted underline-offset-2 hover:underline" onClick={() => setShowAllRows((value) => !value)}>
          {showAllRows ? "Show only customers to charge" : `Show all ${rows.length} ${rows.length === 1 ? "customer" : "customers"} with cylinders`}
        </button>
      ) : null}
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
                      onClick={() =>
                        void deletePayment({ data: charge.id }).then((result) => {
                          if (result.ok) offerUndo({ text: `${charge.receiptNo} removed.`, undo: [{ kind: "restore", table: "payment", id: charge.id }] });
                          onChanged();
                        })
                      }
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
              <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md text-muted hover:bg-sand hover:text-rust" aria-label="Remove this record" onClick={() =>
                  void deleteStockMove({ data: move.id }).then((result) => {
                    if (result.ok) offerUndo({ text: "Record removed.", undo: [{ kind: "restore", table: "stockMove", id: move.id }] });
                    onChanged();
                  })
                }>
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
    const saved: UndoTarget[] = [];
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
        saved.push({ kind: "stockMove", id: result.id });
      }
      offerUndo({ text: `Stock count saved for ${saved.length} gas${saved.length === 1 ? "" : "es"}.`, undo: saved });
      onSaved();
    } catch {
      setNote({ tone: "bad", text: "Couldn't save. Check your internet connection." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title="Count stock">
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
          <div className="grid gap-2 border-t border-line pt-3">
            <p className="text-sm font-medium">Another gas in your yard that isn&apos;t listed?</p>
            <TypePicker value={adding} types={types} onChange={setAdding} />
            <button
              type="button"
              className="btn btn-ghost w-full sm:w-fit"
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

/** Each plant: empties still there, last trip, and what you owe them for refills. */
function PlantsSummary({ moves, balances }: { moves: StockMove[]; balances: CompanyBalance[] }) {
  const { canEdit } = useRole();
  const rows = useMemo(() => {
    const map = new Map<string, { name: string; at: Map<string, number>; last: string }>();
    for (const move of moves) {
      if (move.kind === "count" || !move.plant) continue;
      const key = move.plant.toLowerCase();
      const row = map.get(key) ?? { name: move.plant, at: new Map<string, number>(), last: "" };
      const sign = move.kind === "to_plant" ? 1 : -1;
      row.at.set(move.gasType, (row.at.get(move.gasType) ?? 0) + sign * move.quantity);
      if (move.date > row.last) row.last = move.date;
      map.set(key, row);
    }
    return [...map.values()]
      .map((row) => {
        const balance = balances.find((item) => item.company.toLowerCase() === row.name.toLowerCase());
        const at = [...row.at.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
        return { ...row, balance, atList: at, atTotal: at.reduce((sum, [, n]) => sum + n, 0) };
      })
      .sort((a, b) => b.atTotal - a.atTotal || (b.balance?.toPay ?? 0) - (a.balance?.toPay ?? 0) || a.name.localeCompare(b.name));
  }, [moves, balances]);
  if (!rows.length) return null;
  return (
    <Panel title="Plants">
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li key={row.name} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 py-2.5">
            <div className="min-w-0">
              <p className="font-semibold">{row.name}</p>
              <p className="text-xs text-muted">
                {row.atTotal ? `${row.atTotal} ${row.atTotal === 1 ? "empty" : "empties"} there: ${row.atList.map(([type, n]) => `${n} ${type}`).join(" · ")}` : "No empties there"} · last trip {formatDay(row.last)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {row.balance?.toPay ? (
                <span className="text-right">
                  <span className="block text-xs text-muted">You owe</span>
                  <span className="font-bold tabular-nums text-rust">{rupee(row.balance.toPay, 0)}</span>
                </span>
              ) : row.balance?.paidAhead ? (
                <span className="tag tag-ok">Paid ahead {rupee(row.balance.paidAhead, 0)}</span>
              ) : row.balance ? (
                <span className="tag tag-ok">Nothing owed</span>
              ) : null}
              {canEdit && row.balance?.toPay ? (
                <button type="button" className="btn btn-ghost h-9 min-h-0 px-3 text-sm" onClick={() => openEntrySheet({ mode: "money", company: row.balance!.company, payOut: true })}>
                  Pay
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
