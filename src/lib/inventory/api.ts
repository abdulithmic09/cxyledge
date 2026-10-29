import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { addDays, todayISO } from "@/lib/inventory/model";
import { splitSerials, consumeSerials, cleanTypeList, DEFAULT_CYLINDER_TYPES } from "@/lib/inventory/serials";

export type PaymentStatus = "received" | "partial" | "unpaid";
export type MovementKind = "delivery" | "return" | "purchase";

export type EntryDraft = {
  companyName: string;
  entryDate: string;
  serialNo: string;
  quantity: number;
  paymentStatus: PaymentStatus;
  amountDue: number | null;
  amountPaid: number | null;
  note: string;
  movement: MovementKind;
  unitPrice: number | null;
  billNo: string;
  parentId: string | null;
  qtyOverride: boolean;
  cylinderType: string;
};

export type Entry = Omit<EntryDraft, "qtyOverride"> & {
  id: string;
  createdBy: string;
  updatedAt: string;
};

export type YardInfo = {
  id: string;
  name: string;
  inviteCode: string;
  role: string;
  members: number;
  address: string;
  gst: string;
  pan: string;
  phone: string;
  email: string;
  logo: string;
  lastBackupAt: string | null;
  /** The book's cylinder types, in the order shown when booking. */
  cylinderTypes: string[];
  yards: Array<{ id: string; name: string; active: boolean }>;
};

export type Role = "owner" | "staff" | "viewer";

/** Anything that isn't owner or viewer (including the old "member") is staff. */
export function normalizeRole(role: string | null | undefined): Role {
  if (role === "owner" || role === "viewer") return role;
  return "staff";
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", staff: "Staff", viewer: "View only" };

export const NEED_EDIT = "You have view-only access to this book. Ask the owner to make you Staff.";
export const NEED_OWNER = "Only the owner can do that. Ask the owner of this book.";

export function canEdit(yard: YardInfo) {
  return normalizeRole(yard.role) !== "viewer";
}

export function isOwner(yard: YardInfo) {
  return normalizeRole(yard.role) === "owner";
}

export type PaymentMode = "cash" | "upi" | "cheque" | "bank" | "other";
/** "charge" is a holding charge billed to the company (raises what they owe). */
export type PaymentDirection = "in" | "out" | "charge";

export const PAYMENT_MODES: Array<{ id: PaymentMode; label: string }> = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "cheque", label: "Cheque" },
  { id: "bank", label: "Bank transfer" },
  { id: "other", label: "Other" },
];

export type Payment = {
  id: string;
  companyName: string;
  direction: PaymentDirection;
  amount: number;
  paidOn: string;
  mode: PaymentMode;
  reference: string;
  billNo: string;
  note: string;
  receiptNo: string;
  createdBy: string;
  createdAt: string;
};

export type PaymentDraft = {
  companyName: string;
  direction: PaymentDirection;
  amount: number;
  paidOn: string;
  mode: PaymentMode;
  reference: string;
  billNo: string;
  note: string;
};

export type BinItem = {
  kind: "entry" | "document" | "payment";
  id: string;
  title: string;
  detail: string;
  deletedAt: string;
  deletedBy: string;
};

export type Letterhead = {
  address: string;
  gst: string;
  pan: string;
  phone: string;
  email?: string;
  logo: string;
};

export type DocRecord = {
  id: string;
  companyName: string;
  title: string;
  kind: string;
  mime: string;
  content: string;
  createdAt: string;
};

export type ReturnLog = {
  id: string;
  entryId: string | null;
  companyName: string;
  serials: string;
  quantity: number;
  actor: string;
  createdAt: string;
};

export type ReturnDraft = {
  entryId: string;
  serials: string[];
  quantity: number;
  note: string;
};

const STATUSES: PaymentStatus[] = ["received", "partial", "unpaid"];
const MOVEMENTS: MovementKind[] = ["delivery", "return", "purchase"];

export function parseEntry(input: EntryDraft): { ok: true; value: EntryDraft } | { ok: false; error: string } {
  const companyName = input.companyName.trim();
  if (!companyName) return { ok: false, error: "Enter the company name." };
  if (companyName.length > 120) return { ok: false, error: "Company name is too long." };
  if (!isRealDate(input.entryDate)) return { ok: false, error: "Pick a valid date." };
  const serials = splitSerials(input.serialNo);
  const serialNo = serials.join("\n");
  if (serialNo.length > 2000) return { ok: false, error: "Serial numbers are too long." };
  if (!MOVEMENTS.includes(input.movement)) return { ok: false, error: "Pick delivery, purchase, or return." };
  const quantity = input.qtyOverride ? input.quantity : serials.length > 0 ? serials.length : input.quantity;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
    if (!input.qtyOverride && serials.length === 0) {
      return { ok: false, error: "Add serial numbers, or turn on Override quantity." };
    }
    return { ok: false, error: "Number of cylinders has to be a whole number from 1 to 100000." };
  }
  if (!STATUSES.includes(input.paymentStatus)) return { ok: false, error: "Pick a payment status." };
  const amountDue = cleanMoney(input.amountDue);
  const amountPaid = cleanMoney(input.amountPaid);
  const unitPrice = cleanMoney(input.unitPrice);
  if (amountDue === "bad" || amountPaid === "bad" || unitPrice === "bad") {
    return { ok: false, error: "Amounts have to be zero or more." };
  }
  const note = input.note.trim();
  if (note.length > 300) return { ok: false, error: "Note is too long." };
  const billNo = input.billNo.trim().slice(0, 40);
  const cylinderType = (input.cylinderType ?? "").trim().slice(0, 60);
  const parentId = input.parentId?.trim() ? input.parentId.trim().slice(0, 80) : null;
  return {
    ok: true,
    value: {
      companyName,
      entryDate: input.entryDate,
      serialNo,
      quantity,
      paymentStatus: input.paymentStatus,
      amountDue,
      amountPaid,
      note,
      movement: input.movement,
      unitPrice,
      billNo,
      parentId,
      qtyOverride: input.qtyOverride,
      cylinderType,
    },
  };
}

export function isRealDate(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y!, (m ?? 1) - 1, d ?? 1);
  return dt.getFullYear() === y && dt.getMonth() === (m ?? 1) - 1 && dt.getDate() === d;
}

function cleanMoney(value: number | null): number | null | "bad" {
  if (value == null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) return "bad";
  return Math.round(value * 100) / 100;
}

type YardRow = {
  id: string;
  name: string;
  invite_code: string;
  role: string;
  address: string;
  gst: string;
  pan: string;
  phone: string;
  email?: string | null;
  logo: string;
  last_backup_at?: string | null;
  cylinder_types?: string | null;
};

export type EntryRow = {
  id: string;
  company_name: string;
  entry_date: string;
  serial_no: string;
  quantity: number;
  payment_status: PaymentStatus;
  amount_due: number | string | null;
  amount_paid: number | string | null;
  note: string;
  created_by: string;
  updated_at: string;
  movement: string;
  unit_price: number | string | null;
  bill_no: string;
  parent_id: string | null;
  cylinder_type: string | null;
};

export async function sqlClient() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

/** Record who did what in a book. Never blocks or breaks the action itself. */
export async function logActivity(yardId: string, userId: string, action: string, detail = ""): Promise<void> {
  try {
    const sql = await sqlClient();
    await sql`
      insert into activity_log (id, yard_id, user_id, action, detail)
      values (${crypto.randomUUID()}, ${yardId}, ${userId}, ${action.slice(0, 80)}, ${detail.slice(0, 500)})
    `;
  } catch {
    // the activity log is best-effort
  }
}

