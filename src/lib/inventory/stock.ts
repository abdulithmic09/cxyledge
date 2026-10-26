import type { Entry, Payment } from "@/lib/inventory/api";
import type { CompanyBalance } from "@/lib/inventory/analyse";
import { companyBalances, openOrders } from "@/lib/inventory/analyse";
import { addDays, parseISODate, todayISO } from "@/lib/inventory/model";
import { splitSerials } from "@/lib/inventory/serials";
import type { Deposit, HoldTerms, StockMove, Tracking } from "@/lib/inventory/tracking";

export function daysBetween(from: string, to: string) {
  return Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);
}

/** Type of an entry, falling back to the delivery a return belongs to. */
function typeResolver(entries: Entry[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return (entry: Entry) => entry.cylinderType?.trim() || (entry.parentId ? byId.get(entry.parentId)?.cylinderType?.trim() : "") || "Unspecified";
}

// ---------------------------------------------------------------------------
// One cylinder's story
// ---------------------------------------------------------------------------

export type CylinderEvent = {
  key: string;
  date: string;
  sort: string;
  kind: "delivery" | "return" | "purchase" | "to_plant" | "from_plant";
  party: string;
  type: string;
  ref: string;
};

export type CylinderWhere = "customer" | "yard-full" | "yard-empty" | "plant";

export type CylinderStatus = {
  serial: string;
  where: CylinderWhere;
  party: string;
  type: string;
  since: string;
  days: number;
  events: CylinderEvent[];
};

export const WHERE_LABEL: Record<CylinderWhere, string> = {
  customer: "With customer",
  "yard-full": "At yard (full)",
  "yard-empty": "At yard (empty)",
  plant: "At the plant",
};

/** Every serial ever seen, with its history, oldest event first. */
export function cylinderIndex(entries: Entry[], moves: StockMove[]): Map<string, { serial: string; events: CylinderEvent[] }> {
  const typeOf = typeResolver(entries);
  const map = new Map<string, { serial: string; events: CylinderEvent[] }>();
  const add = (serial: string, event: CylinderEvent) => {
    const key = serial.toLowerCase();
    const slot = map.get(key) ?? { serial, events: [] };
    slot.events.push(event);
    map.set(key, slot);
  };
  for (const entry of entries) {
    for (const serial of splitSerials(entry.serialNo)) {
      add(serial, {
        key: `${entry.id}-${serial}`,
        date: entry.entryDate,
        sort: `${entry.entryDate}|${entry.updatedAt}`,
        kind: entry.movement,
        party: entry.companyName,
        type: typeOf(entry),
        ref: entry.billNo,
      });
    }
  }
  for (const move of moves) {
    if (move.kind === "count") continue;
    for (const serial of move.serials) {
      add(serial, { key: `${move.id}-${serial}`, date: move.date, sort: `${move.date}|${move.createdAt}`, kind: move.kind, party: move.plant, type: move.gasType, ref: move.challanNo });
    }
  }
  for (const slot of map.values()) slot.events.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  return map;
}

export function cylinderStatus(serial: string, events: CylinderEvent[], today = todayISO()): CylinderStatus | null {
  const last = events[events.length - 1];
  if (!last) return null;
  const where: CylinderWhere =
    last.kind === "delivery" ? "customer" : last.kind === "to_plant" ? "plant" : last.kind === "return" ? "yard-empty" : "yard-full";
  const type = [...events].reverse().find((event) => event.type && event.type !== "Unspecified")?.type ?? last.type;
  return { serial, where, party: last.party, type, since: last.date, days: Math.max(0, daysBetween(last.date, today)), events };
}

// ---------------------------------------------------------------------------
// Yard stock by gas type
// ---------------------------------------------------------------------------

export type StockRow = {
  type: string;
  full: number;
  empty: number;
  plant: number;
  customers: number;
  countedOn: string | null;
};

export function yardStock(entries: Entry[], moves: StockMove[], balances: CompanyBalance[], types: string[]): StockRow[] {
  const typeOf = typeResolver(entries);
  const all = new Set<string>(types);
  for (const entry of entries) all.add(typeOf(entry));
  for (const move of moves) if (move.gasType) all.add(move.gasType);
  const customers = new Map<string, number>();
  for (const balance of balances) for (const row of balance.byType) customers.set(row.type, (customers.get(row.type) ?? 0) + row.out);

  const rows: StockRow[] = [];
  for (const type of all) {
    const lower = type.toLowerCase();
    const mine = moves.filter((move) => move.gasType.toLowerCase() === lower);
    const count = mine.filter((move) => move.kind === "count").sort((a, b) => (a.date + a.createdAt < b.date + b.createdAt ? 1 : -1))[0];
    const after = (date: string, stamp: string) => !count || date > count.date || (date === count.date && stamp > count.createdAt);
    let full = count?.fullCount ?? 0;
    let empty = count?.emptyCount ?? 0;
    let plant = 0;
    for (const entry of entries) {
      if (typeOf(entry).toLowerCase() !== lower) continue;
      if (!after(entry.entryDate, entry.updatedAt)) continue;
      // Refill charges from the plant: the stock already came in with the plant trip.
      if (entry.movement === "purchase" && entry.parentId?.startsWith("plant:")) continue;
      if (entry.movement === "purchase") full += entry.quantity;
      else if (entry.movement === "delivery") full -= entry.quantity;
      else if (entry.movement === "return") empty += entry.quantity;
    }
    for (const move of mine) {
      if (move.kind === "to_plant") plant += move.quantity;
      if (move.kind === "from_plant") plant -= move.quantity;
      if (move.kind === "count" || !after(move.date, move.createdAt)) continue;
      if (move.kind === "to_plant") empty -= move.quantity;
      if (move.kind === "from_plant") full += move.quantity;
    }
    const out = customers.get(type) ?? 0;
    if (!full && !empty && !plant && !out && !count && !types.includes(type)) continue;
    rows.push({ type, full, empty, plant: Math.max(0, plant), customers: out, countedOn: count?.date ?? null });
  }
  return rows.sort((a, b) => b.full + b.empty + b.customers - (a.full + a.empty + a.customers) || a.type.localeCompare(b.type));
}

// ---------------------------------------------------------------------------
// Holding charges
// ---------------------------------------------------------------------------

export type HoldLine = { serial: string | null; type: string; qty: number; since: string; heldDays: number; chargeDays: number; amount: number };

export type HoldRow = {
  company: string;
  terms: HoldTerms;
  lastBilled: string | null;
  lines: HoldLine[];
  cylinders: number;
  overFree: number;
  cylinderDays: number;
  amount: number;
};

export function termsFor(tracking: Pick<Tracking, "terms" | "companyTerms"> | undefined, company: string): HoldTerms {
  const base = tracking?.terms ?? { freeDays: 30, rate: 0 };
  const own = tracking?.companyTerms[company] ?? {};
  return { freeDays: own.freeDays ?? base.freeDays, rate: own.rate ?? base.rate };
}

export function holdingRows(entries: Entry[], payments: Payment[], tracking: Pick<Tracking, "terms" | "companyTerms"> | undefined, today = todayISO()): HoldRow[] {
  const typeOf = typeResolver(entries);
  const byCompany = new Map<string, HoldRow>();
  // Serials still out, by company, so cylinders returned without a link to their delivery aren't charged.
  const stillOut = new Map(companyBalances(entries).map((balance) => [balance.company, new Set(balance.outstandingSerials.map((serial) => serial.toLowerCase()))]));
  for (const order of openOrders(entries)) {
    const company = order.entry.companyName;
    let row = byCompany.get(company);
    if (!row) {
      const charges = payments.filter((payment) => payment.companyName === company && payment.direction === "charge").map((payment) => payment.paidOn);
      row = { company, terms: termsFor(tracking, company), lastBilled: charges.sort().pop() ?? null, lines: [], cylinders: 0, overFree: 0, cylinderDays: 0, amount: 0 };
      byCompany.set(company, row);
    }
    const since = order.entry.entryDate;
    const freeEnd = addDays(since, row.terms.freeDays);
    const start = row.lastBilled && row.lastBilled > freeEnd ? row.lastBilled : freeEnd;
    const chargeDays = Math.max(0, daysBetween(start, today));
    const heldDays = Math.max(0, daysBetween(since, today));
    const type = typeOf(order.entry);
    const out = stillOut.get(company);
    const serials = order.leftSerials.filter((serial) => !out || out.has(serial.toLowerCase()));
    if (order.leftSerials.length && !serials.length) continue;
    const units = serials.length ? serials.map((serial) => ({ serial, qty: 1 })) : [{ serial: null, qty: order.leftQty }];
    for (const unit of units) {
      const amount = Math.round(chargeDays * unit.qty * row.terms.rate * 100) / 100;
      row.lines.push({ serial: unit.serial, type, qty: unit.qty, since, heldDays, chargeDays, amount });
      row.cylinders += unit.qty;
      if (chargeDays > 0) row.overFree += unit.qty;
      row.cylinderDays += chargeDays * unit.qty;
      row.amount = Math.round((row.amount + amount) * 100) / 100;
    }
  }
  for (const row of byCompany.values()) row.lines.sort((a, b) => b.chargeDays - a.chargeDays || a.since.localeCompare(b.since));
  return [...byCompany.values()].sort((a, b) => b.amount - a.amount || b.overFree - a.overFree || a.company.localeCompare(b.company));
}

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export function depositBalance(deposits: Deposit[], company: string) {
  let held = 0;
  let cylinders = 0;
  for (const deposit of deposits) {
    if (deposit.companyName !== company) continue;
    const sign = deposit.direction === "taken" ? 1 : -1;
    held += sign * deposit.amount;
    cylinders += sign * deposit.cylinders;
  }
  return { held: Math.round(held * 100) / 100, cylinders };
}
