export function splitSerials(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[\s,;]+/)) {
    const serial = part.trim();
    if (!serial) continue;
    const key = serial.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(serial.slice(0, 40));
  }
  return out;
}

export function consumeSerials(issued: string[], returned: string[]): string[] {
  const pool = new Map<string, number>();
  for (const serial of returned) {
    const key = serial.toLowerCase();
    pool.set(key, (pool.get(key) ?? 0) + 1);
  }
  const left: string[] = [];
  for (const serial of issued) {
    const key = serial.toLowerCase();
    const count = pool.get(key) ?? 0;
    if (count > 0) pool.set(key, count - 1);
    else left.push(serial);
  }
  return left;
}

export function subtotal(qty: number, price: number | null): number | null {
  if (price == null || !Number.isFinite(price) || qty < 0) return null;
  return Math.round(qty * price * 100) / 100;
}

export function rupee(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: digits,
  }).format(value);
}

/** Standard gas types: every gas in A, B and D sizes (kept in step with gases.ts). */
export const DEFAULT_CYLINDER_TYPES = [
  "A-Type Oxygen",
  "B-Type Oxygen",
  "D-Type Oxygen",
  "A-Type CO2",
  "B-Type CO2",
  "D-Type CO2",
  "A-Type Nitrous",
  "B-Type Nitrous",
  "D-Type Nitrous",
  "A-Type Nitrogen",
  "B-Type Nitrogen",
  "D-Type Nitrogen",
  "A-Type Argon",
  "B-Type Argon",
  "D-Type Argon",
  "A-Type DA",
  "B-Type DA",
  "D-Type DA",
];

/** Clean a list of type names: trimmed, no blanks, no duplicates (ignoring case), at most 60 of 60 characters. */
export function cleanTypeList(values: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of Array.isArray(values) ? values : []) {
    const v = String(raw ?? "").trim().slice(0, 60);
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
    if (out.length >= 60) break;
  }
  return out;
}

export function cylinderTypeOptions(used: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of [...used, ...DEFAULT_CYLINDER_TYPES]) {
    const v = value.trim();
    if (!v || seen.has(v.toLowerCase())) continue;
    seen.add(v.toLowerCase());
    out.push(v);
  }
  return out;
}