const MOVE_WORD: Record<string, string> = { delivery: "Delivery", return: "Return", purchase: "Purchase" };

export function describeEntry(v: { movement: string; quantity: number; cylinderType?: string | null; companyName: string; billNo?: string | null; amountDue?: number | null; entryDate: string }) {
  const kind = v.cylinderType ? ` × ${v.cylinderType}` : " cylinders";
  const bill = v.billNo ? ` · bill ${v.billNo}` : "";
  const amount = v.amountDue != null ? ` · ₹${Number(v.amountDue).toLocaleString("en-IN")}` : "";
  const day = v.entryDate.slice(0, 10).split("-").reverse().join("/");
  return `${MOVE_WORD[v.movement] ?? v.movement}: ${v.quantity}${kind} · ${v.companyName} · ${day}${bill}${amount}`;
}

function inviteCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function asMovement(value: string): MovementKind {
  if (value === "return" || value === "purchase") return value;
  return "delivery";
}

export async function ensureYard(userId: string): Promise<YardInfo> {
  const sql = await sqlClient();
  await sql`insert into profiles (user_id) values (${userId}) on conflict (user_id) do nothing`;

  const linked = await sql<YardRow>`
    select y.id, y.name, y.invite_code, m.role, y.address, y.gst, y.pan, y.phone, y.email, y.logo, y.last_backup_at::text as last_backup_at, y.cylinder_types
    from profiles p
    join yards y on y.id = p.active_yard_id
    join yard_members m on m.yard_id = y.id and m.user_id = p.user_id
    where p.user_id = ${userId}
  `;
  let current = linked[0];
  if (!current) {
    const any = await sql<YardRow>`
      select y.id, y.name, y.invite_code, m.role, y.address, y.gst, y.pan, y.phone, y.email, y.logo, y.last_backup_at::text as last_backup_at, y.cylinder_types
      from yard_members m
      join yards y on y.id = m.yard_id
      where m.user_id = ${userId}
      order by m.joined_at
      limit 1
    `;
    current = any[0];
    if (current) {
      await sql`update profiles set active_yard_id = ${current.id} where user_id = ${userId}`;
    }
  }
  if (!current) {
    current = await insertYard(userId, "My yard");
  }

  const yards = await sql<{ id: string; name: string }>`
    select y.id, y.name
    from yard_members m
    join yards y on y.id = m.yard_id
    where m.user_id = ${userId}
    order by y.name
  `;
  const counts = await sql<{ members: number }>`
    select count(*)::int as members from yard_members where yard_id = ${current.id}
  `;
  return mapYard(current, Number(counts[0]?.members ?? 1), yards);
}

async function insertYard(userId: string, name: string): Promise<YardRow> {
  const sql = await sqlClient();
  const id = crypto.randomUUID();
  let code = inviteCode();
  for (let i = 0; i < 5; i += 1) {
    const clash = await sql<{ id: string }>`select id from yards where invite_code = ${code}`;
    if (!clash.length) break;
    code = inviteCode();
  }
  await sql`
    insert into yards (id, name, invite_code, created_by)
    values (${id}, ${name}, ${code}, ${userId})
  `;
  await sql`
    insert into yard_members (yard_id, user_id, role)
    values (${id}, ${userId}, ${"owner"})
  `;
  await sql`insert into profiles (user_id, active_yard_id) values (${userId}, ${id})
    on conflict (user_id) do update set active_yard_id = ${id}`;
  return {
    id,
    name,
    invite_code: code,
    role: "owner",
    address: "",
    gst: "",
    pan: "",
    phone: "",
    logo: "",
  };
}

function readTypes(raw: string | null | undefined): string[] {
  if (!raw) return [...DEFAULT_CYLINDER_TYPES];
  try {
    const list = cleanTypeList(JSON.parse(raw));
    return list.length ? list : [...DEFAULT_CYLINDER_TYPES];
  } catch {
    return [...DEFAULT_CYLINDER_TYPES];
  }
}

function mapYard(current: YardRow, members: number, yards: Array<{ id: string; name: string }>): YardInfo {
  return {
    id: current.id,
    name: current.name,
    inviteCode: current.invite_code,
    role: current.role,
    members,
    address: current.address ?? "",
    gst: current.gst ?? "",
    pan: current.pan ?? "",
    phone: current.phone ?? "",
    email: current.email ?? "",
    logo: current.logo ?? "",
    lastBackupAt: current.last_backup_at ?? null,
    cylinderTypes: readTypes(current.cylinder_types),
    yards: yards.map((yard) => ({ id: yard.id, name: yard.name, active: yard.id === current.id })),
  };
}

export function mapEntry(row: EntryRow): Entry {
  return {
    id: row.id,
    companyName: row.company_name,
    entryDate: String(row.entry_date).slice(0, 10),
    serialNo: row.serial_no,
    quantity: Number(row.quantity),
    paymentStatus: row.payment_status,
    amountDue: row.amount_due == null ? null : Number(row.amount_due),
    amountPaid: row.amount_paid == null ? null : Number(row.amount_paid),
    note: row.note,
    createdBy: row.created_by,
    updatedAt: String(row.updated_at),
    movement: asMovement(row.movement),
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    billNo: row.bill_no ?? "",
    parentId: row.parent_id,
    cylinderType: row.cylinder_type ?? "",
  };
}

export const getYard = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    try {
      const sql = await sqlClient();
      await sql`
        update yard_members set last_seen_at = now()
        where yard_id = ${yard.id} and user_id = ${context.userId}
          and (last_seen_at is null or last_seen_at < now() - interval '1 minute')
      `;
    } catch {
      // last-seen is best-effort
    }
    return yard;
  });

export const listEntries = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<EntryRow>`
      select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
             amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
             note, created_by, updated_at::text as updated_at,
             movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
      from entries
      where yard_id = ${yard.id} and deleted_at is null and cancelled_at is null
      order by entry_date desc, updated_at desc
      limit 20000
    `;
    return rows.map(mapEntry);
  });

export const createEntry = createServerFn({ method: "POST" })
  .validator((input: EntryDraft) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const parsed = parseEntry(data);
    if (!parsed.ok) return parsed;
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const id = crypto.randomUUID();
    const value = parsed.value;
    const known = await sql<{ n: number }>`
      select count(*)::int as n from entries where yard_id = ${yard.id} and deleted_at is null and lower(company_name) = lower(${value.companyName})
    `;
    const rows = await sql<EntryRow>`
      insert into entries (
        id, yard_id, created_by, company_name, entry_date, serial_no, quantity,
        payment_status, amount_due, amount_paid, note, movement, unit_price, bill_no, parent_id, cylinder_type
      ) values (
        ${id}, ${yard.id}, ${context.userId}, ${value.companyName}, ${value.entryDate}, ${value.serialNo},
        ${value.quantity}, ${value.paymentStatus}, ${value.amountDue}, ${value.amountPaid}, ${value.note},
        ${value.movement}, ${value.unitPrice}, ${value.billNo}, ${value.parentId}, ${value.cylinderType}
      )
      returning id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
                amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
                note, created_by, updated_at::text as updated_at,
                movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
    `;
    if (!Number(known[0]?.n ?? 0)) await logActivity(yard.id, context.userId, "Added company", value.companyName);
    await logActivity(yard.id, context.userId, value.billNo && value.movement !== "return" ? "Added bill entry" : "Added entry", describeEntry(value));
    return { ok: true as const, entry: mapEntry(rows[0]!) };
  });

