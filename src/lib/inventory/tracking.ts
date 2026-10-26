import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { canEdit, ensureYard, isOwner, isRealDate, logActivity, NEED_EDIT, NEED_OWNER, sqlClient } from "@/lib/inventory/api";
import { splitSerials } from "@/lib/inventory/serials";
import { financialYear, nextNumber } from "@/lib/inventory/billing";

export type StockMoveKind = "to_plant" | "from_plant" | "count";

export type StockMove = {
  id: string;
  kind: StockMoveKind;
  plant: string;
  gasType: string;
  quantity: number;
  serials: string[];
  fullCount: number | null;
  emptyCount: number | null;
  challanNo: string;
  note: string;
  date: string;
  createdAt: string;
};

export type Deposit = {
  id: string;
  companyName: string;
  direction: "taken" | "refunded";
  amount: number;
  cylinders: number;
  gasType: string;
  serials: string[];
  date: string;
  mode: string;
  reference: string;
  note: string;
  receiptNo: string;
  createdAt: string;
};

export type HoldTerms = { freeDays: number; rate: number };

export type Challan = {
  id: string;
  challanNo: string;
  companyName: string;
  date: string;
  vehicle: string;
  driver: string;
  receiver: string;
  signature: string;
  signedAt: string | null;
  billedBillNo: string;
};

export type Tracking = {
  terms: HoldTerms;
  companyTerms: Record<string, Partial<HoldTerms>>;
  moves: StockMove[];
  deposits: Deposit[];
  /** Days a customer has to pay a bill: book default and per-company overrides. */
  creditDays: number;
  companyCredit: Record<string, number>;
  challans: Challan[];
};

function cleanInt(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const i = Math.round(n);
  return i < min || i > max ? null : i;
}

function cleanMoneyValue(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
  return Math.round(n * 100) / 100;
}

