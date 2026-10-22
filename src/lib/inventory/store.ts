import { create } from "zustand";
import {
  buildSample,
  parseBook,
  stockOf,
  todayISO,
  type CylinderType,
  type Movement,
  type MoveKind,
  type PersistedBook,
} from "@/lib/inventory/model";

export const STORAGE_KEY = "yardbook.v1";

type Data = {
  ready: boolean;
  holdSave: boolean;
  blockedRaw: string | null;
  yardName: string;
  types: CylinderType[];
  movements: Movement[];
  sample: boolean;
  bannerHidden: boolean;
};

type MoveInput = {
  date: string;
  typeId: string;
  kind: MoveKind;
  qty: number;
  party: string;
  note: string;
};

type Actions = {
  boot: () => void;
  setYardName: (name: string) => void;
  hideBanner: () => void;
  clearAll: () => void;
  loadSample: () => void;
  discardBlocked: () => void;
  addType: (input: { name: string; size: string; lowFull: number }) => string | null;
  updateType: (id: string, patch: { name: string; size: string; lowFull: number }) => void;
  setArchived: (id: string, archived: boolean) => void;
  removeType: (id: string) => boolean;
  addMovement: (input: MoveInput) => { ok: true } | { ok: false; error: string };
  removeMovement: (id: string) => void;
  restoreMovement: (m: Movement) => void;
  reconcileDay: (date: string, rows: Array<{ typeId: string; full: number; empty: number }>) => string | null;
  importBook: (data: PersistedBook) => void;
};

const emptyData = {
  yardName: "My yard",
  types: [] as CylinderType[],
  movements: [] as Movement[],
  sample: false,
  bannerHidden: false,
};

function payload(state: Data): PersistedBook {
  return {
    version: 1,
    yardName: state.yardName,
    types: state.types,
    movements: state.movements,
    sample: state.sample,
    bannerHidden: state.bannerHidden,
  };
}