export const updateEntry = createServerFn({ method: "POST" })
  .validator((input: EntryDraft & { id: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const parsed = parseEntry(data);
    if (!parsed.ok) return parsed;
    if (!data.id) return { ok: false as const, error: "Missing entry." };
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const value = parsed.value;
    const rows = await sql<EntryRow>`
      update entries set
        company_name = ${value.companyName},
        entry_date = ${value.entryDate},
        serial_no = ${value.serialNo},
        quantity = ${value.quantity},
        payment_status = ${value.paymentStatus},
        amount_due = ${value.amountDue},
        amount_paid = ${value.amountPaid},
        note = ${value.note},
        movement = ${value.movement},
        unit_price = ${value.unitPrice},
        bill_no = ${value.billNo},
        parent_id = ${value.parentId},
        cylinder_type = ${value.cylinderType},
        updated_at = now()
      where id = ${data.id} and yard_id = ${yard.id} and deleted_at is null
      returning id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
                amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
                note, created_by, updated_at::text as updated_at,
                movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
    `;
    if (!rows[0]) return { ok: false as const, error: "That entry is not in this account." };
    await logActivity(yard.id, context.userId, "Edited entry", describeEntry(value));
    return { ok: true as const, entry: mapEntry(rows[0]) };
  });

export const deleteEntry = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    await purgeBin(yard.id);
    const rows = await sql<{ id: string; company_name: string; movement: string; quantity: number; cylinder_type: string | null; bill_no: string; amount_due: number | null; entry_date: string }>`
      update entries set deleted_at = now(), deleted_by = ${context.userId}
      where id = ${id} and yard_id = ${yard.id} and deleted_at is null
      returning id, company_name, movement, quantity, cylinder_type, bill_no, amount_due::float8 as amount_due, entry_date::text as entry_date
    `;
    const gone = rows[0];
    if (gone) {
      await logActivity(yard.id, context.userId, "Deleted entry", describeEntry({ movement: gone.movement, quantity: Number(gone.quantity), cylinderType: gone.cylinder_type, companyName: gone.company_name, billNo: gone.bill_no, amountDue: gone.amount_due, entryDate: String(gone.entry_date).slice(0, 10) }));
    }
    if (!gone) return { ok: false as const, error: "That entry is already gone." };
    return { ok: true as const };
  });

export const recordReturn = createServerFn({ method: "POST" })
  .validator((input: ReturnDraft) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    if (!data.entryId) return { ok: false as const, error: "Pick an open delivery." };
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const parents = await sql<EntryRow>`
      select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
             amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
             note, created_by, updated_at::text as updated_at,
             movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
      from entries
      where id = ${data.entryId} and yard_id = ${yard.id} and deleted_at is null
    `;
    const parent = parents[0];
    if (!parent || asMovement(parent.movement) !== "delivery") {
      return { ok: false as const, error: "Pick an open delivery." };
    }
    const children = await sql<{ quantity: number; serial_no: string }>`
      select quantity, serial_no from entries
      where yard_id = ${yard.id} and parent_id = ${data.entryId} and movement = ${"return"} and deleted_at is null
    `;
    const returnedQty = children.reduce((total, row) => total + Number(row.quantity), 0);
    const leftQty = Number(parent.quantity) - returnedQty;
    const parentSerials = splitSerials(parent.serial_no);
    const leftSerials = consumeSerials(
      parentSerials,
      children.flatMap((row) => splitSerials(row.serial_no)),
    );
    if (leftQty < 1) return { ok: false as const, error: "That delivery is already fully received." };

    let serialNo = "";
    let quantity = 0;
    if (parentSerials.length > 0) {
      const picked = splitSerials((data.serials ?? []).join("\n"));
      const allowed = new Set(leftSerials.map((serial) => serial.toLowerCase()));
      if (!picked.length || picked.some((serial) => !allowed.has(serial.toLowerCase()))) {
        return { ok: false as const, error: "Choose serials that are still out on that delivery." };
      }
      serialNo = picked.join("\n");
      quantity = picked.length;
      if (quantity > leftQty) return { ok: false as const, error: "That is more cylinders than are still out." };
    } else {
      quantity = Math.floor(Number(data.quantity));
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > leftQty) {
        return { ok: false as const, error: `Enter a count from 1 to ${leftQty}.` };
      }
    }

    const note = (data.note ?? "").trim().slice(0, 300) || "Marked received";
    const id = crypto.randomUUID();
    const today = todayISO();
    await sql`
      insert into entries (
        id, yard_id, created_by, company_name, entry_date, serial_no, quantity,
        payment_status, amount_due, amount_paid, note, movement, unit_price, bill_no, parent_id, cylinder_type
      ) values (
        ${id}, ${yard.id}, ${context.userId}, ${parent.company_name}, ${today}, ${serialNo},
        ${quantity}, ${"received"}, ${null}, ${null}, ${note},
        ${"return"}, ${null}, ${""}, ${parent.id}, ${parent.cylinder_type ?? ""}
      )
    `;
    await sql`
      insert into return_logs (id, yard_id, entry_id, company_name, serials, quantity, actor)
      values (${crypto.randomUUID()}, ${yard.id}, ${parent.id}, ${parent.company_name}, ${serialNo}, ${quantity}, ${context.userId})
    `;
    await logActivity(yard.id, context.userId, "Marked cylinders received", `${quantity} from ${parent.company_name}${serialNo ? ` · ${serialNo.split("\n").join(", ")}` : ""}`);
    return { ok: true as const };
  });

export const listReturns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      entry_id: string | null;
      company_name: string;
      serials: string;
      quantity: number;
      actor: string;
      created_at: string;
    }>`
      select id, entry_id, company_name, serials, quantity, actor, created_at::text as created_at
      from return_logs
      where yard_id = ${yard.id}
      order by created_at desc
      limit 200
    `;
    return rows.map(
      (row): ReturnLog => ({
        id: row.id,
        entryId: row.entry_id,
        companyName: row.company_name,
        serials: row.serials,
        quantity: Number(row.quantity),
        actor: row.actor,
        createdAt: row.created_at,
      }),
    );
  });

export const listDocuments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{
      id: string;
      company_name: string;
      title: string;
      kind: string;
      mime: string;
      content: string;
      created_at: string;
    }>`
      select id, company_name, title, kind, mime, content, created_at::text as created_at
      from documents
      where yard_id = ${yard.id} and deleted_at is null
      order by created_at desc
      limit 200
    `;
    return rows.map(
      (row): DocRecord => ({
        id: row.id,
        companyName: row.company_name,
        title: row.title,
        kind: row.kind,
        mime: row.mime,
        content: row.content,
        createdAt: row.created_at,
      }),
    );
  });

