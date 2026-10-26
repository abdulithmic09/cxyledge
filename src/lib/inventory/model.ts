import { z } from "zod";

export const MOVE_KINDS = [
  "receive_full",
  "issue_full",
  "collect_empty",
  "send_empty",
  "adjust_full",
  "adjust_empty",
] as const;

export type MoveKind = (typeof MOVE_KINDS)[number];

export type MoveSource = "manual" | "count" | "opening";

export type CylinderType = {
  id: string;
  name: string;
  size: string;
  lowFull: number;
  archived: boolean;
};

export type Movement = {
  id: string;
  date: string;
  typeId: string;
  kind: MoveKind;
  qty: number;
  party: string;
  note: string;
  createdAt: string;
  source: MoveSource;
};

export type Stock = { full: number; empty: number };

export type PersistedBook = {
  version: 1;
  yardName: string;
  types: CylinderType[];
  movements: Movement[];
  sample: boolean;
  bannerHidden: boolean;
};

export const KIND_META: Record<
  MoveKind,
  { label: string; short: string; bucket: "full" | "empty"; verb: string }
> = {
  receive_full: { label: "Receive full", short: "Received", bucket: "full", verb: "Receive" },
  issue_full: { label: "Issue full", short: "Issued", bucket: "full", verb: "Issue" },
  collect_empty: { label: "Collect empty", short: "Empties in", bucket: "empty", verb: "Empty in" },
  send_empty: { label: "Send empty", short: "Empties out", bucket: "empty", verb: "Empty out" },
  adjust_full: { label: "Full correction", short: "Full adjust", bucket: "full", verb: "Adjust full" },
  adjust_empty: { label: "Empty correction", short: "Empty adjust", bucket: "empty", verb: "Adjust empty" },
};

export const LPG_TEMPLATES: Array<Pick<CylinderType, "name" | "size" | "lowFull">> = [
  { name: "Domestic", size: "14.2 kg", lowFull: 20 },
  { name: "Commercial", size: "19 kg", lowFull: 8 },
  { name: "Small", size: "5 kg", lowFull: 10 },
  { name: "Industrial", size: "47.5 kg", lowFull: 4 },
];

export const GAS_TEMPLATES: Array<Pick<CylinderType, "name" | "size" | "lowFull">> = [
  { name: "Oxygen", size: "Medical", lowFull: 6 },
  { name: "Nitrogen", size: "Industrial", lowFull: 4 },
  { name: "Carbon dioxide", size: "Industrial", lowFull: 4 },
  { name: "Argon", size: "Industrial", lowFull: 2 },
];

const TypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  size: z.string().max(80),
  lowFull: z.number().int().nonnegative().max(1_000_000),
  archived: z.boolean(),
});

const MoveSchema = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  typeId: z.string().min(1),
  kind: z.enum(MOVE_KINDS),
  qty: z.number().int().min(-1_000_000).max(1_000_000),
  party: z.string().max(80),
  note: z.string().max(160),
  createdAt: z.string().min(1),
  source: z.enum(["manual", "count", "opening"]).optional(),
});

const BookSchema = z.object({
  version: z.literal(1),
  yardName: z.string().min(1).max(60),
  types: z.array(TypeSchema).max(200),
  movements: z.array(MoveSchema).max(20000),
  sample: z.boolean().optional(),
  bannerHidden: z.boolean().optional(),
});

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(iso: string, n: number): string {
  const dt = parseISODate(iso);
  dt.setDate(dt.getDate() + n);
  return todayISO(dt);
}