export const useYard = create<Data & Actions>((set, get) => ({
  ready: false,
  holdSave: true,
  blockedRaw: null,
  ...emptyData,

  boot: () => {
    if (get().ready || typeof window === "undefined") return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const sample = buildSample(todayISO());
      set({
        ready: true,
        holdSave: false,
        blockedRaw: null,
        yardName: sample.yardName,
        types: sample.types,
        movements: sample.movements,
        sample: true,
        bannerHidden: false,
      });
      return;
    }
    const parsed = parseBook(raw);
    if (!parsed.ok) {
      set({ ready: true, holdSave: true, blockedRaw: raw });
      return;
    }
    set({
      ready: true,
      holdSave: false,
      blockedRaw: null,
      yardName: parsed.data.yardName,
      types: parsed.data.types,
      movements: parsed.data.movements,
      sample: parsed.data.sample,
      bannerHidden: parsed.data.bannerHidden,
    });
  },

  setYardName: (name) => {
    const trimmed = name.trim().slice(0, 60);
    if (!trimmed) return;
    set({ yardName: trimmed });
  },

  hideBanner: () => set({ bannerHidden: true }),

  clearAll: () => set({ ...emptyData }),

  loadSample: () => {
    const sample = buildSample(todayISO());
    set({
      yardName: sample.yardName,
      types: sample.types,
      movements: sample.movements,
      sample: true,
      bannerHidden: false,
      blockedRaw: null,
      holdSave: false,
    });
  },

  discardBlocked: () => set({ ...emptyData, blockedRaw: null, holdSave: false, ready: true }),

  addType: (input) => {
    const name = input.name.trim();
    if (!name) return null;
    const type: CylinderType = {
      id: crypto.randomUUID(),
      name: name.slice(0, 80),
      size: input.size.trim().slice(0, 80),
      lowFull: clampInt(input.lowFull, 0, 1_000_000),
      archived: false,
    };
    set((s) => ({ types: [...s.types, type] }));
    return type.id;
  },

  updateType: (id, patch) => {
    const name = patch.name.trim();
    if (!name) return;
    set((s) => ({
      types: s.types.map((t) =>
        t.id === id
          ? {
              ...t,
              name: name.slice(0, 80),
              size: patch.size.trim().slice(0, 80),
              lowFull: clampInt(patch.lowFull, 0, 1_000_000),
            }
          : t,
      ),
    }));
  },

  setArchived: (id, archived) =>
    set((s) => ({
      types: s.types.map((t) => (t.id === id ? { ...t, archived } : t)),
    })),

  removeType: (id) => {
    if (get().movements.some((m) => m.typeId === id)) return false;
    set((s) => ({ types: s.types.filter((t) => t.id !== id) }));
    return true;
  },

  addMovement: (input) => {
    const type = get().types.find((t) => t.id === input.typeId && !t.archived);
    if (!type) return { ok: false, error: "Pick a cylinder type that is still active." };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { ok: false, error: "Pick a valid date." };
    if (!Number.isFinite(input.qty) || !Number.isInteger(input.qty)) {
      return { ok: false, error: "Quantity has to be a whole number of cylinders." };
    }
    const adjusting = input.kind === "adjust_full" || input.kind === "adjust_empty";
    if (adjusting) {
      if (input.qty === 0) return { ok: false, error: "A correction of zero does nothing." };
      if (Math.abs(input.qty) > 100_000) return { ok: false, error: "That quantity is too large." };
    } else if (input.qty < 1 || input.qty > 100_000) {
      return { ok: false, error: "Enter a quantity from 1 to 100000." };
    }
    const movement: Movement = {
      id: crypto.randomUUID(),
      date: input.date,
      typeId: input.typeId,
      kind: input.kind,
      qty: input.qty,
      party: input.party.trim().slice(0, 80),
      note: input.note.trim().slice(0, 160),
      createdAt: new Date().toISOString(),
      source: "manual",
    };
    set((s) => ({ movements: [...s.movements, movement] }));
    return { ok: true };
  },

  removeMovement: (id) => set((s) => ({ movements: s.movements.filter((m) => m.id !== id) })),

  restoreMovement: (m) =>
    set((s) => (s.movements.some((x) => x.id === m.id) ? s : { movements: [...s.movements, m] })),

  reconcileDay: (date, rows) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick a valid date.";
    for (const row of rows) {
      if (!Number.isInteger(row.full) || !Number.isInteger(row.empty) || row.full < 0 || row.empty < 0) {
        return "Counts have to be whole numbers, zero or more.";
      }
      if (row.full > 1_000_000 || row.empty > 1_000_000) return "That count is too large.";
    }
    const current = get().movements;
    const kept = current.filter(
      (m) => !(m.date === date && m.source === "count" && rows.some((r) => r.typeId === m.typeId)),
    );
    const additions: Movement[] = [];
    const stamp = Date.now();
    rows.forEach((row, i) => {
      const book = stockOf(kept, row.typeId, { through: date });
      const fullDelta = row.full - book.full;
      const emptyDelta = row.empty - book.empty;
      if (fullDelta !== 0) {
        additions.push({
          id: crypto.randomUUID(),
          date,
          typeId: row.typeId,
          kind: "adjust_full",
          qty: fullDelta,
          party: "",
          note: "Physical count",
          createdAt: new Date(stamp + i).toISOString(),
          source: "count",
        });
      }
      if (emptyDelta !== 0) {
        additions.push({
          id: crypto.randomUUID(),
          date,
          typeId: row.typeId,
          kind: "adjust_empty",
          qty: emptyDelta,
          party: "",
          note: "Physical count",
          createdAt: new Date(stamp + i + rows.length).toISOString(),
          source: "count",
        });
      }
    });
    set({ movements: [...kept, ...additions] });
    return null;
  },

  importBook: (data) =>
    set({
      yardName: data.yardName,
      types: data.types,
      movements: data.movements,
      sample: false,
      bannerHidden: true,
      blockedRaw: null,
      holdSave: false,
      ready: true,
    }),
}));

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.round(n)));
}

if (typeof window !== "undefined") {
  useYard.subscribe((state) => {
    if (!state.ready || state.holdSave || state.blockedRaw) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload(state)));
    } catch {
      /* quota or private mode — the in-memory book still works this session */
    }
  });
}
