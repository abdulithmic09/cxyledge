import type { Entry, MovementKind, Payment, PaymentStatus } from "@/lib/inventory/api";
import { addDays, eachDate, parseISODate, todayISO } from "@/lib/inventory/model";
import { consumeSerials, splitSerials } from "@/lib/inventory/serials";

export type Period = "day" | "week" | "month" | "year" | "custom";

export type CompanyBalance = {
  company: string;
  delivered: number;
  returned: number;
  purchased: number;
  outstandingQty: number;
  outstandingSerials: string[];
  byType: Array<{ type: string; out: number }>;
  billed: number;
  paid: number;
  toCollect: number;
  toPay: number;
  /** Payments recorded separately (after the bill). */
  received: number;
  paidOut: number;
  lastUpdated: string;
};

export type OpenOrder = {
  entry: Entry;
  leftQty: number;
  leftSerials: string[];
};

export function moneyGap(entry: Entry): number {
  return Math.max(0, (entry.amountDue ?? 0) - (entry.amountPaid ?? 0));
}

export function companyBalances(entries: Entry[], payments: Payment[] = []): CompanyBalance[] {
  const names = new Set(entries.map((entry) => entry.companyName));
  for (const payment of payments) names.add(payment.companyName);
  const rows: CompanyBalance[] = [];
  for (const company of names) {
    const mine = entries.filter((entry) => entry.companyName === company);
    const delivered = mine.filter((entry) => entry.movement === "delivery");
    const returned = mine.filter((entry) => entry.movement === "return");
    const purchased = mine.filter((entry) => entry.movement === "purchase");
    const deliveredQty = sumQty(delivered);
    const returnedQty = sumQty(returned);
    const issuedSerials = delivered.flatMap((entry) => splitSerials(entry.serialNo));
    const returnedSerials = returned.flatMap((entry) => splitSerials(entry.serialNo));
    const sales = [...delivered, ...purchased];
    let billed = 0;
    let paid = 0;
    let toCollect = 0;
    let toPay = 0;
    for (const entry of sales) {
      billed += entry.amountDue ?? 0;
      paid += entry.amountPaid ?? 0;
      const gap = moneyGap(entry);
      if (entry.movement === "purchase") toPay += gap;
      else toCollect += gap;
    }
    const minePaid = payments.filter((payment) => payment.companyName === company);
    const received = minePaid.filter((payment) => payment.direction === "in").reduce((total, payment) => total + payment.amount, 0);
    const paidOut = minePaid.filter((payment) => payment.direction === "out").reduce((total, payment) => total + payment.amount, 0);
    const charged = minePaid.filter((payment) => payment.direction === "charge").reduce((total, payment) => total + payment.amount, 0);
    billed += charged;
    toCollect = Math.max(0, roundMoney(toCollect + charged - received));
    toPay = Math.max(0, roundMoney(toPay - paidOut));
    paid += received + paidOut;
    const typeOf = (entry: Entry) => {
      const own = entry.cylinderType?.trim();
      if (own) return own;
      const parent = entry.parentId ? delivered.find((row) => row.id === entry.parentId) : undefined;
      return parent?.cylinderType?.trim() || "Unspecified";
    };
    const typeMap = new Map<string, number>();
    for (const entry of delivered) typeMap.set(typeOf(entry), (typeMap.get(typeOf(entry)) ?? 0) + entry.quantity);
    for (const entry of returned) typeMap.set(typeOf(entry), (typeMap.get(typeOf(entry)) ?? 0) - entry.quantity);
    const byType = [...typeMap.entries()]
      .map(([type, out]) => ({ type, out: Math.max(0, out) }))
      .filter((row) => row.out > 0)
      .sort((a, b) => b.out - a.out || a.type.localeCompare(b.type));
    const lastUpdated = [...mine.map((entry) => entry.updatedAt), ...minePaid.map((payment) => payment.createdAt)].reduce(
      (latest, stamp) => (stamp > latest ? stamp : latest),
      "",
    );
    rows.push({
      company,
      delivered: deliveredQty,
      returned: returnedQty,
      purchased: sumQty(purchased),
      outstandingQty: Math.max(0, deliveredQty - returnedQty),
      outstandingSerials: consumeSerials(issuedSerials, returnedSerials),
      byType,
      billed,
      paid,
      toCollect,
      toPay,
      received,
      paidOut,
      lastUpdated,
    });
  }
  return rows.sort((a, b) => b.outstandingQty - a.outstandingQty || b.toCollect - a.toCollect || a.company.localeCompare(b.company));
}

