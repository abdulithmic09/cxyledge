/**
 * Gas type = a gas (Oxygen, CO2, …) in a cylinder size (A-Type, B-Type, D-Type).
 * The book still stores one flat list of "<size> <gas>" names (e.g. "B-Type Oxygen"),
 * so old entries and exports keep working; the app groups them back into gases and sizes.
 */

export const DEFAULT_GASES = ["Oxygen", "CO2", "Nitrous", "Nitrogen", "Argon", "DA"];
export const DEFAULT_SIZES = ["A-Type", "B-Type", "D-Type"];
export const MAX_PAIRS = 60;

/** The list the app shipped with before sizes were split out; treated as the standard list. */
const LEGACY_DEFAULT = [
  "B-Type Oxygen",
  "D-Type Oxygen",
  "B-Type CO2",
  "D-Type CO2",
  "B-Type Nitrous",
  "D-Type Nitrous",
  "B-Type Nitrogen",
  "D-Type Nitrogen",
  "B-Type Argon",
  "D-Type Argon",
  "DA",
];

const SIZE_RE = /^([A-Za-z0-9]{1,3})\s*-?\s*type\b\s*(.*)$/i;

/** "b type", "B", "b-TYPE" → "B-Type". Anything else is kept as typed. */
export function cleanSize(raw: string): string {
  const value = raw.trim().replace(/\s+/g, " ").slice(0, 20);
  if (!value) return "";
  const match = value.match(/^([A-Za-z0-9]{1,3})(?:\s*-?\s*type)?$/i);
  return match ? `${match[1]!.toUpperCase()}-Type` : value;
}

/** Tidy gas names: "co2" → "CO2", "oxygen" → "Oxygen". */
export function cleanGas(raw: string): string {
  const value = raw.trim().replace(/\s+/g, " ").slice(0, 36);
  if (!value) return "";
  const upper = value.toUpperCase();
  if (["CO2", "DA", "LPG", "N2O", "O2", "N2", "H2"].includes(upper)) return upper;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pushUnique(list: string[], value: string) {
  if (value && !list.some((item) => item.toLowerCase() === value.toLowerCase())) list.push(value);
}

/** Split a stored "<size> <gas>" name. A name without a size ("DA") is just a gas. */
export function splitType(name: string): { size: string; gas: string } {
  const value = name.trim();
  const match = value.match(SIZE_RE);
  if (match && match[2]) return { size: cleanSize(match[1]!), gas: cleanGas(match[2]) };
  return { size: "", gas: cleanGas(value) };
}

export function joinType(size: string, gas: string) {
  return size ? `${size} ${gas}` : gas;
}

function sameList(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item.toLowerCase() === b[index]!.toLowerCase());
}

/** Group the stored flat list into gases and sizes. Every gas is offered in every size. */
export function groupTypes(types: string[]): { gases: string[]; sizes: string[] } {
  if (!types.length || sameList(types, LEGACY_DEFAULT)) return { gases: [...DEFAULT_GASES], sizes: [...DEFAULT_SIZES] };
  const gases: string[] = [];
  const sizes: string[] = [];
  for (const name of types) {
    const { size, gas } = splitType(name);
    pushUnique(gases, gas);
    pushUnique(sizes, size);
  }
  if (!sizes.length) sizes.push(...DEFAULT_SIZES);
  sizes.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return { gases, sizes };
}

/** Gases × sizes back to the stored flat list, gas by gas. */
export function buildTypes(gases: string[], sizes: string[]): string[] {
  const out: string[] = [];
  for (const gas of gases) for (const size of sizes) out.push(joinType(size, gas));
  return out;
}

export function isStandard(gases: string[], sizes: string[]) {
  return sameList(gases, DEFAULT_GASES) && sameList(sizes, DEFAULT_SIZES);
}