export const getTracking = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<Tracking> => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const [terms] = await sql<{ hold_free_days: number; hold_rate: number; credit_days: number }>`
      select hold_free_days, hold_rate::float8 as hold_rate, credit_days from yards where id = ${yard.id}
    `;
    const companyRows = await sql<{ company_name: string; hold_free_days: number | null; hold_rate: number | null; credit_days: number | null }>`
      select company_name, hold_free_days, hold_rate::float8 as hold_rate, credit_days from company_meta
      where yard_id = ${yard.id} and (hold_free_days is not null or hold_rate is not null or credit_days is not null)
    `;
    const challans = await sql<{ id: string; challan_no: string; company_name: string; challan_date: string; vehicle: string; driver: string; receiver: string; signature: string; signed_at: string | null; billed_bill_no: string }>`
      select id, challan_no, company_name, challan_date::text as challan_date, vehicle, driver, receiver, signature, signed_at::text as signed_at, billed_bill_no
      from challans where yard_id = ${yard.id} and deleted_at is null order by challan_date desc, created_at desc limit 1000
    `;
    const moves = await sql<{ id: string; kind: string; plant: string; gas_type: string; quantity: number; serial_no: string; full_count: number | null; empty_count: number | null; challan_no: string; note: string; moved_on: string; created_at: string }>`
      select id, kind, plant, gas_type, quantity, serial_no, full_count, empty_count, challan_no, note, moved_on::text as moved_on, created_at::text as created_at
      from stock_moves where yard_id = ${yard.id} and deleted_at is null
      order by moved_on desc, created_at desc limit 3000
    `;
    const deposits = await sql<{ id: string; company_name: string; direction: string; amount: number; cylinders: number; gas_type: string; serial_no: string; on_date: string; mode: string; reference: string; note: string; receipt_no: string; created_at: string }>`
      select id, company_name, direction, amount::float8 as amount, cylinders, gas_type, serial_no, on_date::text as on_date, mode, reference, note, receipt_no, created_at::text as created_at
      from deposits where yard_id = ${yard.id} and deleted_at is null
      order by on_date desc, created_at desc limit 3000
    `;
    const companyTerms: Record<string, Partial<HoldTerms>> = {};
    const companyCredit: Record<string, number> = {};
    for (const row of companyRows) {
      if (row.credit_days != null) companyCredit[row.company_name] = Number(row.credit_days);
      if (row.hold_free_days == null && row.hold_rate == null) continue;
      companyTerms[row.company_name] = {
        ...(row.hold_free_days != null ? { freeDays: Number(row.hold_free_days) } : {}),
        ...(row.hold_rate != null ? { rate: Number(row.hold_rate) } : {}),
      };
    }
    return {
      terms: { freeDays: Number(terms?.hold_free_days ?? 30), rate: Number(terms?.hold_rate ?? 0) },
      companyTerms,
      creditDays: Number(terms?.credit_days ?? 30),
      companyCredit,
      challans: challans.map((row) => ({
        id: row.id,
        challanNo: row.challan_no,
        companyName: row.company_name,
        date: String(row.challan_date).slice(0, 10),
        vehicle: row.vehicle,
        driver: row.driver,
        receiver: row.receiver,
        signature: row.signature,
        signedAt: row.signed_at,
        billedBillNo: row.billed_bill_no,
      })),
      moves: moves.map((row) => ({
        id: row.id,
        kind: (["to_plant", "from_plant", "count"].includes(row.kind) ? row.kind : "count") as StockMoveKind,
        plant: row.plant,
        gasType: row.gas_type,
        quantity: Number(row.quantity),
        serials: splitSerials(row.serial_no),
        fullCount: row.full_count == null ? null : Number(row.full_count),
        emptyCount: row.empty_count == null ? null : Number(row.empty_count),
        challanNo: row.challan_no,
        note: row.note,
        date: String(row.moved_on).slice(0, 10),
        createdAt: row.created_at,
      })),
      deposits: deposits.map((row) => ({
        id: row.id,
        companyName: row.company_name,
        direction: row.direction === "refunded" ? "refunded" : "taken",
        amount: Number(row.amount),
        cylinders: Number(row.cylinders),
        gasType: row.gas_type,
        serials: splitSerials(row.serial_no),
        date: String(row.on_date).slice(0, 10),
        mode: row.mode,
        reference: row.reference,
        note: row.note,
        receiptNo: row.receipt_no,
        createdAt: row.created_at,
      })),
    };
  });