export function openOrders(entries: Entry[]): OpenOrder[] {
  const returns = entries.filter((entry) => entry.movement === "return" && entry.parentId);
  return entries
    .filter((entry) => entry.movement === "delivery")
    .map((entry) => {
      const children = returns.filter((child) => child.parentId === entry.id);
      const leftSerials = consumeSerials(
        splitSerials(entry.serialNo),
        children.flatMap((child) => splitSerials(child.serialNo)),
      );
      return {
        entry,
        leftQty: Math.max(0, entry.quantity - sumQty(children)),
        leftSerials,
      };
    })
    .filter((order) => order.leftQty > 0);
}

export function periodBounds(
  period: Period,
  today = todayISO(),
  customFrom = today,
  customTo = today,
): { from: string; to: string; label: string } {
  if (period === "day") return { from: today, to: today, label: "Today" };
  if (period === "week") return { from: addDays(today, -6), to: today, label: "Last 7 days" };
  if (period === "month") return { from: `${today.slice(0, 7)}-01`, to: today, label: "This month" };
  if (period === "year") return { from: `${today.slice(0, 4)}-01-01`, to: today, label: "This year" };
  const from = customFrom <= customTo ? customFrom : customTo;
  const to = customFrom <= customTo ? customTo : customFrom;
  return { from, to, label: "Custom range" };
}

export function inRange(entry: Entry, from: string, to: string): boolean {
  return entry.entryDate >= from && entry.entryDate <= to;
}

export type MoneyTotals = {
  billed: number;
  paid: number;
  toCollect: number;
  toPay: number;
  overdue: number;
  delivered: number;
  returned: number;
  purchased: number;
};

export function totalsFor(entries: Entry[], today = todayISO(), payments: Payment[] = []): MoneyTotals {
  const overdueBefore = addDays(today, -7);
  const totals: MoneyTotals = {
    billed: 0,
    paid: 0,
    toCollect: 0,
    toPay: 0,
    overdue: 0,
    delivered: 0,
    returned: 0,
    purchased: 0,
  };
  for (const entry of entries) {
    if (entry.movement === "delivery") totals.delivered += entry.quantity;
    if (entry.movement === "return") totals.returned += entry.quantity;
    if (entry.movement === "purchase") totals.purchased += entry.quantity;
    if (entry.movement === "return") continue;
    totals.billed += entry.amountDue ?? 0;
    totals.paid += entry.amountPaid ?? 0;
    const gap = moneyGap(entry);
    if (entry.movement === "purchase") totals.toPay += gap;
    else totals.toCollect += gap;
    const open = entry.paymentStatus !== "received" && (gap > 0 || entry.amountDue == null);
    if (entry.movement === "delivery" && open && entry.entryDate <= overdueBefore) {
      totals.overdue += gap > 0 ? gap : 0;
    }
  }
  for (const payment of payments) {
    if (payment.direction === "charge") {
      totals.billed += payment.amount;
      totals.toCollect = roundMoney(totals.toCollect + payment.amount);
      continue;
    }
    totals.paid += payment.amount;
    if (payment.direction === "in") totals.toCollect = Math.max(0, roundMoney(totals.toCollect - payment.amount));
    else totals.toPay = Math.max(0, roundMoney(totals.toPay - payment.amount));
  }
  return totals;
}

export type SeriesPoint = {
  label: string;
  delivered: number;
  returned: number;
  purchased: number;
  outstanding: number;
};

export function movementSeries(entries: Entry[], from: string, to: string): SeriesPoint[] {
  const span = Math.max(0, Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86400000));
  const monthly = span > 62;
  const keys = monthly ? monthsBetween(from, to) : eachDate(from, to);
  return keys.map((key) => {
    const end = monthly ? monthCap(key, to) : key;
    const start = monthly ? `${key}-01` : key;
    let delivered = 0;
    let returned = 0;
    let purchased = 0;
    let outQty = 0;
    let backQty = 0;
    for (const entry of entries) {
      if (entry.entryDate >= start && entry.entryDate <= end) {
        if (entry.movement === "delivery") delivered += entry.quantity;
        if (entry.movement === "return") returned += entry.quantity;
        if (entry.movement === "purchase") purchased += entry.quantity;
      }
      if (entry.entryDate <= end) {
        if (entry.movement === "delivery") outQty += entry.quantity;
        if (entry.movement === "return") backQty += entry.quantity;
      }
    }
    const label = monthly
      ? parseISODate(`${key}-01`).toLocaleDateString("en-IN", { month: "short" })
      : parseISODate(key).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    return { label, delivered, returned, purchased, outstanding: Math.max(0, outQty - backQty) };
  });
}

