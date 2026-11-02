import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  canEdit,
  ensureYard,
  isOwner,
  isRealDate,
  logActivity,
  mapEntry,
  matchCompany,
  NEED_EDIT,
  NEED_OWNER,
  parseEntry,
  readPrices,
  sqlClient,
  type Entry,
  type EntryDraft,
  type EntryRow,
  type PaymentStatus,
} from "@/lib/inventory/api";
import { splitSerials } from "@/lib/inventory/serials";

// ---------------------------------------------------------------------------
// Numbering by Indian financial year (April to March)
// ---------------------------------------------------------------------------

/** "2026-10-22" → "2026-27"; "2027-02-01" → "2026-27". */
export function financialYear(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const start = month >= 4 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, "0")}`;
}

export function billPrefix(iso: string, letters = "CX") {
  return `${letters}/${financialYear(iso)}/`;
}

/** Next number after the highest one already used with this prefix. */
export function nextNumber(used: string[], prefix: string) {
  let next = 1;
  for (const value of used) {
    if (!value.startsWith(prefix)) continue;
    const n = Number(value.slice(prefix.length));
    if (Number.isInteger(n) && n >= next) next = n + 1;
  }
  return `${prefix}${String(next).padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Bills: many gas lines under one bill number
// ---------------------------------------------------------------------------

export type BillLineDraft = {
  cylinderType: string;
  serialNo: string;
  quantity: number;
  qtyOverride: boolean;
  unitPrice: number | null;
};

export type BillDraft = {
  /** Bill number being edited, or "" for a new bill. */
  originalBillNo: string;
  kind: "sale" | "purchase";
  billNo: string;
  date: string;
  company: string;
  lines: BillLineDraft[];
  total: number | null;
  payment: PaymentStatus;
  paid: number | null;
  note: string;
  /** The designed PDF, as a data URL, saved to the company's files. */
  pdf: string;
};

export type CancelledBill = {
  billNo: string;
  creditNoteNo: string;
  company: string;
  date: string;
  cancelledAt: string;
  reason: string;
  total: number;
  quantity: number;
  types: string[];
};

/** Split the final amount over the lines in proportion to each line's value, so none goes negative. */
function shareTotal(goods: Array<number | null>, total: number | null): Array<number | null> {
  if (total == null) return goods;
  const priced = goods.map((value) => value ?? 0);
  const sum = priced.reduce((a, b) => a + b, 0);
  if (sum <= 0) return goods.map((_, index) => (index === 0 ? total : null));
  let left = total;
  return priced.map((value, index) => {
    if (index === priced.length - 1) return Math.round(left * 100) / 100;
    const part = Math.round(((value / sum) * total) * 100) / 100;
    left -= part;
    return part;
  });
}

async function activeBill(yardId: string, billNo: string) {
  const sql = await sqlClient();
  return sql<EntryRow>`
    select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
      amount_due::float8 as amount_due, amount_paid::float8 as amount_paid, note, created_by, updated_at::text as updated_at,
      movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
    from entries
    where yard_id = ${yardId} and bill_no = ${billNo} and movement <> 'return' and deleted_at is null and cancelled_at is null
    order by updated_at, id
  `;
}

async function returnsAgainst(yardId: string, ids: string[]) {
  if (!ids.length) return 0;
  const sql = await sqlClient();
  const rows = await sql<{ n: number }>`
    select count(*)::int as n from entries
    where yard_id = ${yardId} and deleted_at is null and parent_id = any(string_to_array(${ids.join(",")}, ','))
  `;
  return Number(rows[0]?.n ?? 0);
}

export const saveBill = createServerFn({ method: "POST" })
  .validator((input: BillDraft) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const billNo = String(data.billNo ?? "").trim().slice(0, 40);
    if (!billNo) return { ok: false as const, error: "Enter the bill number." };
    if (!isRealDate(data.date)) return { ok: false as const, error: "Pick a valid date. It can't be more than a week ahead." };
    const lines = Array.isArray(data.lines) ? data.lines.slice(0, 26) : [];
    if (!lines.length) return { ok: false as const, error: "Add at least one gas line." };
    if (lines.length > 25) return { ok: false as const, error: "A bill can have up to 25 lines." };
    if (data.pdf && (!data.pdf.startsWith("data:application/pdf") || data.pdf.length > 400_000)) {
      return { ok: false as const, error: "The bill PDF is too large. Use a smaller logo." };
    }
    const movement = data.kind === "purchase" ? "purchase" : "delivery";
    const billCompany = await matchCompany(yard.id, data.company);

    const parsed: EntryDraft[] = [];
    for (const [index, line] of lines.entries()) {
      const result = parseEntry({
        companyName: billCompany,
        entryDate: data.date,
        serialNo: line.serialNo ?? "",
        quantity: Number(line.quantity) || 0,
        qtyOverride: Boolean(line.qtyOverride),
        paymentStatus: data.payment,
        amountDue: null,
        amountPaid: null,
        note: data.note ?? "",
        movement,
        unitPrice: line.unitPrice,
        billNo,
        parentId: null,
        cylinderType: line.cylinderType ?? "",
      });
      if (!result.ok) return { ok: false as const, error: lines.length > 1 ? `Line ${index + 1}: ${result.error}` : result.error };
      parsed.push(result.value);
    }
    const total = data.total == null ? null : Math.round(Number(data.total) * 100) / 100;
    let paid = data.paid == null ? null : Math.round(Number(data.paid) * 100) / 100;
    if ((total != null && (!Number.isFinite(total) || total < 0 || total > 1e9)) || (paid != null && (!Number.isFinite(paid) || paid < 0 || paid > 1e9))) {
      return { ok: false as const, error: "Amounts have to be zero or more." };
    }

    const sql = await sqlClient();
    const original = String(data.originalBillNo ?? "").trim();
    let oldIds: string[] = [];
    // When cylinders on the bill were already taken back, its lines stay as they are (the take-backs point at
    // them); only prices, amounts, payment, date, number and notes can change, and they're updated in place.
    let keepLines: EntryRow[] | null = null;
    if (original) {
      const old = await activeBill(yard.id, original);
      if (!old.length) return { ok: false as const, error: "That bill was changed or cancelled on another device. Reload and try again." };
      if ((await returnsAgainst(yard.id, old.map((row) => row.id))) > 0) {
        const sameSerials = (a: string, b: string) => splitSerials(a).map((x) => x.toLowerCase()).sort().join("\n") === splitSerials(b).map((x) => x.toLowerCase()).sort().join("\n");
        const sameLines =
          old.length === parsed.length &&
          old.every((row, index) => {
            const next = parsed[index]!;
            return (
              row.company_name.trim().toLowerCase() === next.companyName.trim().toLowerCase() &&
              String(row.cylinder_type ?? "").trim().toLowerCase() === next.cylinderType.trim().toLowerCase() &&
              Number(row.quantity) === next.quantity &&
              sameSerials(row.serial_no, next.serialNo)
            );
          });
        if (!sameLines) {
          return {
            ok: false as const,
            error: "Some cylinders on this bill were already taken back, so its customer, gases, serials and counts can't change. You can still change prices, the total, payment, date and notes. To change cylinders, undo those take-backs in the Book first.",
          };
        }
        keepLines = old;
      }
      oldIds = old.map((row) => row.id);
    }
    if (billNo !== original) {
      const clash = await sql<{ bill_no: string }>`
        select bill_no from entries where yard_id = ${yard.id} and bill_no = ${billNo} and deleted_at is null limit 1
      `;
      if (clash.length) {
        const used = await sql<{ bill_no: string }>`select distinct bill_no from entries where yard_id = ${yard.id} and bill_no like ${billPrefix(data.date) + "%"}`;
        const free = nextNumber(used.map((row) => row.bill_no), billPrefix(data.date));
        return { ok: false as const, error: `Bill number ${billNo} is already used. The next free number is ${free}.`, suggestion: free };
      }
    }

    const goods = parsed.map((value) => (value.unitPrice != null ? Math.round(value.unitPrice * value.quantity * 100) / 100 : null));
    const shares = shareTotal(goods, total);
    const billAmount = Math.round(shares.reduce<number>((sum, value) => sum + (value ?? 0), 0) * 100) / 100;
    // A bill marked Received with no amount typed was paid in full; Not received means nothing was paid.
    if (data.payment === "received" && paid == null && billAmount > 0) paid = billAmount;
    if (data.payment === "unpaid") paid = null;
    if (paid != null && billAmount > 0 && paid > billAmount + 0.004) {
      return { ok: false as const, error: "Received can't be more than the bill amount. Save extra money with Money received, so it shows as an advance." };
    }
    // Ids sort in line order, so the bill reads back the way it was typed.
    const stamp = Date.now().toString(36);
    const rows = parsed.map((value, index) => ({
      id: `b${stamp}-${String(index).padStart(2, "0")}-${crypto.randomUUID()}`,
      company_name: value.companyName,
      entry_date: value.entryDate,
      serial_no: value.serialNo,
      quantity: value.quantity,
      payment_status: value.paymentStatus,
      amount_due: shares[index] ?? null,
      amount_paid: index === 0 ? paid : null,
      note: value.note,
      movement: value.movement,
      unit_price: value.unitPrice,
      bill_no: billNo,
      cylinder_type: value.cylinderType,
    }));
    if (keepLines) {
      for (const [index, row] of rows.entries()) {
        await sql`
          update entries set entry_date = ${row.entry_date}, payment_status = ${row.payment_status}, amount_due = ${row.amount_due},
            amount_paid = ${row.amount_paid}, note = ${row.note}, unit_price = ${row.unit_price}, bill_no = ${row.bill_no}, updated_at = now()
          where id = ${keepLines[index]!.id} and yard_id = ${yard.id}
        `;
      }
    }
    const json = JSON.stringify(keepLines ? [] : rows);
    const inserted = keepLines ? await activeBill(yard.id, billNo) : await sql<EntryRow>`
      with gone as (
        delete from entries where yard_id = ${yard.id} and id = any(string_to_array(${oldIds.join(",")}, ','))
        returning id
      )
      insert into entries (
        id, yard_id, created_by, company_name, entry_date, serial_no, quantity, payment_status,
        amount_due, amount_paid, note, movement, unit_price, bill_no, parent_id, cylinder_type
      )
      select x.id, ${yard.id}, ${context.userId}, x.company_name, x.entry_date::date, x.serial_no, x.quantity, x.payment_status,
        x.amount_due, x.amount_paid, x.note, x.movement, x.unit_price, x.bill_no, null, x.cylinder_type
      from json_to_recordset(${json}::json) as x(
        id text, company_name text, entry_date text, serial_no text, quantity int, payment_status text,
        amount_due numeric, amount_paid numeric, note text, movement text, unit_price numeric, bill_no text, cylinder_type text
      )
      returning id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
        amount_due::float8 as amount_due, amount_paid::float8 as amount_paid, note, created_by, updated_at::text as updated_at,
        movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
    `;
    if (inserted.length !== rows.length) return { ok: false as const, error: "Couldn't save the bill. Reload and try again." };

    if (original.startsWith("DC/") && billNo !== original) {
      // A delivery challan turned into a bill: remember which bill it became.
      await sql`update challans set billed_bill_no = ${billNo} where yard_id = ${yard.id} and challan_no = ${original}`;
    }
    if (original && !original.startsWith("DC/")) {
      // The old PDF goes to Recently deleted; the new one replaces it.
      await sql`
        update documents set deleted_at = now(), deleted_by = ${context.userId}
        where yard_id = ${yard.id} and kind = 'bill' and deleted_at is null and (title = ${original} or title like ${original.replace(/[\\/:*?"<>|]+/g, "-") + " %"} or title like ${original + " %"})
      `;
    }
    if (data.pdf) {
      const title = `${billNo} ${parsed[0]!.companyName}.pdf`.replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
      await sql`
        insert into documents (id, yard_id, company_name, title, kind, mime, content, created_by)
        values (${crypto.randomUUID()}, ${yard.id}, ${parsed[0]!.companyName}, ${title}, 'bill', 'application/pdf', ${data.pdf}, ${context.userId})
      `;
    }
    const qty = parsed.reduce((sum, value) => sum + value.quantity, 0);
    const amount = total ?? goods.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const summary = `${billNo} · ${parsed[0]!.companyName} · ${qty} cylinders (${parsed.map((value) => value.cylinderType || "cylinders").join(", ")}) · ₹${amount.toLocaleString("en-IN")}`;
    await logActivity(yard.id, context.userId, original ? "Edited bill" : "Made bill", original && original !== billNo ? `${original} → ${summary}` : summary);
    return { ok: true as const, entries: inserted.map(mapEntry) };
  });