export const saveStockMove = createServerFn({ method: "POST" })
  .validator((input: { kind: StockMoveKind; plant: string; gasType: string; serialNo: string; quantity: number; fullCount: number | null; emptyCount: number | null; challanNo: string; note: string; date: string; refillRate?: number | null; paidNow?: number | null; billNo?: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    if (!["to_plant", "from_plant", "count"].includes(data.kind)) return { ok: false as const, error: "Pick what happened." };
    if (!isRealDate(data.date)) return { ok: false as const, error: "Pick a valid date." };
    const gasType = String(data.gasType ?? "").trim().slice(0, 60);
    if (!gasType) return { ok: false as const, error: "Pick the gas type." };
    const serials = splitSerials(String(data.serialNo ?? ""));
    if (serials.join("\n").length > 4000) return { ok: false as const, error: "Too many serial numbers in one go." };
    const plant = String(data.plant ?? "").trim().slice(0, 120);
    let quantity = 0;
    let fullCount: number | null = null;
    let emptyCount: number | null = null;
    if (data.kind === "count") {
      fullCount = cleanInt(data.fullCount, 0, 100000);
      emptyCount = cleanInt(data.emptyCount, 0, 100000);
      if (fullCount == null && emptyCount == null) return { ok: false as const, error: "Enter the full or empty count." };
    } else {
      if (!plant) return { ok: false as const, error: "Enter the plant's name." };
      quantity = serials.length || (cleanInt(data.quantity, 1, 100000) ?? 0);
      if (!quantity) return { ok: false as const, error: "Add serial numbers or the number of cylinders." };
    }
    const sql = await sqlClient();
    const id = crypto.randomUUID();
    await sql`
      insert into stock_moves (id, yard_id, kind, plant, gas_type, quantity, serial_no, full_count, empty_count, challan_no, note, moved_on, created_by)
      values (${id}, ${yard.id}, ${data.kind}, ${plant}, ${gasType}, ${quantity}, ${serials.join("\n")}, ${fullCount}, ${emptyCount},
              ${String(data.challanNo ?? "").trim().slice(0, 40)}, ${String(data.note ?? "").trim().slice(0, 300)}, ${data.date}, ${context.userId})
    `;
    // Refill charges for fulls back from the plant: a purchase line on the plant's account, so you can
    // see and pay what you owe. Linked to this trip (parent "plant:<id>"), so it doesn't add stock twice.
    const rate = data.kind === "from_plant" ? cleanMoneyValue(data.refillRate ?? null) : null;
    if (rate && rate > 0) {
      const due = Math.round(rate * quantity * 100) / 100;
      const paid = Math.min(due, Math.max(0, cleanMoneyValue(data.paidNow ?? null) ?? 0));
      const status = paid >= due ? "received" : paid > 0 ? "partial" : "unpaid";
      const billNo = String(data.billNo ?? "").trim().slice(0, 40) || String(data.challanNo ?? "").trim().slice(0, 40);
      await sql`
        insert into entries (id, yard_id, created_by, company_name, entry_date, serial_no, quantity, payment_status, amount_due, amount_paid, note, movement, unit_price, bill_no, parent_id, cylinder_type)
        values (${crypto.randomUUID()}, ${yard.id}, ${context.userId}, ${plant}, ${data.date}, '', ${quantity}, ${status}, ${due}, ${paid || null}, 'Refill charges', 'purchase', ${rate}, ${billNo}, ${`plant:${id}`}, ${gasType})
      `;
    }
    const what =
      data.kind === "count"
        ? `Stock count ${gasType}: ${fullCount ?? "-"} full, ${emptyCount ?? "-"} empty`
        : `${data.kind === "to_plant" ? "Sent to" : "Back from"} ${plant}: ${quantity} × ${gasType}`;
    await logActivity(yard.id, context.userId, data.kind === "count" ? "Counted stock" : data.kind === "to_plant" ? "Sent to plant" : "Back from plant", what);
    return { ok: true as const, id };
  });

export const deleteStockMove = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    const rows = await sql<{ kind: string; gas_type: string; quantity: number }>`
      update stock_moves set deleted_at = now(), deleted_by = ${context.userId}
      where id = ${id} and yard_id = ${yard.id} and deleted_at is null returning kind, gas_type, quantity
    `;
    if (!rows.length) return { ok: false as const, error: "Already removed." };
    await sql`update entries set deleted_at = now(), deleted_by = ${context.userId}, updated_at = now() where yard_id = ${yard.id} and parent_id = ${`plant:${id}`} and deleted_at is null`;
    await logActivity(yard.id, context.userId, "Removed stock record", `${rows[0]!.kind} · ${rows[0]!.quantity} × ${rows[0]!.gas_type}`);
    return { ok: true as const };
  });

/** Book-wide holding terms (company omitted), or one company's own terms (null clears them). */
export const saveHoldTerms = createServerFn({ method: "POST" })
  .validator((input: { companyName?: string; freeDays: number | null; rate: number | null }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    const freeDays = data.freeDays == null ? null : cleanInt(data.freeDays, 0, 3650);
    const rate = data.rate == null ? null : cleanMoneyValue(data.rate);
    const company = String(data.companyName ?? "").trim().slice(0, 120);
    if (!company) {
      if (freeDays == null || rate == null) return { ok: false as const, error: "Enter free days and a daily rate (₹0 turns charges off)." };
      await sql`update yards set hold_free_days = ${freeDays}, hold_rate = ${rate} where id = ${yard.id}`;
      await logActivity(yard.id, context.userId, "Changed holding charges", `${freeDays} free days · ₹${rate} per cylinder per day`);
    } else {
      await sql`
        insert into company_meta (yard_id, company_name, hold_free_days, hold_rate)
        values (${yard.id}, ${company}, ${freeDays}, ${rate})
        on conflict (yard_id, company_name) do update set hold_free_days = ${freeDays}, hold_rate = ${rate}, updated_at = now()
      `;
      await logActivity(yard.id, context.userId, "Changed holding charges", `${company} · ${freeDays ?? "book"} free days · ${rate == null ? "book rate" : `₹${rate}`}`);
    }
    return { ok: true as const };
  });

