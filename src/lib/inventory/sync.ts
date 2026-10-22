import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { ensureYard, mapEntry, sqlClient, type Entry, type EntryRow } from "@/lib/inventory/api";

export type EntryChanges = {
  /** Lines added or changed since the cursor. */
  changed: Entry[];
  /** Lines deleted or cancelled since the cursor. */
  gone: string[];
  /** How many live lines the book has now; a mismatch tells the phone to reload everything. */
  total: number;
  /** Server time to send back next time. */
  cursor: string;
};

/** Only what changed in the book since the last check, so phones don't download the whole book every few seconds. */
export const entriesSince = createServerFn({ method: "GET" })
  .validator((input: { since: string }) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }): Promise<EntryChanges> => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const [clock] = await sql<{ now: string }>`select now()::text as now`;
    const since = String(data?.since ?? "");
    const valid = /^\d{4}-\d{2}-\d{2}/.test(since);
    const from = valid ? since : "1970-01-01";
    const changed = await sql<EntryRow>`
      select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
             amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
             note, created_by, updated_at::text as updated_at,
             movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
      from entries
      where yard_id = ${yard.id} and deleted_at is null and cancelled_at is null and updated_at > (${from}::timestamptz - interval '5 seconds')
      order by updated_at
      limit 2000
    `;
    const gone = await sql<{ id: string }>`
      select id from entries
      where yard_id = ${yard.id} and ((deleted_at is not null and deleted_at > (${from}::timestamptz - interval '5 seconds')) or (cancelled_at is not null and cancelled_at > (${from}::timestamptz - interval '5 seconds')))
      limit 5000
    `;
    const [count] = await sql<{ n: number }>`
      select count(*)::int as n from entries where yard_id = ${yard.id} and deleted_at is null and cancelled_at is null
    `;
    return { changed: changed.map(mapEntry), gone: gone.map((row) => row.id), total: Number(count?.n ?? 0), cursor: clock!.now };
  });
