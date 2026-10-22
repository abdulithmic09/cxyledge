import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { canEdit, ensureYard, logActivity, NEED_EDIT, sqlClient } from "@/lib/inventory/api";

/** What an Undo right after saving takes back: a new line, or the latest take-back on a delivery. */
export type UndoTarget = { kind: "entry"; id: string } | { kind: "return"; parentId: string };

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
    for (const target of (data ?? []).slice(0, 4)) {
      if (target.kind === "entry") {
        const rows = await sql<{ id: string }>`
          update entries set deleted_at = now(), deleted_by = ${context.userId}
          where id = ${String(target.id)} and yard_id = ${yard.id} and created_by = ${context.userId}
            and created_at > ${since} and deleted_at is null
          returning id
        `;
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
    await logActivity(yard.id, context.userId, "Undid entry", `${undone} line${undone === 1 ? "" : "s"}`);
    return { ok: true as const };
  });