export const cancelBill = createServerFn({ method: "POST" })
  .validator((input: { billNo: string; reason: string; date: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!isOwner(yard)) return { ok: false as const, error: NEED_OWNER };
    const billNo = String(data.billNo ?? "").trim();
    const reason = String(data.reason ?? "").trim().slice(0, 300);
    const date = isRealDate(data.date) ? data.date : new Date().toISOString().slice(0, 10);
    const rows = await activeBill(yard.id, billNo);
    if (!rows.length) return { ok: false as const, error: "That bill is not in the book any more." };
    if ((await returnsAgainst(yard.id, rows.map((row) => row.id))) > 0) {
      return { ok: false as const, error: "Some cylinders on this bill were already taken back, so it can't be cancelled. Undo those take-backs in the Book first. To fix only the price or amount, use Edit on the bill instead." };
    }
    const sql = await sqlClient();
    const used = await sql<{ credit_note_no: string }>`
      select distinct credit_note_no from entries where yard_id = ${yard.id} and credit_note_no like ${billPrefix(date, "CN") + "%"}
    `;
    const creditNoteNo = nextNumber(used.map((row) => row.credit_note_no), billPrefix(date, "CN"));
    await sql`
      update entries set cancelled_at = now(), cancelled_by = ${context.userId}, cancel_reason = ${reason}, credit_note_no = ${creditNoteNo}, updated_at = now()
      where yard_id = ${yard.id} and id = any(string_to_array(${rows.map((row) => row.id).join(",")}, ','))
    `;
    const total = rows.reduce((sum, row) => sum + Number(row.amount_due ?? 0), 0);
    await logActivity(yard.id, context.userId, "Cancelled bill", `${billNo} · ${rows[0]!.company_name} · ₹${total.toLocaleString("en-IN")} · credit note ${creditNoteNo}${reason ? ` · ${reason}` : ""}`);
    return { ok: true as const, creditNoteNo, date, entries: rows.map(mapEntry) };
  });