export const saveDocument = createServerFn({ method: "POST" })
  .validator((input: { companyName: string; title: string; kind: string; mime: string; content: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const title = data.title.trim().slice(0, 120);
    const companyName = data.companyName.trim().slice(0, 120);
    if (!title) return { ok: false as const, error: "Name the file." };
    if (!data.content || data.content.length > 400_000) {
      return { ok: false as const, error: "That file is too large. Keep each upload under 280 KB." };
    }
    const kind = data.kind === "bill" || data.kind === "report" ? data.kind : "upload";
    const mime = data.mime.trim().slice(0, 80) || "application/octet-stream";
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const id = crypto.randomUUID();
    await sql`
      insert into documents (id, yard_id, company_name, title, kind, mime, content, created_by)
      values (${id}, ${yard.id}, ${companyName}, ${title}, ${kind}, ${mime}, ${data.content}, ${context.userId})
    `;
    await logActivity(yard.id, context.userId, kind === "bill" ? "Made bill" : kind === "report" ? "Saved report" : "Uploaded file", `${title}${companyName ? ` · ${companyName}` : ""}`);
    return { ok: true as const, id };
  });

export const deleteDocument = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    await purgeBin(yard.id);
    const rows = await sql<{ id: string; title: string; company_name: string }>`
      update documents set deleted_at = now(), deleted_by = ${context.userId}
      where id = ${id} and yard_id = ${yard.id} and deleted_at is null
      returning id, title, company_name
    `;
    if (!rows[0]) return { ok: false as const, error: "That file is already gone." };
    await logActivity(yard.id, context.userId, "Deleted file", `${rows[0].title}${rows[0].company_name ? ` · ${rows[0].company_name}` : ""}`);
    return { ok: true as const };
  });

export const renameYard = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const name = data.trim().slice(0, 60);
    if (!name) return { ok: false as const, error: "Enter your company name." };
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    await sql`update yards set name = ${name} where id = ${yard.id}`;
    await logActivity(yard.id, context.userId, "Renamed account", `${yard.name} → ${name}`);
    return { ok: true as const, name };
  });

export const saveLetterhead = createServerFn({ method: "POST" })
  .validator((input: Letterhead) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const address = data.address.trim().slice(0, 240);
    const gst = data.gst.trim().slice(0, 20);
    const pan = data.pan.trim().slice(0, 12);
    const phone = data.phone.trim().slice(0, 40);
    const email = String(data.email ?? "").trim().slice(0, 80);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false as const, error: "That email doesn't look right." };
    const logo = data.logo.startsWith("data:image/") ? data.logo.slice(0, 120_000) : "";
    if (data.logo && !logo) return { ok: false as const, error: "Logo needs to be a small image." };
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    await sql`
      update yards set address = ${address}, gst = ${gst}, pan = ${pan}, phone = ${phone}, email = ${email}, logo = ${logo}
      where id = ${yard.id}
    `;
    await logActivity(yard.id, context.userId, "Updated letterhead");
    return { ok: true as const };
  });

export const createYard = createServerFn({ method: "POST" })
  .validator((name: string) => name)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const name = data.trim().slice(0, 60);
    if (!name) return { ok: false as const, error: "Name the new account." };
    const created = await insertYard(context.userId, name);
    await logActivity(created.id, context.userId, "Created account", name);
    return { ok: true as const };
  });