/** Bill holding charges to a company up to a date. Stored as a payment-like record with direction 'charge'. */
export const createHoldingCharge = createServerFn({ method: "POST" })
  .validator((input: { companyName: string; amount: number; upTo: string; detail: string; pdf?: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const company = String(data.companyName ?? "").trim().slice(0, 120);
    const amount = cleanMoneyValue(data.amount);
    if (!company || !amount) return { ok: false as const, error: "Nothing to charge yet." };
    if (!isRealDate(data.upTo)) return { ok: false as const, error: "Pick a valid date." };
    const sql = await sqlClient();
    const prefix = `HC/${financialYear(data.upTo)}/`;
    const used = await sql<{ receipt_no: string }>`select receipt_no from payments where yard_id = ${yard.id} and direction = 'charge' and receipt_no like ${prefix + "%"}`;
    const number = nextNumber(used.map((row) => row.receipt_no), prefix);
    const id = crypto.randomUUID();
    await sql`
      insert into payments (id, yard_id, company_name, direction, amount, paid_on, mode, reference, bill_no, note, receipt_no, created_by)
      values (${id}, ${yard.id}, ${company}, 'charge', ${amount}, ${data.upTo}, 'other', 'holding', ${number}, ${String(data.detail ?? "").slice(0, 300)}, ${number}, ${context.userId})
    `;
    if (data.pdf && data.pdf.startsWith("data:application/pdf") && data.pdf.length < 400_000) {
      await sql`
        insert into documents (id, yard_id, company_name, title, kind, mime, content, created_by)
        values (${crypto.randomUUID()}, ${yard.id}, ${company}, ${`${number.replace(/\//g, "-")} ${company}.pdf`.slice(0, 120)}, 'bill', 'application/pdf', ${data.pdf}, ${context.userId})
      `;
    }
    await logActivity(yard.id, context.userId, "Billed holding charges", `${number} · ${company} · ₹${amount.toLocaleString("en-IN")} up to ${data.upTo.split("-").reverse().join("/")}`);
    return { ok: true as const, id, number };
  });

export const saveDeposit = createServerFn({ method: "POST" })
  .validator((input: { companyName: string; direction: "taken" | "refunded"; amount: number; cylinders: number; gasType: string; serialNo: string; date: string; mode: string; reference: string; note: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const company = String(data.companyName ?? "").trim().slice(0, 120);
    if (!company) return { ok: false as const, error: "Pick the company." };
    const amount = cleanMoneyValue(data.amount);
    if (!amount) return { ok: false as const, error: "Enter the deposit amount." };
    if (!isRealDate(data.date)) return { ok: false as const, error: "Pick a valid date." };
    const direction = data.direction === "refunded" ? "refunded" : "taken";
    const serials = splitSerials(String(data.serialNo ?? ""));
    const cylinders = serials.length || cleanInt(data.cylinders, 0, 100000) || 0;
    const sql = await sqlClient();
    const prefix = `${direction === "taken" ? "DR" : "DF"}/${financialYear(data.date)}/`;
    const used = await sql<{ receipt_no: string }>`select receipt_no from deposits where yard_id = ${yard.id} and receipt_no like ${prefix + "%"}`;
    const receiptNo = nextNumber(used.map((row) => row.receipt_no), prefix);
    const id = crypto.randomUUID();
    await sql`
      insert into deposits (id, yard_id, company_name, direction, amount, cylinders, gas_type, serial_no, on_date, mode, reference, note, receipt_no, created_by)
      values (${id}, ${yard.id}, ${company}, ${direction}, ${amount}, ${cylinders}, ${String(data.gasType ?? "").trim().slice(0, 60)}, ${serials.join("\n")},
              ${data.date}, ${String(data.mode ?? "cash").slice(0, 20)}, ${String(data.reference ?? "").trim().slice(0, 60)}, ${String(data.note ?? "").trim().slice(0, 300)}, ${receiptNo}, ${context.userId})
    `;
    await logActivity(yard.id, context.userId, direction === "taken" ? "Took deposit" : "Refunded deposit", `${receiptNo} · ${company} · ₹${amount.toLocaleString("en-IN")}${cylinders ? ` · ${cylinders} cylinders` : ""}`);
    return { ok: true as const, id, receiptNo };
  });

export const deleteDeposit = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .middleware([authMiddleware])
  .handler(async ({ context, data: id }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const sql = await sqlClient();
    const rows = await sql<{ receipt_no: string; company_name: string }>`
      update deposits set deleted_at = now(), deleted_by = ${context.userId}
      where id = ${id} and yard_id = ${yard.id} and deleted_at is null returning receipt_no, company_name
    `;
    if (!rows.length) return { ok: false as const, error: "Already removed." };
    await logActivity(yard.id, context.userId, "Removed deposit record", `${rows[0]!.receipt_no} · ${rows[0]!.company_name}`);
    return { ok: true as const };
  });

/** Credit days for the whole book (company omitted) or one company (null days clears it). */
export const saveCreditDays = createServerFn({ method: "POST" })
  .validator((input: { companyName?: string; days: number | null }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const days = data.days == null ? null : cleanInt(data.days, 0, 365);
    const company = String(data.companyName ?? "").trim().slice(0, 120);
    const sql = await sqlClient();
    if (!company) {
      if (days == null) return { ok: false as const, error: "Enter the number of days (0 to 365)." };
      await sql`update yards set credit_days = ${days} where id = ${yard.id}`;
    } else {
      await sql`
        insert into company_meta (yard_id, company_name, credit_days) values (${yard.id}, ${company}, ${days})
        on conflict (yard_id, company_name) do update set credit_days = ${days}, updated_at = now()
      `;
    }
    await logActivity(yard.id, context.userId, "Changed credit days", `${company || "Book"} · ${days == null ? "book default" : `${days} days`}`);
    return { ok: true as const };
  });

/** The challan's slip details and signature. The cylinders themselves are booked as entries under the challan number. */
export const saveChallan = createServerFn({ method: "POST" })
  .validator((input: { challanNo: string; companyName: string; date: string; vehicle: string; driver: string; receiver: string; signature: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const challanNo = String(data.challanNo ?? "").trim().slice(0, 40);
    const company = String(data.companyName ?? "").trim().slice(0, 120);
    if (!challanNo || !company) return { ok: false as const, error: "Missing challan number or company." };
    if (!isRealDate(data.date)) return { ok: false as const, error: "Pick a valid date." };
    const signature = String(data.signature ?? "");
    if (signature && (!signature.startsWith("data:image/") || signature.length > 120_000)) return { ok: false as const, error: "The signature is too large. Clear it and sign again." };
    const sql = await sqlClient();
    await sql`
      insert into challans (id, yard_id, challan_no, company_name, challan_date, vehicle, driver, receiver, signature, signed_at, created_by)
      values (${crypto.randomUUID()}, ${yard.id}, ${challanNo}, ${company}, ${data.date}, ${String(data.vehicle ?? "").trim().slice(0, 30)},
              ${String(data.driver ?? "").trim().slice(0, 60)}, ${String(data.receiver ?? "").trim().slice(0, 60)}, ${signature}, ${signature ? new Date().toISOString() : null}, ${context.userId})
      on conflict (yard_id, challan_no) do update set company_name = excluded.company_name, challan_date = excluded.challan_date, vehicle = excluded.vehicle,
        driver = excluded.driver, receiver = excluded.receiver, signature = excluded.signature, signed_at = excluded.signed_at, deleted_at = null
    `;
    await logActivity(yard.id, context.userId, "Made delivery challan", `${challanNo} · ${company}${signature ? " · signed" : ""}`);
    return { ok: true as const };
  });
