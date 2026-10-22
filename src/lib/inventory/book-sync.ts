import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listEntries, type Entry } from "@/lib/inventory/api";
import { entriesSince } from "@/lib/inventory/sync";

const FULL_EVERY_MS = 3 * 60 * 1000;
const cursors = new Map<string, { cursor: string; fullAt: number }>();

function order(list: Entry[]) {
  return list.sort((a, b) => (a.entryDate === b.entryDate ? b.updatedAt.localeCompare(a.updatedAt) : b.entryDate.localeCompare(a.entryDate)));
}

/**
 * The book's lines, kept fresh every few seconds by asking only for what changed.
 * Everything is reloaded every few minutes, or whenever the counts don't add up.
 */
export function useBookEntries(userId: string, yardId: string | undefined) {
  const client = useQueryClient();
  const queryKey = ["entries", userId, yardId];
  return useQuery({
    queryKey,
    enabled: Boolean(yardId),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<Entry[]> => {
      const key = `${userId}|${yardId}`;
      const previous = client.getQueryData<Entry[]>(queryKey);
      const meta = cursors.get(key);
      if (previous && meta && Date.now() - meta.fullAt < FULL_EVERY_MS) {
        const delta = await entriesSince({ data: { since: meta.cursor } });
        const map = new Map(previous.map((entry) => [entry.id, entry]));
        let touched = false;
        for (const id of delta.gone) touched = map.delete(id) || touched;
        for (const entry of delta.changed) {
          const old = map.get(entry.id);
          if (!old || old.updatedAt !== entry.updatedAt) touched = true;
          map.set(entry.id, entry);
        }
        if (map.size === delta.total || delta.total > 20000) {
          meta.cursor = delta.cursor;
          return touched ? order([...map.values()]) : previous;
        }
      }
      const start = await entriesSince({ data: { since: "2999-01-01" } });
      const all = await listEntries();
      cursors.set(key, { cursor: start.cursor, fullAt: Date.now() });
      return all;
    },
  });
}
