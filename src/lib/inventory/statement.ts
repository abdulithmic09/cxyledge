import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { canEdit, ensureYard, logActivity, mapEntry, mapPayment, NEED_EDIT, sqlClient, type EntryRow, type PaymentRow } from "@/lib/inventory/api";
import { companyBalances, companyLedger, type LedgerRow } from "@/lib/inventory/analyse";
import { dueRows, type DueBill } from "@/lib/inventory/dues";

/** What a company sees when it opens its statement link. Nothing about other customers. */
export type PublicStatement = {
  yard: { name: string; address: string; phone: string; logo: string };
  company: string;
  asOf: string;
  toCollect: number;
  advance: number;
  overdue: number;
  creditDays: number;
  cylindersOut: number;
  byType: Array<{ type: string; out: number }>;
  serials: string[];
  depositHeld: number;
  bills: DueBill[];
  ledger: LedgerRow[];
};

function newToken(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(22));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const cleanName = (value: unknown) => String(value ?? "").trim().slice(0, 120);

/** The company's live statement link, if one is on. */
export const getStatementLink = createServerFn({ method: "GET" })
  .validator((companyName: string) => companyName)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    const sql = await sqlClient();
    const rows = await sql<{ token: string; created_at: string; last_viewed_at: string | null; views: number }>`
      select token, created_at::text as created_at, last_viewed_at::text as last_viewed_at, views
      from statement_links
      where yard_id = ${yard.id} and company_name = ${cleanName(data)} and revoked_at is null
      order by created_at desc limit 1
    `;
    const row = rows[0];
    return row ? { token: row.token, createdAt: row.created_at, lastViewedAt: row.last_viewed_at, views: Number(row.views) } : null;
  });

/** Turn the statement link on (or give back the one already on). */
export const createStatementLink = createServerFn({ method: "POST" })
  .validator((companyName: string) => companyName)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const companyName = cleanName(data);
    if (!companyName) return { ok: false as const, error: "Pick a company." };
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const live = await sql<{ token: string }>`
      select token from statement_links where yard_id = ${yard.id} and company_name = ${companyName} and revoked_at is null limit 1
    `;
    if (live[0]) return { ok: true as const, token: live[0].token };
    const token = newToken();
    await sql`insert into statement_links (token, yard_id, company_name, created_by) values (${token}, ${yard.id}, ${companyName}, ${context.userId})`;
    await logActivity(yard.id, context.userId, "Turned on statement link", companyName);
    return { ok: true as const, token };
  });

/** Turn the link off. The old link stops working; a new one can be made later. */
export const revokeStatementLink = createServerFn({ method: "POST" })
  .validator((companyName: string) => companyName)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const companyName = cleanName(data);
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    await sql`update statement_links set revoked_at = now() where yard_id = ${yard.id} and company_name = ${companyName} and revoked_at is null`;
    await logActivity(yard.id, context.userId, "Turned off statement link", companyName);
    return { ok: true as const };
  });

/** Public: read one company's statement by its link. No sign-in. */
export const readStatement = createServerFn({ method: "GET" })
  .validator((token: string) => token)
  .handler(async ({ data }): Promise<{ ok: true; statement: PublicStatement } | { ok: false }> => {
    const token = String(data ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 64);
    if (token.length < 16) return { ok: false };
    const sql = await sqlClient();
    const links = await sql<{ yard_id: string; company_name: string }>`
      select yard_id, company_name from statement_links where token = ${token} and revoked_at is null
    `;
    const link = links[0];
    if (!link) return { ok: false };
    const yardRows = await sql<{ name: string; address: string; phone: string; logo: string; credit_days: number }>`
      select name, address, phone, logo, credit_days from yards where id = ${link.yard_id}
    `;
    const yard = yardRows[0];
    if (!yard) return { ok: false };
    const company = link.company_name;
    const entryRows = await sql<EntryRow>`
      select id, company_name, entry_date::text as entry_date, serial_no, quantity, payment_status,
             amount_due::float8 as amount_due, amount_paid::float8 as amount_paid,
             note, created_by, updated_at::text as updated_at,
             movement, unit_price::float8 as unit_price, bill_no, parent_id, cylinder_type
      from entries
      where yard_id = ${link.yard_id} and company_name = ${company} and deleted_at is null and cancelled_at is null
      order by entry_date desc, updated_at desc
      limit 5000
    `;
    const paymentRows = await sql<PaymentRow>`
      select id, company_name, direction, amount::float8 as amount, paid_on::text as paid_on, mode, reference, bill_no, note, receipt_no, created_by, created_at::text as created_at
      from payments
      where yard_id = ${link.yard_id} and company_name = ${company} and deleted_at is null
      limit 3000
    `;
    const meta = await sql<{ credit_days: number | null }>`select credit_days from company_meta where yard_id = ${link.yard_id} and company_name = ${company}`;
    const deposits = await sql<{ held: number }>`
      select coalesce(sum(case when direction = 'taken' then amount else -amount end), 0)::float8 as held
      from deposits where yard_id = ${link.yard_id} and company_name = ${company} and deleted_at is null
    `;
    // Notes are internal; the customer never sees them.
    const entries = entryRows.map(mapEntry).map((entry) => ({ ...entry, note: "", createdBy: "" }));
    const payments = paymentRows.map(mapPayment).map((payment) => ({ ...payment, note: "", createdBy: "" }));
    const creditDays = Number(meta[0]?.credit_days ?? yard.credit_days ?? 30);
    const balance = companyBalances(entries, payments).find((row) => row.company === company);
    const due = dueRows(entries, payments, () => creditDays)[0];
    const ledger = companyLedger(entries, payments, company);
    await sql`update statement_links set last_viewed_at = now(), views = views + 1 where token = ${token}`;
    return {
      ok: true,
      statement: {
        yard: { name: yard.name, address: yard.address ?? "", phone: yard.phone ?? "", logo: yard.logo ?? "" },
        company,
        asOf: new Date().toISOString(),
        toCollect: balance?.toCollect ?? 0,
        advance: balance?.advance ?? 0,
        overdue: due?.overdue ?? 0,
        creditDays,
        cylindersOut: balance?.outstandingQty ?? 0,
        byType: balance?.byType ?? [],
        serials: balance?.outstandingSerials ?? [],
        depositHeld: Math.max(0, Math.round(Number(deposits[0]?.held ?? 0))),
        bills: due?.bills ?? [],
        ledger: ledger.slice(-300),
      },
    };
  });