/** "Mon, 26/10/2026" — weekday plus DD/MM/YYYY. */
export function formatDay(iso: string): string {
  const d = parseISODate(iso);
  const weekday = d.toLocaleDateString("en-IN", { weekday: "short" });
  return `${weekday}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export function formatShort(iso: string): string {
  return parseISODate(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatDelta(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

export function formatCover(full: number, avgPerDay: number): string {
  if (full < 0) return "Book is short";
  if (avgPerDay <= 0) return "No issues in this stretch";
  const days = full / avgPerDay;
  if (days > 99) return "99+ days of cover";
  const rounded = days >= 10 ? Math.round(days).toString() : (Math.round(days * 10) / 10).toString();
  return `${rounded} days of cover`;
}

export function deltaOf(m: Movement): number {
  if (m.kind === "adjust_full" || m.kind === "adjust_empty") return m.qty;
  const sign = m.kind === "issue_full" || m.kind === "send_empty" ? -1 : 1;
  return sign * Math.abs(m.qty);
}

export function apply(stock: Stock, m: Movement): void {
  const d = deltaOf(m);
  if (KIND_META[m.kind].bucket === "full") stock.full += d;
  else stock.empty += d;
}

export function compareMovements(a: Movement, b: Movement): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

export function stockOf(
  movements: Movement[],
  typeId: string,
  opts?: { through?: string; before?: string },
): Stock {
  const stock: Stock = { full: 0, empty: 0 };
  const list = movements.filter((m) => {
    if (m.typeId !== typeId) return false;
    if (opts?.before && m.date >= opts.before) return false;
    if (opts?.through && m.date > opts.through) return false;
    return true;
  });
  list.sort(compareMovements);
  for (const m of list) apply(stock, m);
  return stock;
}

export function eachDate(from: string, to: string): string[] {
  if (from > to) return [];
  const out: string[] = [];
  let d = from;
  for (let i = 0; i < 5000 && d <= to; i++) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

export type DayPoint = {
  date: string;
  label: string;
  issued: number;
  received: number;
  emptyIn: number;
  emptyOut: number;
  fullClose: number;
  emptyClose: number;
};

export function runningByDay(movements: Movement[], from: string, to: string): DayPoint[] {
  const days = eachDate(from, to);
  if (days.length === 0) return [];
  const sorted = [...movements].sort(compareMovements);
  const map = new Map<string, Stock>();
  let idx = 0;
  const take = (m: Movement) => {
    let s = map.get(m.typeId);
    if (!s) {
      s = { full: 0, empty: 0 };
      map.set(m.typeId, s);
    }
    apply(s, m);
  };
  while (idx < sorted.length && sorted[idx]!.date < from) take(sorted[idx++]!);
  const points: DayPoint[] = [];
  for (const date of days) {
    let issued = 0;
    let received = 0;
    let emptyIn = 0;
    let emptyOut = 0;
    while (idx < sorted.length && sorted[idx]!.date < date) take(sorted[idx++]!);
    while (idx < sorted.length && sorted[idx]!.date === date) {
      const m = sorted[idx++]!;
      take(m);
      if (m.kind === "issue_full") issued += Math.abs(m.qty);
      else if (m.kind === "receive_full") received += Math.abs(m.qty);
      else if (m.kind === "collect_empty") emptyIn += Math.abs(m.qty);
      else if (m.kind === "send_empty") emptyOut += Math.abs(m.qty);
    }
    let fullClose = 0;
    let emptyClose = 0;
    for (const s of map.values()) {
      fullClose += s.full;
      emptyClose += s.empty;
    }
    points.push({
      date,
      label: formatShort(date),
      issued,
      received,
      emptyIn,
      emptyOut,
      fullClose,
      emptyClose,
    });
  }
  return points;
}

export function thinSeries(points: DayPoint[], max = 90): DayPoint[] {
  if (points.length <= max) return points;
  const size = Math.ceil(points.length / max);
  const out: DayPoint[] = [];
  for (let i = 0; i < points.length; i += size) {
    const slice = points.slice(i, i + size);
    const last = slice[slice.length - 1]!;
    const first = slice[0]!;
    out.push({
      date: last.date,
      label: first.date === last.date ? last.label : `${formatShort(first.date)}–${formatShort(last.date)}`,
      issued: slice.reduce((a, p) => a + p.issued, 0),
      received: slice.reduce((a, p) => a + p.received, 0),
      emptyIn: slice.reduce((a, p) => a + p.emptyIn, 0),
      emptyOut: slice.reduce((a, p) => a + p.emptyOut, 0),
      fullClose: last.fullClose,
      emptyClose: last.emptyClose,
    });
  }
  return out;
}

export type TypeStat = {
  type: CylinderType;
  full: number;
  empty: number;
  issued: number;
  received: number;
  emptyIn: number;
  emptyOut: number;
  avgIssue: number;
};

export function typeStats(
  types: CylinderType[],
  movements: Movement[],
  from: string,
  to: string,
  asOf: string,
): TypeStat[] {
  const span = Math.max(1, eachDate(from, to).length);
  return types
    .filter((t) => !t.archived || movements.some((m) => m.typeId === t.id))
    .map((type) => {
      const now = stockOf(movements, type.id, { through: asOf });
      let issued = 0;
      let received = 0;
      let emptyIn = 0;
      let emptyOut = 0;
      for (const m of movements) {
        if (m.typeId !== type.id || m.date < from || m.date > to) continue;
        if (m.kind === "issue_full") issued += Math.abs(m.qty);
        else if (m.kind === "receive_full") received += Math.abs(m.qty);
        else if (m.kind === "collect_empty") emptyIn += Math.abs(m.qty);
        else if (m.kind === "send_empty") emptyOut += Math.abs(m.qty);
      }
      return {
        type,
        full: now.full,
        empty: now.empty,
        issued,
        received,
        emptyIn,
        emptyOut,
        avgIssue: issued / span,
      };
    });
}

export function partyStats(movements: Movement[], from: string, to: string) {
  const map = new Map<string, { party: string; issued: number; collected: number }>();
  for (const m of movements) {
    if (m.date < from || m.date > to) continue;
    if (m.kind !== "issue_full" && m.kind !== "collect_empty") continue;
    const party = m.party.trim() || "Unnamed";
    const row = map.get(party) ?? { party, issued: 0, collected: 0 };
    if (m.kind === "issue_full") row.issued += Math.abs(m.qty);
    else row.collected += Math.abs(m.qty);
    map.set(party, row);
  }
  return [...map.values()].sort((a, b) => b.issued - a.issued || b.collected - a.collected);
}

export function correctionTotals(movements: Movement[], from: string, to: string) {
  let full = 0;
  let empty = 0;
  let count = 0;
  for (const m of movements) {
    if (m.date < from || m.date > to || m.source === "opening") continue;
    if (m.kind === "adjust_full") {
      full += m.qty;
      count += 1;
    } else if (m.kind === "adjust_empty") {
      empty += m.qty;
      count += 1;
    }
  }
  return { full, empty, count };
}

export type DayLine = {
  type: CylinderType;
  openFull: number;
  openEmpty: number;
  inFull: number;
  outFull: number;
  adjFull: number;
  closeFull: number;
  inEmpty: number;
  outEmpty: number;
  adjEmpty: number;
  closeEmpty: number;
};

export function dayLines(types: CylinderType[], movements: Movement[], date: string): DayLine[] {
  const lines: DayLine[] = [];
  for (const type of types) {
    const touched = movements.some((m) => m.typeId === type.id && m.date === date);
    if (type.archived && !touched) continue;
    const open = stockOf(movements, type.id, { before: date });
    const close = stockOf(movements, type.id, { through: date });
    let inFull = 0;
    let outFull = 0;
    let adjFull = 0;
    let inEmpty = 0;
    let outEmpty = 0;
    let adjEmpty = 0;
    for (const m of movements) {
      if (m.typeId !== type.id || m.date !== date) continue;
      if (m.kind === "receive_full") inFull += Math.abs(m.qty);
      else if (m.kind === "issue_full") outFull += Math.abs(m.qty);
      else if (m.kind === "adjust_full") adjFull += m.qty;
      else if (m.kind === "collect_empty") inEmpty += Math.abs(m.qty);
      else if (m.kind === "send_empty") outEmpty += Math.abs(m.qty);
      else if (m.kind === "adjust_empty") adjEmpty += m.qty;
    }
    lines.push({
      type,
      openFull: open.full,
      openEmpty: open.empty,
      inFull,
      outFull,
      adjFull,
      closeFull: close.full,
      inEmpty,
      outEmpty,
      adjEmpty,
      closeEmpty: close.empty,
    });
  }
  return lines;
}

export function dayFlows(movements: Movement[], date: string) {
  let issued = 0;
  let received = 0;
  let emptyIn = 0;
  let emptyOut = 0;
  for (const m of movements) {
    if (m.date !== date) continue;
    if (m.kind === "issue_full") issued += Math.abs(m.qty);
    else if (m.kind === "receive_full") received += Math.abs(m.qty);
    else if (m.kind === "collect_empty") emptyIn += Math.abs(m.qty);
    else if (m.kind === "send_empty") emptyOut += Math.abs(m.qty);
  }
  return { issued, received, emptyIn, emptyOut };
}

export function recordedDates(movements: Movement[]): string[] {
  return [...new Set(movements.map((m) => m.date))].sort((a, b) => (a < b ? 1 : -1));
}

export function knownParties(movements: Movement[]): string[] {
  const set = new Set<string>();
  for (const m of movements) {
    const p = m.party.trim();
    if (p) set.add(p);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function csvCell(value: string | number): string {
  const v = String(value);
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function movementsCsv(types: CylinderType[], movements: Movement[]): string {
  const names = new Map(types.map((t) => [t.id, t]));
  const lines = [["date", "type", "size", "kind", "signed_qty", "party", "note"].join(",")];
  for (const m of [...movements].sort(compareMovements)) {
    const t = names.get(m.typeId);
    lines.push(
      [
        m.date,
        t?.name ?? "Unknown type",
        t?.size ?? "",
        KIND_META[m.kind].label,
        deltaOf(m),
        m.party,
        m.note,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function summaryCsv(types: CylinderType[], movements: Movement[]): string {
  const header = [
    "date",
    "type",
    "size",
    "open_full",
    "full_in",
    "full_out",
    "full_adjust",
    "close_full",
    "open_empty",
    "empty_in",
    "empty_out",
    "empty_adjust",
    "close_empty",
  ];
  const lines = [header.join(",")];
  for (const date of [...recordedDates(movements)].reverse()) {
    for (const line of dayLines(types, movements, date)) {
      lines.push(
        [
          date,
          line.type.name,
          line.type.size,
          line.openFull,
          line.inFull,
          line.outFull,
          line.adjFull,
          line.closeFull,
          line.openEmpty,
          line.inEmpty,
          line.outEmpty,
          line.adjEmpty,
          line.closeEmpty,
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }
  return lines.join("\n");
}

export function parseBook(input: unknown): { ok: true; data: PersistedBook } | { ok: false; error: string } {
  let json = input;
  if (typeof input === "string") {
    try {
      json = JSON.parse(input);
    } catch {
      return { ok: false, error: "That file is not valid JSON." };
    }
  }
  const parsed = BookSchema.safeParse(json);
  if (!parsed.success) return { ok: false, error: "This file is not a Cxyledge backup." };
  const seen = new Set<string>();
  const movements: Movement[] = parsed.data.movements.map((m) => {
    let id = m.id;
    if (seen.has(id)) id = crypto.randomUUID();
    seen.add(id);
    return {
      id,
      date: m.date,
      typeId: m.typeId,
      kind: m.kind,
      qty: m.qty,
      party: m.party,
      note: m.note,
      createdAt: m.createdAt,
      source: m.source ?? "manual",
    };
  });
  return {
    ok: true,
    data: {
      version: 1,
      yardName: parsed.data.yardName.trim() || "My yard",
      types: parsed.data.types,
      movements,
      sample: parsed.data.sample ?? false,
      bannerHidden: parsed.data.bannerHidden ?? false,
    },
  };
}

export function buildSample(today: string): Pick<PersistedBook, "yardName" | "types" | "movements"> {
  const types: CylinderType[] = [
    { id: "type-142", name: "Domestic", size: "14.2 kg", lowFull: 20, archived: false },
    { id: "type-19", name: "Commercial", size: "19 kg", lowFull: 8, archived: false },
    { id: "type-5", name: "Small", size: "5 kg", lowFull: 10, archived: false },
    { id: "type-475", name: "Industrial", size: "47.5 kg", lowFull: 4, archived: false },
  ];
  const movements: Movement[] = [];
  let n = 0;
  const push = (row: Omit<Movement, "id" | "party" | "note" | "source"> & Partial<Pick<Movement, "party" | "note" | "source">>) => {
    movements.push({
      id: `smp-${++n}`,
      party: row.party ?? "",
      note: row.note ?? "",
      source: row.source ?? "manual",
      date: row.date,
      typeId: row.typeId,
      kind: row.kind,
      qty: row.qty,
      createdAt: row.createdAt,
    });
  };

  const spec = [
    { id: "type-142", full: 96, empty: 28, scale: 1 },
    { id: "type-19", full: 34, empty: 14, scale: 0.45 },
    { id: "type-5", full: 48, empty: 20, scale: 0.65 },
    { id: "type-475", full: 18, empty: 8, scale: 0.3 },
  ];
  const start = addDays(today, -13);
  const stock: Record<string, Stock> = {};
  for (const s of spec) {
    stock[s.id] = { full: s.full, empty: s.empty };
    push({
      date: start,
      typeId: s.id,
      kind: "adjust_full",
      qty: s.full,
      note: "Opening count",
      source: "opening",
      createdAt: `${start}T06:00:00.000Z`,
    });
    push({
      date: start,
      typeId: s.id,
      kind: "adjust_empty",
      qty: s.empty,
      note: "Opening count",
      source: "opening",
      createdAt: `${start}T06:00:01.000Z`,
    });
  }

  const customers = ["Sharma Stores", "City Hotel", "Mehta Gas", "Greenview Apts", "R.K. Dhaba", "Walk-in counter"];
  const plant = "Bottling plant";

  for (let i = 0; i < 14; i++) {
    const date = addDays(start, i);
    spec.forEach((s, si) => {
      const base = 4 + ((i * 3 + si * 2) % 9);
      let issue = Math.max(1, Math.round(base * s.scale));
      let receive = i % 3 === si % 3 ? Math.max(issue + 4, Math.round((12 + si) * s.scale)) : 0;
      if (stock[s.id]!.full - issue < 4) receive = Math.max(receive, issue + 6);
      let emptyIn = Math.max(0, issue - (i % 3 === 0 ? 1 : 0));
      let emptyOut = i % 4 === si % 4 ? Math.max(1, Math.round((stock[s.id]!.empty + emptyIn) * 0.45)) : 0;
      const hh = String(8 + si).padStart(2, "0");
      if (receive > 0) {
        push({
          date,
          typeId: s.id,
          kind: "receive_full",
          qty: receive,
          party: plant,
          createdAt: `${date}T${hh}:05:00.000Z`,
        });
        stock[s.id]!.full += receive;
      }
      const customer = customers[(i + si) % customers.length]!;
      push({
        date,
        typeId: s.id,
        kind: "issue_full",
        qty: issue,
        party: customer,
        note: i === 10 && si === 0 ? "Festival rush" : "",
        createdAt: `${date}T${hh}:20:00.000Z`,
      });
      stock[s.id]!.full -= issue;
      if (emptyIn > 0) {
        push({
          date,
          typeId: s.id,
          kind: "collect_empty",
          qty: emptyIn,
          party: customer,
          createdAt: `${date}T${hh}:30:00.000Z`,
        });
        stock[s.id]!.empty += emptyIn;
      }
      if (emptyOut > stock[s.id]!.empty) emptyOut = stock[s.id]!.empty;
      if (emptyOut > 0) {
        push({
          date,
          typeId: s.id,
          kind: "send_empty",
          qty: emptyOut,
          party: plant,
          createdAt: `${date}T${hh}:45:00.000Z`,
        });
        stock[s.id]!.empty -= emptyOut;
      }
    });
  }

  return { yardName: "Sample yard", types, movements };
}