export function topCompanies(entries: Entry[]): Array<{ company: string; cylinders: number; balance: number }> {
  const map = new Map<string, { company: string; cylinders: number; balance: number }>();
  for (const entry of entries) {
    if (entry.movement !== "delivery") continue;
    const row = map.get(entry.companyName) ?? { company: entry.companyName, cylinders: 0, balance: 0 };
    row.cylinders += entry.quantity;
    row.balance += moneyGap(entry);
    map.set(entry.companyName, row);
  }
  return [...map.values()].sort((a, b) => b.balance - a.balance || b.cylinders - a.cylinders).slice(0, 8);
}

export function paymentLabel(status: PaymentStatus): string {
  if (status === "received") return "Received";
  if (status === "partial") return "Part received";
  return "Not received";
}

export function movementLabel(movement: MovementKind): string {
  if (movement === "purchase") return "Purchase";
  if (movement === "return") return "Return";
  return "Delivery";
}

function sumQty(entries: Entry[]): number {
  return entries.reduce((total, entry) => total + entry.quantity, 0);
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let year = Number(from.slice(0, 4));
  let month = Number(from.slice(5, 7));
  const end = to.slice(0, 7);
  for (let i = 0; i < 240; i += 1) {
    const key = `${year}-${String(month).padStart(2, "0")}`;
    out.push(key);
    if (key >= end) break;
    month += 1;
    if (month === 13) {
      month = 1;
      year += 1;
    }
  }
  return out;
}

function monthCap(ym: string, cap: string): string {
  const [year, month] = ym.split("-").map(Number);
  const last = new Date(year!, month!, 0);
  const iso = todayISO(last);
  return iso < cap ? iso : cap;
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export type LedgerRow = {
  key: string;
  date: string;
  particulars: string;
  /** What the company owes you goes up (bills you raised, money you paid them). */
  debit: number;
  /** What the company owes you goes down (money they paid, bills they raised on you). */
  credit: number;
  balance: number;
  kind: "bill" | "payment" | "purchase";
  paymentId?: string;
};

/** Money ledger for one company, oldest first, with a running balance. Positive = they owe you. */
export function companyLedger(entries: Entry[], payments: Payment[], company: string): LedgerRow[] {
  const rows: Array<Omit<LedgerRow, "balance"> & { sort: string }> = [];
  for (const entry of entries) {
    if (entry.companyName !== company || entry.movement === "return") continue;
    const what = `${entry.quantity}${entry.cylinderType ? ` × ${entry.cylinderType}` : " cylinders"}${entry.billNo ? ` · bill ${entry.billNo}` : ""}`;
    if (entry.movement === "delivery") {
      if (entry.amountDue) rows.push({ key: `${entry.id}-d`, date: entry.entryDate, particulars: `Delivery ${what}`, debit: entry.amountDue, credit: 0, kind: "bill", sort: `${entry.entryDate}${entry.updatedAt}a` });
      if (entry.amountPaid) rows.push({ key: `${entry.id}-p`, date: entry.entryDate, particulars: `Received with bill${entry.billNo ? ` ${entry.billNo}` : ""}`, debit: 0, credit: entry.amountPaid, kind: "payment", sort: `${entry.entryDate}${entry.updatedAt}b` });
    } else {
      if (entry.amountDue) rows.push({ key: `${entry.id}-d`, date: entry.entryDate, particulars: `Purchase ${what}`, debit: 0, credit: entry.amountDue, kind: "purchase", sort: `${entry.entryDate}${entry.updatedAt}a` });
      if (entry.amountPaid) rows.push({ key: `${entry.id}-p`, date: entry.entryDate, particulars: `Paid with purchase${entry.billNo ? ` ${entry.billNo}` : ""}`, debit: entry.amountPaid, credit: 0, kind: "payment", sort: `${entry.entryDate}${entry.updatedAt}b` });
    }
  }
  for (const payment of payments) {
    if (payment.companyName !== company) continue;
    const how = `${payment.mode.toUpperCase()}${payment.reference ? ` ${payment.reference}` : ""}${payment.billNo ? ` · bill ${payment.billNo}` : ""}`;
    rows.push({
      key: payment.id,
      date: payment.paidOn,
      particulars:
        payment.direction === "charge"
          ? `Holding charges ${payment.receiptNo}${payment.note ? ` · ${payment.note}` : ""}`
          : payment.direction === "in"
            ? `Payment received ${payment.receiptNo} · ${how}`
            : `Payment made ${payment.receiptNo} · ${how}`,
      debit: payment.direction === "out" || payment.direction === "charge" ? payment.amount : 0,
      credit: payment.direction === "in" ? payment.amount : 0,
      kind: "payment",
      paymentId: payment.id,
      sort: `${payment.paidOn}${payment.createdAt}c`,
    });
  }
  rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
  let balance = 0;
  return rows.map(({ sort: _sort, ...row }) => {
    balance = roundMoney(balance + row.debit - row.credit);
    return { ...row, balance };
  });
}