export const listCancelledBills = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{ bill_no: string; credit_note_no: string; company_name: string; entry_date: string; cancelled_at: string; cancel_reason: string; total: number | null; quantity: number; types: string | null }>`
      select bill_no, credit_note_no, min(company_name) as company_name, min(entry_date)::text as entry_date,
             max(cancelled_at)::text as cancelled_at, max(cancel_reason) as cancel_reason,
             sum(amount_due)::float8 as total, sum(quantity)::int as quantity, string_agg(distinct cylinder_type, '|') as types
      from entries
      where yard_id = ${yard.id} and cancelled_at is not null and deleted_at is null
      group by bill_no, credit_note_no
      order by max(cancelled_at) desc
      limit 300
    `;
    return rows.map(
      (row): CancelledBill => ({
        billNo: row.bill_no,
        creditNoteNo: row.credit_note_no,
        company: row.company_name,
        date: String(row.entry_date).slice(0, 10),
        cancelledAt: row.cancelled_at,
        reason: row.cancel_reason,
        total: Number(row.total ?? 0),
        quantity: Number(row.quantity ?? 0),
        types: (row.types ?? "").split("|").filter(Boolean),
      }),
    );
  });

/** Entries of one cancelled bill, to rebuild its credit note PDF. */
export const getCancelledBill = createServerFn({ method: "GET" })
  .validator((billNo: string) => billNo)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<EntryRow>`
      select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
        amount_due::float8 as amount_due, amount_paid::float8 as amount_paid, note, created_by, updated_at::text as updated_at,
        movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
      from entries where yard_id = ${yard.id} and bill_no = ${data} and cancelled_at is not null and deleted_at is null
      order by updated_at, id
    `;
    return rows.map(mapEntry) as Entry[];
  });

// ---------------------------------------------------------------------------
// Rate card per company
// ---------------------------------------------------------------------------

export const saveCompanyPrices = createServerFn({ method: "POST" })
  .validator((input: { companyName: string; prices: Record<string, number> }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const companyName = String(data.companyName ?? "").trim().slice(0, 120);
    if (!companyName) return { ok: false as const, error: "Pick a company." };
    const prices = readPrices(JSON.stringify(data.prices ?? {}));
    if (Object.keys(prices).length > 120) return { ok: false as const, error: "Too many rates for one company." };
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const json = JSON.stringify(prices);
    await sql`
      insert into company_meta (yard_id, company_name, prices)
      values (${yard.id}, ${companyName}, ${json})
      on conflict (yard_id, company_name) do update set prices = ${json}, updated_at = now()
    `;
    await logActivity(yard.id, context.userId, "Updated rates", `${companyName} · ${Object.keys(prices).length} gas type${Object.keys(prices).length === 1 ? "" : "s"}`);
    return { ok: true as const, prices };
  });