export const joinYard = createServerFn({ method: "POST" })
  .validator((code: string) => code)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const code = data.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 6) return { ok: false as const, error: "Enter the full code." };
    const sql = await sqlClient();
    const found = await sql<{ id: string }>`select id from yards where invite_code = ${code}`;
    if (!found[0]) return { ok: false as const, error: "No account uses that code." };
    const added = await sql<{ user_id: string }>`
      insert into yard_members (yard_id, user_id, role)
      values (${found[0].id}, ${context.userId}, ${"staff"})
      on conflict (yard_id, user_id) do nothing
      returning user_id
    `;
    if (added.length) await logActivity(found[0].id, context.userId, "Joined the book");
    await sql`insert into profiles (user_id) values (${context.userId}) on conflict (user_id) do nothing`;
    await sql`update profiles set active_yard_id = ${found[0].id} where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const switchYard = createServerFn({ method: "POST" })
  .validator((yardId: string) => yardId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: yardId }) => {
    const sql = await sqlClient();
    const member = await sql<{ yard_id: string }>`
      select yard_id from yard_members where yard_id = ${yardId} and user_id = ${context.userId}
    `;
    if (!member[0]) return { ok: false as const, error: "You are not in that account." };
    await sql`update profiles set active_yard_id = ${yardId} where user_id = ${context.userId}`;
    return { ok: true as const };
  });

export const seedSample = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    const existing = await sql<{ count: number }>`select count(*)::int as count from entries where yard_id = ${yard.id} and deleted_at is null`;
    if (Number(existing[0]?.count ?? 0) > 0) {
      return { ok: false as const, error: "Sample data is only added to an empty account." };
    }
    const today = todayISO();
    const rows = [
      {
        company: "Sharma Stores",
        date: addDays(today, -2),
        serials: "S-44101\nS-44102\nS-44103",
        qty: 3,
        status: "received",
        due: 3300,
        paid: 3300 as number | null,
        price: 1100,
        bill: "CX-SAMPLE-01",
        note: "D-Type Oxygen",
      },
      {
        company: "Metro Kitchen",
        date: addDays(today, -1),
        serials: "S-19021\nS-19022",
        qty: 2,
        status: "partial",
        due: 3700,
        paid: 1000 as number | null,
        price: 1850,
        bill: "CX-SAMPLE-02",
        note: "B-Type Oxygen",
      },
      {
        company: "City Hospital",
        date: today,
        serials: "S-47501",
        qty: 1,
        status: "unpaid",
        due: 4200,
        paid: null as number | null,
        price: 4200,
        bill: "CX-SAMPLE-03",
        note: "D-Type Nitrogen",
      },
    ];
    let firstId = "";
    for (const row of rows) {
      const id = crypto.randomUUID();
      if (!firstId) firstId = id;
      await sql`
        insert into entries (
          id, yard_id, created_by, company_name, entry_date, serial_no, quantity,
          payment_status, amount_due, amount_paid, note, movement, unit_price, bill_no, cylinder_type
        ) values (
          ${id}, ${yard.id}, ${context.userId}, ${row.company}, ${row.date}, ${row.serials}, ${row.qty},
          ${row.status}, ${row.due}, ${row.paid}, ${row.note}, ${"delivery"}, ${row.price}, ${row.bill}, ${row.note}
        )
      `;
    }
    await sql`
      insert into entries (
        id, yard_id, created_by, company_name, entry_date, serial_no, quantity,
        payment_status, note, movement, bill_no, parent_id, cylinder_type
      ) values (
        ${crypto.randomUUID()}, ${yard.id}, ${context.userId}, ${"Sharma Stores"}, ${today}, ${"S-44101"}, ${1},
        ${"received"}, ${"Sample return"}, ${"return"}, ${""}, ${firstId}, ${"D-Type Oxygen"}
      )
    `;
    await sql`
      insert into return_logs (id, yard_id, entry_id, company_name, serials, quantity, actor)
      values (${crypto.randomUUID()}, ${yard.id}, ${firstId}, ${"Sharma Stores"}, ${"S-44101"}, ${1}, ${context.userId})
    `;
    return { ok: true as const };
  });

export type CompanyMeta = { companyName: string; keywords: string; notes: string; phone: string; prices: Record<string, number>; updatedAt: string };

/** A company's rate card from its stored JSON. Bad values are dropped. */
export function readPrices(raw: string | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    for (const [type, value] of Object.entries(parsed ?? {})) {
      const price = Number(value);
      if (type.trim() && Number.isFinite(price) && price >= 0 && price <= 10_000_000) out[type.trim().slice(0, 60)] = Math.round(price * 100) / 100;
    }
  } catch {
    // ignore a damaged rate card
  }
  return out;
}

export const listCompanyMeta = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{ company_name: string; keywords: string; notes: string; phone: string; prices: string | null; updated_at: string }>`
      select company_name, keywords, notes, phone, prices, updated_at::text as updated_at
      from company_meta
      where yard_id = ${yard.id}
    `;
    return rows.map(
      (row): CompanyMeta => ({ companyName: row.company_name, keywords: row.keywords, notes: row.notes, phone: row.phone ?? "", prices: readPrices(row.prices), updatedAt: row.updated_at }),
    );
  });

export const saveCompanyMeta = createServerFn({ method: "POST" })
  .validator((input: { companyName: string; keywords: string; notes: string; phone?: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const companyName = data.companyName.trim().slice(0, 120);
    if (!companyName) return { ok: false as const, error: "Pick a company." };
    const keywords = data.keywords.trim().slice(0, 300);
    const notes = data.notes.trim().slice(0, 1000);
    const phone = String(data.phone ?? "").replace(/[^\d+ -]/g, "").trim().slice(0, 20);
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    await sql`
      insert into company_meta (yard_id, company_name, keywords, notes, phone)
      values (${yard.id}, ${companyName}, ${keywords}, ${notes}, ${phone})
      on conflict (yard_id, company_name) do update set keywords = ${keywords}, notes = ${notes}, phone = ${phone}, updated_at = now()
    `;
    await logActivity(yard.id, context.userId, "Updated company notes", companyName);
    return { ok: true as const };
  });

/** Book name for an invite code, shown on the sign-in screen. No sign-in needed. */
export const peekInvite = createServerFn({ method: "GET" })
  .validator((code: string) => code)
  .handler(async ({ data }) => {
    const code = String(data ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length < 6) return { ok: false as const };
    const sql = await sqlClient();
    const rows = await sql<{ name: string }>`select name from yards where invite_code = ${code}`;
    return rows[0] ? { ok: true as const, name: rows[0].name } : { ok: false as const };
  });

/** Replace this book's invite code, so old invite links and codes stop working. Owners only. */
export const rotateInviteCode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    if (yard.role !== "owner") return { ok: false as const, error: "Only the account owner can change the invite." };
    const sql = await sqlClient();
    let code = inviteCode();
    for (let i = 0; i < 5; i += 1) {
      const clash = await sql<{ id: string }>`select id from yards where invite_code = ${code}`;
      if (!clash.length) break;
      code = inviteCode();
    }
    await sql`update yards set invite_code = ${code} where id = ${yard.id}`;
    await logActivity(yard.id, context.userId, "Turned off old invite links");
    return { ok: true as const, code };
  });

export type Member = {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  role: string;
  joinedAt: string;
  lastSeenAt: string | null;
  actions: number;
  lastActionAt: string | null;
  isYou: boolean;
};

export type Activity = { id: string; userId: string; action: string; detail: string; createdAt: string };

/** Everyone in the active book, with when they last used it and how much they've done. */
export const listMembers = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{
      user_id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      role: string;
      joined_at: string;
      last_seen_at: string | null;
      actions: number;
      last_action_at: string | null;
    }>`
      select m.user_id, u.name, u.email, u.image, m.role, m.joined_at::text as joined_at,
             m.last_seen_at::text as last_seen_at,
             (select count(*)::int from activity_log a where a.yard_id = m.yard_id and a.user_id = m.user_id) as actions,
             (select max(a.created_at)::text from activity_log a where a.yard_id = m.yard_id and a.user_id = m.user_id) as last_action_at
      from yard_members m
      left join "user" u on u.id = m.user_id
      where m.yard_id = ${yard.id}
      order by (m.role = 'owner') desc, m.joined_at
    `;
    return rows.map(
      (row): Member => ({
        userId: row.user_id,
        name: row.name ?? "Unknown user",
        email: row.email ?? "",
        image: row.image,
        role: normalizeRole(row.role),
        joinedAt: row.joined_at,
        lastSeenAt: row.last_seen_at,
        actions: Number(row.actions ?? 0),
        lastActionAt: row.last_action_at,
        isYou: row.user_id === context.userId,
      }),
    );
  });

/** The book's activity log, newest first. */
export const listActivity = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{ id: string; user_id: string; action: string; detail: string; created_at: string }>`
      select id, user_id, action, detail, created_at::text as created_at
      from activity_log
      where yard_id = ${yard.id}
      order by created_at desc
      limit 1000
    `;
    return rows.map((row): Activity => ({ id: row.id, userId: row.user_id, action: row.action, detail: row.detail, createdAt: row.created_at }));
  });

// ---------------------------------------------------------------------------
// Recently deleted bin (30 days)
// ---------------------------------------------------------------------------

/** Permanently remove anything that has sat in the bin for more than 30 days. */
async function purgeBin(yardId: string) {
  try {
    const sql = await sqlClient();
    await sql`delete from entries where yard_id = ${yardId} and deleted_at < now() - interval '30 days'`;
    await sql`delete from documents where yard_id = ${yardId} and deleted_at < now() - interval '30 days'`;
    await sql`delete from payments where yard_id = ${yardId} and deleted_at < now() - interval '30 days'`;
  } catch {
    // clean-up is best-effort
  }
}

export const listDeleted = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return [] as BinItem[];
    await purgeBin(yard.id);
    const sql = await sqlClient();
    const entries = await sql<{ id: string; company_name: string; movement: string; quantity: number; cylinder_type: string | null; bill_no: string; amount_due: number | null; entry_date: string; deleted_at: string; deleted_by: string | null }>`
      select id, company_name, movement, quantity, cylinder_type, bill_no, amount_due::float8 as amount_due,
             entry_date::text as entry_date, deleted_at::text as deleted_at, deleted_by
      from entries where yard_id = ${yard.id} and deleted_at is not null
      order by deleted_at desc limit 300
    `;
    const docs = await sql<{ id: string; title: string; company_name: string; kind: string; deleted_at: string; deleted_by: string | null }>`
      select id, title, company_name, kind, deleted_at::text as deleted_at, deleted_by
      from documents where yard_id = ${yard.id} and deleted_at is not null
      order by deleted_at desc limit 300
    `;
    const pays = await sql<{ id: string; company_name: string; direction: string; amount: number; paid_on: string; mode: string; receipt_no: string; deleted_at: string; deleted_by: string | null }>`
      select id, company_name, direction, amount::float8 as amount, paid_on::text as paid_on, mode, receipt_no,
             deleted_at::text as deleted_at, deleted_by
      from payments where yard_id = ${yard.id} and deleted_at is not null
      order by deleted_at desc limit 300
    `;
    const items: BinItem[] = [
      ...entries.map((row) => ({
        kind: "entry" as const,
        id: row.id,
        title: `${MOVE_WORD[row.movement] ?? "Entry"} · ${row.company_name}`,
        detail: describeEntry({ movement: row.movement, quantity: Number(row.quantity), cylinderType: row.cylinder_type, companyName: row.company_name, billNo: row.bill_no, amountDue: row.amount_due, entryDate: String(row.entry_date) }),
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by ?? "",
      })),
      ...docs.map((row) => ({
        kind: "document" as const,
        id: row.id,
        title: `File · ${row.title}`,
        detail: `${row.kind}${row.company_name ? ` · ${row.company_name}` : ""}`,
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by ?? "",
      })),
      ...pays.map((row) => ({
        kind: "payment" as const,
        id: row.id,
        title: `${row.direction === "out" ? "Payment made" : "Payment received"} · ${row.company_name}`,
        detail: `${row.receipt_no ? `${row.receipt_no} · ` : ""}₹${Number(row.amount).toLocaleString("en-IN")} · ${row.mode.toUpperCase()} · ${String(row.paid_on).split("-").reverse().join("/")}`,
        deletedAt: row.deleted_at,
        deletedBy: row.deleted_by ?? "",
      })),
    ];
    return items.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : -1));
  });

type BinRef = { kind: BinItem["kind"]; id: string };

function binTable(kind: string) {
  return kind === "entry" || kind === "document" || kind === "payment" ? kind : null;
}

export const restoreDeleted = createServerFn({ method: "POST" })
  .validator((input: BinRef) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const kind = binTable(data.kind);
    if (!kind) return { ok: false as const, error: "Unknown item." };
    const sql = await sqlClient();
    let label = "";
    if (kind === "entry") {
      const rows = await sql<{ company_name: string; movement: string; quantity: number; cylinder_type: string | null; bill_no: string; amount_due: number | null; entry_date: string }>`
        update entries set deleted_at = null, deleted_by = null, updated_at = now()
        where id = ${data.id} and yard_id = ${yard.id} and deleted_at is not null
        returning company_name, movement, quantity, cylinder_type, bill_no, amount_due::float8 as amount_due, entry_date::text as entry_date
      `;
      if (!rows[0]) return { ok: false as const, error: "That item is no longer in the bin." };
      const row = rows[0];
      label = describeEntry({ movement: row.movement, quantity: Number(row.quantity), cylinderType: row.cylinder_type, companyName: row.company_name, billNo: row.bill_no, amountDue: row.amount_due, entryDate: String(row.entry_date) });
    } else if (kind === "document") {
      const rows = await sql<{ title: string }>`
        update documents set deleted_at = null, deleted_by = null
        where id = ${data.id} and yard_id = ${yard.id} and deleted_at is not null returning title
      `;
      if (!rows[0]) return { ok: false as const, error: "That item is no longer in the bin." };
      label = rows[0].title;
    } else {
      const rows = await sql<{ company_name: string; amount: number }>`
        update payments set deleted_at = null, deleted_by = null
        where id = ${data.id} and yard_id = ${yard.id} and deleted_at is not null returning company_name, amount::float8 as amount
      `;
      if (!rows[0]) return { ok: false as const, error: "That item is no longer in the bin." };
      label = `₹${Number(rows[0].amount).toLocaleString("en-IN")} · ${rows[0].company_name}`;
    }
    await logActivity(yard.id, context.userId, "Restored from bin", label);
    return { ok: true as const };
  });

export const purgeDeleted = createServerFn({ method: "POST" })
  .validator((input: BinRef) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const kind = binTable(data.kind);
    if (!kind) return { ok: false as const, error: "Unknown item." };
    const sql = await sqlClient();
    if (kind === "entry") await sql`delete from entries where id = ${data.id} and yard_id = ${yard.id} and deleted_at is not null`;
    if (kind === "document") await sql`delete from documents where id = ${data.id} and yard_id = ${yard.id} and deleted_at is not null`;
    if (kind === "payment") await sql`delete from payments where id = ${data.id} and yard_id = ${yard.id} and deleted_at is not null`;
    await logActivity(yard.id, context.userId, "Deleted forever from bin", kind);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Roles and removing people
// ---------------------------------------------------------------------------

async function ownerCount(yardId: string) {
  const sql = await sqlClient();
  const rows = await sql<{ n: number }>`select count(*)::int as n from yard_members where yard_id = ${yardId} and role = 'owner'`;
  return Number(rows[0]?.n ?? 0);
}

async function memberLabel(userId: string) {
  const sql = await sqlClient();
  const rows = await sql<{ name: string | null; email: string | null }>`select name, email from "user" where id = ${userId}`;
  const row = rows[0];
  if (!row) return "a member";
  return row.email ? `${row.name ?? ""} (${row.email})`.trim() : (row.name ?? "a member");
}

export const setMemberRole = createServerFn({ method: "POST" })
  .validator((input: { userId: string; role: Role }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const role = data.role === "owner" || data.role === "viewer" || data.role === "staff" ? data.role : null;
    if (!role) return { ok: false as const, error: "Pick Owner, Staff or View only." };
    const sql = await sqlClient();
    const current = await sql<{ role: string }>`select role from yard_members where yard_id = ${yard.id} and user_id = ${data.userId}`;
    if (!current[0]) return { ok: false as const, error: "That person is not in this book." };
    if (normalizeRole(current[0].role) === "owner" && role !== "owner" && (await ownerCount(yard.id)) <= 1) {
      return { ok: false as const, error: "A book needs at least one owner. Make someone else Owner first." };
    }
    await sql`update yard_members set role = ${role} where yard_id = ${yard.id} and user_id = ${data.userId}`;
    await logActivity(yard.id, context.userId, "Changed role", `${await memberLabel(data.userId)} → ${ROLE_LABEL[role]}`);
    return { ok: true as const };
  });

export const removeMember = createServerFn({ method: "POST" })
  .validator((userId: string) => userId)
  .middleware([authMiddleware])
  .handler(async ({ context, data: userId }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    const current = await sql<{ role: string }>`select role from yard_members where yard_id = ${yard.id} and user_id = ${userId}`;
    if (!current[0]) return { ok: false as const, error: "That person is not in this book." };
    if (normalizeRole(current[0].role) === "owner" && (await ownerCount(yard.id)) <= 1) {
      return { ok: false as const, error: "You're the only owner, so you can't be removed. Make someone else Owner first." };
    }
    const label = await memberLabel(userId);
    await sql`delete from yard_members where yard_id = ${yard.id} and user_id = ${userId}`;
    await sql`update profiles set active_yard_id = null where user_id = ${userId} and active_yard_id = ${yard.id}`;
    // A new invite code, so the old link can't be used to get back in.
    let code = inviteCode();
    for (let i = 0; i < 5; i += 1) {
      const clash = await sql<{ id: string }>`select id from yards where invite_code = ${code}`;
      if (!clash.length) break;
      code = inviteCode();
    }
    await sql`update yards set invite_code = ${code} where id = ${yard.id}`;
    await logActivity(yard.id, context.userId, "Removed member", label);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export type PaymentRow = {
  id: string;
  company_name: string;
  direction: string;
  amount: number | string;
  paid_on: string;
  mode: string;
  reference: string;
  bill_no: string;
  note: string;
  receipt_no: string;
  created_by: string;
  created_at: string;
};

const MODES: PaymentMode[] = ["cash", "upi", "cheque", "bank", "other"];

export function mapPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    companyName: row.company_name,
    direction: row.direction === "out" ? "out" : row.direction === "charge" ? "charge" : "in",
    amount: Number(row.amount),
    paidOn: String(row.paid_on).slice(0, 10),
    mode: MODES.includes(row.mode as PaymentMode) ? (row.mode as PaymentMode) : "other",
    reference: row.reference ?? "",
    billNo: row.bill_no ?? "",
    note: row.note ?? "",
    receiptNo: row.receipt_no ?? "",
    createdBy: row.created_by,
    createdAt: String(row.created_at),
  };
}

export function parsePayment(input: PaymentDraft): { ok: true; value: PaymentDraft } | { ok: false; error: string } {
  const companyName = String(input.companyName ?? "").trim().slice(0, 120);
  if (!companyName) return { ok: false, error: "Pick the company." };
  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000_000) return { ok: false, error: "Enter an amount above ₹0." };
  if (!isRealDate(String(input.paidOn ?? ""))) return { ok: false, error: "Pick a valid date." };
  const mode = MODES.includes(input.mode) ? input.mode : null;
  if (!mode) return { ok: false, error: "Pick how it was paid." };
  return {
    ok: true,
    value: {
      companyName,
      direction: input.direction === "out" ? "out" : "in",
      amount,
      paidOn: input.paidOn,
      mode,
      reference: String(input.reference ?? "").trim().slice(0, 60),
      billNo: String(input.billNo ?? "").trim().slice(0, 40),
      note: String(input.note ?? "").trim().slice(0, 300),
    },
  };
}

export const listPayments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<PaymentRow>`
      select id, company_name, direction, amount::float8 as amount, paid_on::text as paid_on, mode, reference, bill_no, note, receipt_no, created_by, created_at::text as created_at
      from payments
      where yard_id = ${yard.id} and deleted_at is null
      order by paid_on desc, created_at desc
      limit 3000
    `;
    return rows.map(mapPayment);
  });

export const createPayment = createServerFn({ method: "POST" })
  .validator((input: PaymentDraft) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const parsed = parsePayment(data);
    if (!parsed.ok) return parsed;
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const value = parsed.value;
    const prefix = value.direction === "out" ? "P-" : "R-";
    const last = await sql<{ n: number | null }>`
      select max(nullif(regexp_replace(receipt_no, '[^0-9]', '', 'g'), '')::int) as n
      from payments where yard_id = ${yard.id} and direction = ${value.direction}
    `;
    const receiptNo = `${prefix}${String(Number(last[0]?.n ?? 0) + 1).padStart(4, "0")}`;
    const rows = await sql<PaymentRow>`
      insert into payments (id, yard_id, company_name, direction, amount, paid_on, mode, reference, bill_no, note, receipt_no, created_by)
      values (${crypto.randomUUID()}, ${yard.id}, ${value.companyName}, ${value.direction}, ${value.amount}, ${value.paidOn},
              ${value.mode}, ${value.reference}, ${value.billNo}, ${value.note}, ${receiptNo}, ${context.userId})
      returning id, company_name, direction, amount::float8 as amount, paid_on::text as paid_on, mode, reference, bill_no, note, receipt_no, created_by, created_at::text as created_at
    `;
    await logActivity(
      yard.id,
      context.userId,
      value.direction === "out" ? "Recorded payment made" : "Recorded payment received",
      `${receiptNo} · ₹${value.amount.toLocaleString("en-IN")} · ${value.companyName} · ${value.mode.toUpperCase()}${value.billNo ? ` · bill ${value.billNo}` : ""}`,
    );
    return { ok: true as const, payment: mapPayment(rows[0]!) };
  });

export const deletePayment = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    await purgeBin(yard.id);
    const rows = await sql<{ receipt_no: string; amount: number; company_name: string }>`
      update payments set deleted_at = now(), deleted_by = ${context.userId}
      where id = ${id} and yard_id = ${yard.id} and deleted_at is null
      returning receipt_no, amount::float8 as amount, company_name
    `;
    if (!rows[0]) return { ok: false as const, error: "That payment is already gone." };
    await logActivity(yard.id, context.userId, "Deleted payment", `${rows[0].receipt_no} · ₹${Number(rows[0].amount).toLocaleString("en-IN")} · ${rows[0].company_name}`);
    return { ok: true as const };
  });

// ---------------------------------------------------------------------------
// Whole-book backup and restore
// ---------------------------------------------------------------------------

export type BackupDocument = { id: string; companyName: string; title: string; kind: string; mime: string; createdAt: string; content?: string; size?: number };

export type BackupFile = {
  format: "cxyledge-backup";
  version: 1;
  exportedAt: string;
  book: { name: string; address: string; gst: string; pan: string; phone: string; email?: string; logo: string };
  members: Array<{ name: string; email: string; role: Role }>;
  entries: Array<Entry>;
  returnLogs: Array<ReturnLog>;
  payments: Array<Payment>;
  companyMeta: Array<CompanyMeta>;
  documents: Array<BackupDocument>;
  activity: Array<Activity & { who: string }>;
};

/** Everything in the book except file contents (fetched separately in batches to stay under response limits). */
export const exportBackup = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    const entries = await sql<EntryRow>`
      select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
             amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
             note, created_by, updated_at::text as updated_at,
             movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
      from entries where yard_id = ${yard.id} and deleted_at is null and cancelled_at is null
      order by entry_date, created_at
    `;
    const logs = await sql<{ id: string; entry_id: string | null; company_name: string; serials: string; quantity: number; actor: string; created_at: string }>`
      select id, entry_id, company_name, serials, quantity, actor, created_at::text as created_at
      from return_logs where yard_id = ${yard.id} order by created_at
    `;
    const pays = await sql<PaymentRow>`
      select id, company_name, direction, amount::float8 as amount, paid_on::text as paid_on, mode, reference, bill_no, note, receipt_no, created_by, created_at::text as created_at
      from payments where yard_id = ${yard.id} and deleted_at is null order by paid_on, created_at
    `;
    const meta = await sql<{ company_name: string; keywords: string; notes: string; phone: string; prices: string | null; updated_at: string }>`
      select company_name, keywords, notes, phone, prices, updated_at::text as updated_at from company_meta where yard_id = ${yard.id}
    `;
    const docs = await sql<{ id: string; company_name: string; title: string; kind: string; mime: string; created_at: string; size: number }>`
      select id, company_name, title, kind, mime, created_at::text as created_at, length(content)::int as size
      from documents where yard_id = ${yard.id} and deleted_at is null order by created_at
    `;
    const members = await sql<{ name: string | null; email: string | null; role: string }>`
      select u.name, u.email, m.role from yard_members m left join "user" u on u.id = m.user_id where m.yard_id = ${yard.id}
    `;
    const activity = await sql<{ id: string; user_id: string; action: string; detail: string; created_at: string; who: string | null }>`
      select a.id, a.user_id, a.action, a.detail, a.created_at::text as created_at, coalesce(u.email, u.name) as who
      from activity_log a left join "user" u on u.id = a.user_id
      where a.yard_id = ${yard.id} order by a.created_at desc limit 5000
    `;
    await sql`update yards set last_backup_at = now() where id = ${yard.id}`;
    await logActivity(yard.id, context.userId, "Downloaded backup", `${entries.length} entries · ${pays.length} payments · ${docs.length} files`);
    const backup: BackupFile = {
      format: "cxyledge-backup",
      version: 1,
      exportedAt: new Date().toISOString(),
      book: { name: yard.name, address: yard.address, gst: yard.gst, pan: yard.pan, phone: yard.phone, email: yard.email, logo: yard.logo },
      members: members.map((row) => ({ name: row.name ?? "", email: row.email ?? "", role: normalizeRole(row.role) })),
      entries: entries.map(mapEntry),
      returnLogs: logs.map((row) => ({ id: row.id, entryId: row.entry_id, companyName: row.company_name, serials: row.serials, quantity: Number(row.quantity), actor: row.actor, createdAt: row.created_at })),
      payments: pays.map(mapPayment),
      companyMeta: meta.map((row) => ({ companyName: row.company_name, keywords: row.keywords, notes: row.notes, phone: row.phone ?? "", prices: readPrices(row.prices), updatedAt: row.updated_at })),
      documents: docs.map((row) => ({ id: row.id, companyName: row.company_name, title: row.title, kind: row.kind, mime: row.mime, createdAt: row.created_at, size: Number(row.size) })),
      activity: activity.map((row) => ({ id: row.id, userId: row.user_id, action: row.action, detail: row.detail, createdAt: row.created_at, who: row.who ?? "" })),
    };
    return { ok: true as const, backup };
  });

/** File contents for a backup, a few at a time. */
export const exportDocumentContents = createServerFn({ method: "POST" })
  .validator((ids: string[]) => ids)
  .middleware([authMiddleware])
  .handler(async ({ context, data: ids }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const wanted = (Array.isArray(ids) ? ids : []).slice(0, 40).map(String);
    if (!wanted.length) return { ok: true as const, contents: [] as Array<{ id: string; content: string }> };
    const sql = await sqlClient();
    const rows = await sql<{ id: string; content: string }>`
      select id, content from documents where yard_id = ${yard.id} and id = any(${wanted})
    `;
    return { ok: true as const, contents: rows };
  });

/** Start a restore: a brand-new book owned by the person restoring. Nothing existing is touched. */
export const startRestore = createServerFn({ method: "POST" })
  .validator((input: { name: string; book: BackupFile["book"] }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const name = String(data.name ?? "").trim().slice(0, 60) || "Restored book";
    const created = await insertYard(context.userId, name);
    const book = data.book ?? ({} as BackupFile["book"]);
    const logo = String(book.logo ?? "").startsWith("data:image/") ? String(book.logo).slice(0, 120_000) : "";
    const sql = await sqlClient();
    await sql`
      update yards set address = ${String(book.address ?? "").slice(0, 240)}, gst = ${String(book.gst ?? "").slice(0, 20)},
        pan = ${String(book.pan ?? "").slice(0, 12)}, phone = ${String(book.phone ?? "").slice(0, 40)}, email = ${String(book.email ?? "").slice(0, 80)}, logo = ${logo}
      where id = ${created.id}
    `;
    await logActivity(created.id, context.userId, "Restored from backup", name);
    return { ok: true as const, yardId: created.id };
  });

type RestoreChunk = {
  yardId: string;
  entries?: Entry[];
  returnLogs?: ReturnLog[];
  payments?: Payment[];
  companyMeta?: CompanyMeta[];
  documents?: BackupDocument[];
};

/** Add one batch of rows to a book being restored. Ids are fresh ones chosen by the browser. */
export const restoreChunk = createServerFn({ method: "POST" })
  .validator((input: RestoreChunk) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const sql = await sqlClient();
    const owner = await sql<{ role: string }>`select role from yard_members where yard_id = ${data.yardId} and user_id = ${context.userId}`;
    if (normalizeRole(owner[0]?.role) !== "owner" || !owner[0]) return { ok: false as const, error: NEED_OWNER };
    const yardId = data.yardId;
    let added = 0;
    for (const raw of (data.entries ?? []).slice(0, 400)) {
      const parsed = parseEntry({ ...raw, qtyOverride: true, cylinderType: raw.cylinderType ?? "", parentId: raw.parentId ?? null });
      if (!parsed.ok) continue;
      const v = parsed.value;
      await sql`
        insert into entries (id, yard_id, created_by, company_name, entry_date, serial_no, quantity, payment_status,
          amount_due, amount_paid, note, movement, unit_price, bill_no, parent_id, cylinder_type)
        values (${String(raw.id)}, ${yardId}, ${String(raw.createdBy || context.userId)}, ${v.companyName}, ${v.entryDate}, ${v.serialNo},
          ${v.quantity}, ${v.paymentStatus}, ${v.amountDue}, ${v.amountPaid}, ${v.note}, ${v.movement}, ${v.unitPrice}, ${v.billNo},
          ${v.parentId}, ${v.cylinderType})
        on conflict (id) do nothing
      `;
      added += 1;
    }
    for (const row of (data.returnLogs ?? []).slice(0, 400)) {
      await sql`
        insert into return_logs (id, yard_id, entry_id, company_name, serials, quantity, actor, created_at)
        values (${String(row.id)}, ${yardId}, ${row.entryId ? String(row.entryId) : null}, ${String(row.companyName).slice(0, 120)},
          ${String(row.serials ?? "").slice(0, 2000)}, ${Math.max(0, Math.floor(Number(row.quantity) || 0))}, ${String(row.actor ?? "")},
          ${isNaN(Date.parse(row.createdAt)) ? new Date().toISOString() : row.createdAt})
        on conflict (id) do nothing
      `;
      added += 1;
    }
    for (const raw of (data.payments ?? []).slice(0, 400)) {
      const parsed = parsePayment(raw);
      if (!parsed.ok) continue;
      const v = parsed.value;
      await sql`
        insert into payments (id, yard_id, company_name, direction, amount, paid_on, mode, reference, bill_no, note, receipt_no, created_by)
        values (${String(raw.id)}, ${yardId}, ${v.companyName}, ${v.direction}, ${v.amount}, ${v.paidOn}, ${v.mode}, ${v.reference},
          ${v.billNo}, ${v.note}, ${String(raw.receiptNo ?? "").slice(0, 20)}, ${String(raw.createdBy || context.userId)})
        on conflict (id) do nothing
      `;
      added += 1;
    }
    for (const row of (data.companyMeta ?? []).slice(0, 400)) {
      const companyName = String(row.companyName ?? "").trim().slice(0, 120);
      if (!companyName) continue;
      await sql`
        insert into company_meta (yard_id, company_name, keywords, notes, phone, prices)
        values (${yardId}, ${companyName}, ${String(row.keywords ?? "").slice(0, 300)}, ${String(row.notes ?? "").slice(0, 1000)}, ${String(row.phone ?? "").slice(0, 20)}, ${JSON.stringify(readPrices(JSON.stringify(row.prices ?? {})))})
        on conflict (yard_id, company_name) do nothing
      `;
      added += 1;
    }
    for (const row of (data.documents ?? []).slice(0, 40)) {
      const content = String(row.content ?? "");
      if (!content || content.length > 400_000) continue;
      const kind = row.kind === "bill" || row.kind === "report" ? row.kind : "upload";
      await sql`
        insert into documents (id, yard_id, company_name, title, kind, mime, content, created_by)
        values (${String(row.id)}, ${yardId}, ${String(row.companyName ?? "").slice(0, 120)}, ${String(row.title ?? "File").slice(0, 120)},
          ${kind}, ${String(row.mime ?? "application/octet-stream").slice(0, 80)}, ${content}, ${context.userId})
        on conflict (id) do nothing
      `;
      added += 1;
    }
    return { ok: true as const, added };
  });

/** Replace the book's list of cylinder types. Owners only; old entries keep whatever type they were saved with. */
export const saveCylinderTypes = createServerFn({ method: "POST" })
  .validator((types: string[]) => types)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const types = cleanTypeList(data);
    if (!types.length) return { ok: false as const, error: "Keep at least one cylinder type." };
    const sql = await sqlClient();
    await sql`update yards set cylinder_types = ${JSON.stringify(types)} where id = ${yard.id}`;
    const before = new Set(yard.cylinderTypes.map((t) => t.toLowerCase()));
    const after = new Set(types.map((t) => t.toLowerCase()));
    const added = types.filter((t) => !before.has(t.toLowerCase()));
    const removed = yard.cylinderTypes.filter((t) => !after.has(t.toLowerCase()));
    const detail = [added.length ? `added ${added.join(", ")}` : "", removed.length ? `removed ${removed.join(", ")}` : ""].filter(Boolean).join(" · ") || "reordered";
    await logActivity(yard.id, context.userId, "Changed cylinder types", detail);
    return { ok: true as const, types };
  });
