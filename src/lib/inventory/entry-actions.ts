import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { canEdit, ensureYard, logActivity, NEED_EDIT, sqlClient } from "@/lib/inventory/api";

/** What an Undo right after saving takes back: a new line, a payment, or the latest take-back on a delivery. */
export type UndoTarget =
  | { kind: "entry"; id: string }
  | { kind: "return"; parentId: string }
  | { kind: "payment"; id: string }
  | { kind: "stockMove"; id: string }
  | { kind: "deposit"; id: string }
  | { kind: "bill"; billNo: string }
  | { kind: "restore"; table: "entry" | "payment" | "deposit" | "stockMove"; id: string };

const UNDO_MINUTES = 15;

/**
 * Undo for the person who just saved. Works for Staff too, but only on their own lines and only
 * for a short while after saving; older mistakes go through Edit or the owner's Delete.
 */
export const undoRecent = createServerFn({ method: "POST" })
  .validator((input: UndoTarget[]) => input)
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    const yard = await ensureYard(context.userId);
    if (!canEdit(yard)) return { ok: false as const, error: NEED_EDIT };
    const sql = await sqlClient();
    const since = new Date(Date.now() - UNDO_MINUTES * 60_000).toISOString();
    let undone = 0;
    for (const target of (data ?? []).slice(0, 12)) {
      if (target.kind === "entry") {
        const rows = await sql<{ id: string }>`
          update entries set deleted_at = now(), deleted_by = ${context.userId}
          where id = ${String(target.id)} and yard_id = ${yard.id} and created_by = ${context.userId}
            and created_at > ${since} and deleted_at is null
          returning id
        `;
        undone += rows.length;
      } else if (target.kind === "payment") {
        const rows = await sql<{ id: string }>`
          update payments set deleted_at = now(), deleted_by = ${context.userId}
          where id = ${String(target.id)} and yard_id = ${yard.id} and created_by = ${context.userId}
            and created_at > ${since} and deleted_at is null
          returning id
        `;
        undone += rows.length;
      } else if (target.kind === "stockMove") {
        const rows = await sql<{ id: string }>`
          update stock_moves set deleted_at = now(), deleted_by = ${context.userId}
          where id = ${String(target.id)} and yard_id = ${yard.id} and created_by = ${context.userId}
            and created_at > ${since} and deleted_at is null
          returning id
        `;
        if (rows.length) {
          await sql`update entries set deleted_at = now(), deleted_by = ${context.userId}, updated_at = now() where yard_id = ${yard.id} and parent_id = ${`plant:${String(target.id)}`} and deleted_at is null`;
        }
        undone += rows.length;
      } else if (target.kind === "deposit") {
        const rows = await sql<{ id: string }>`
          update deposits set deleted_at = now(), deleted_by = ${context.userId}
          where id = ${String(target.id)} and yard_id = ${yard.id} and created_by = ${context.userId}
            and created_at > ${since} and deleted_at is null
          returning id
        `;
        undone += rows.length;
      } else if (target.kind === "bill") {
        const billNo = String(target.billNo ?? "").trim();
        if (!billNo) continue;
        // Only a bill made just now, by this person, with nothing returned against it yet.
        const mine = await sql<{ id: string; created_by: string; created_at: string }>`
          select id, created_by, created_at::text as created_at from entries
          where yard_id = ${yard.id} and bill_no = ${billNo} and deleted_at is null and parent_id is null
        `;
        if (!mine.length || mine.some((row) => row.created_by !== context.userId || new Date(row.created_at).getTime() < Date.parse(since))) continue;
        const returned = await sql<{ n: number }>`
          select count(*)::int as n from entries where yard_id = ${yard.id} and deleted_at is null
            and parent_id = any(string_to_array(${mine.map((row) => row.id).join(",")}, ','))
        `;
        if (Number(returned[0]?.n ?? 0) > 0) continue;
        const rows = await sql<{ id: string }>`
          update entries set deleted_at = now(), deleted_by = ${context.userId}, updated_at = now()
          where yard_id = ${yard.id} and id = any(string_to_array(${mine.map((row) => row.id).join(",")}, ',')) and deleted_at is null
          returning id
        `;
        if (rows.length) {
          await sql`
            update documents set deleted_at = now(), deleted_by = ${context.userId}
            where yard_id = ${yard.id} and kind = 'bill' and deleted_at is null and created_by = ${context.userId} and created_at > ${since}
              and (title like ${billNo.replace(/[\\/:*?"<>|]+/g, "-") + " %"} or title like ${billNo + " %"})
          `;
        }
        undone += rows.length ? 1 : 0;
      } else if (target.kind === "restore") {
        // Bring back something this person deleted a moment ago.
        const id = String(target.id);
        let rows: Array<{ id: string }> = [];
        if (target.table === "entry") {
          rows = await sql<{ id: string }>`update entries set deleted_at = null, deleted_by = null, updated_at = now() where id = ${id} and yard_id = ${yard.id} and deleted_by = ${context.userId} and deleted_at > ${since} returning id`;
        } else if (target.table === "payment") {
          rows = await sql<{ id: string }>`update payments set deleted_at = null, deleted_by = null where id = ${id} and yard_id = ${yard.id} and deleted_by = ${context.userId} and deleted_at > ${since} returning id`;
        } else if (target.table === "deposit") {
          rows = await sql<{ id: string }>`update deposits set deleted_at = null, deleted_by = null where id = ${id} and yard_id = ${yard.id} and deleted_by = ${context.userId} and deleted_at > ${since} returning id`;
        } else if (target.table === "stockMove") {
          rows = await sql<{ id: string }>`update stock_moves set deleted_at = null, deleted_by = null where id = ${id} and yard_id = ${yard.id} and deleted_by = ${context.userId} and deleted_at > ${since} returning id`;
          if (rows.length) {
            await sql`update entries set deleted_at = null, deleted_by = null, updated_at = now() where yard_id = ${yard.id} and parent_id = ${`plant:${id}`} and deleted_by = ${context.userId} and deleted_at > ${since}`;
          }
        }
        undone += rows.length;
      } else {
        const rows = await sql<{ id: string }>`
          update entries set deleted_at = now(), deleted_by = ${context.userId}
          where id = (
            select id from entries
            where yard_id = ${yard.id} and parent_id = ${String(target.parentId)} and movement = ${"return"}
              and created_by = ${context.userId} and created_at > ${since} and deleted_at is null
            order by created_at desc limit 1
          )
          returning id
        `;
        if (rows.length) {
          await sql`
            delete from return_logs where id = (
              select id from return_logs
              where yard_id = ${yard.id} and entry_id = ${String(target.parentId)} and actor = ${context.userId} and created_at > ${since}
              order by created_at desc limit 1
            )
          `;
        }
        undone += rows.length;
      }
    }
    if (!undone) return { ok: false as const, error: `Undo only works for ${UNDO_MINUTES} minutes after saving. Edit the line instead.` };
    const restoring = (data ?? []).some((target) => target.kind === "restore");
    await logActivity(yard.id, context.userId, restoring ? "Undid delete" : "Undid entry", `${undone} item${undone === 1 ? "" : "s"}`);
    return { ok: true as const };
  });
