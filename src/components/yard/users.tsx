import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listActivity, listMembers, removeMember, ROLE_LABEL, setMemberRole, type Activity, type Member, type Role } from "@/lib/inventory/api";
import { ROLE_HELP, useRole } from "@/lib/inventory/role";
import { toCsv } from "@/lib/inventory/files";
import { cn } from "@/lib/cn";
import { ExportBar } from "@/components/yard/export-bar";
import { PageHead, Panel, Tally } from "@/components/yard/ui";

const ACTIVE_MS = 5 * 60 * 1000;

function when(ts: string | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function seen(member: Member): { label: string; active: boolean } {
  if (!member.lastSeenAt) return { label: "Hasn't opened the book yet", active: false };
  const age = Date.now() - new Date(member.lastSeenAt).getTime();
  if (age < ACTIVE_MS) return { label: "Active now", active: true };
  const mins = Math.round(age / 60000);
  if (mins < 60) return { label: `Last active ${mins} min ago`, active: false };
  const hours = Math.round(mins / 60);
  if (hours < 24) return { label: `Last active ${hours} h ago`, active: false };
  return { label: `Last active ${when(member.lastSeenAt)}`, active: false };
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

/** Everyone in this book and a log of what each person did. */
export function UsersView({ yardName }: { yardName: string }) {
  const members = useQuery({ queryKey: ["members"], queryFn: () => listMembers(), refetchInterval: 15000 });
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => listActivity(), refetchInterval: 15000 });
  const [who, setWho] = useState<string | "all">("all");
  const [query, setQuery] = useState("");
  const { isOwner } = useRole();
  const queryClient = useQueryClient();
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [manageNote, setManageNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);

  async function changeRole(member: Member, role: Role) {
    setBusy(member.userId);
    setManageNote(null);
    const result = await setMemberRole({ data: { userId: member.userId, role } });
    setBusy(null);
    setManageNote(result.ok ? { tone: "ok", text: `${member.name} is now ${ROLE_LABEL[role]}.` } : { tone: "bad", text: result.error });
    void queryClient.invalidateQueries({ queryKey: ["members"] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    void queryClient.invalidateQueries({ queryKey: ["yard"] });
  }

  async function remove(member: Member) {
    setBusy(member.userId);
    setManageNote(null);
    const result = await removeMember({ data: member.userId });
    setBusy(null);
    setConfirmRemove(null);
    setManageNote(
      result.ok
        ? { tone: "ok", text: `${member.name} has been removed. Your invite link changed, so the old one no longer works. Their past changes stay in the log.` }
        : { tone: "bad", text: result.error },
    );
    if (who === member.userId) setWho("all");
    void queryClient.invalidateQueries();
  }

  const people = useMemo(() => members.data ?? [], [members.data]);
  const byId = useMemo(() => new Map(people.map((m) => [m.userId, m])), [people]);
  const log = activity.data ?? [];
  const needle = query.trim().toLowerCase();
  const shown = log.filter((row) => {
    if (who !== "all" && row.userId !== who) return false;
    if (!needle) return true;
    const person = byId.get(row.userId);
    return `${row.action} ${row.detail} ${person?.name ?? ""} ${person?.email ?? ""}`.toLowerCase().includes(needle);
  });
  const activeNow = people.filter((m) => seen(m).active).length;

  const label = (row: Activity) => {
    const person = byId.get(row.userId);
    return person ? `${person.name}${person.email ? ` (${person.email})` : ""}` : "Former member";
  };
  const lines = [
    `${yardName} · activity${who !== "all" ? ` of ${byId.get(who)?.name ?? ""}` : ""}`,
    "",
    ...shown.map((row) => `${when(row.createdAt)}  ${label(row)}  ${row.action}${row.detail ? ` · ${row.detail}` : ""}`),
  ];
  const csv = toCsv(
    ["When", "Name", "Email", "Action", "Details"],
    shown.map((row) => [when(row.createdAt), byId.get(row.userId)?.name ?? "Former member", byId.get(row.userId)?.email ?? "", row.action, row.detail]),
  );

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Users" detail={yardName} />
      <Tally
        items={[
          { label: "People", value: people.length },
          { label: "Active now", value: activeNow, tone: activeNow ? "pine" : undefined },
          { label: "Changes logged", value: log.length },
        ]}
      />

      {members.isPending ? <p className="text-sm text-muted">Loading people…</p> : null}
      {members.isError ? <p className="text-sm text-rust">Couldn&apos;t load the people in this book. Pull to refresh or try again shortly.</p> : null}

      {isOwner ? (
        <div className="rounded-xl border border-line bg-card px-4 py-3 text-sm">
          <p className="font-semibold">Who can do what</p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted">
            {(["owner", "staff", "viewer"] as Role[]).map((role) => (
              <li key={role}>
                <span className="font-medium text-ink">{ROLE_LABEL[role]}:</span> {ROLE_HELP[role]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {manageNote ? (
        <p className={cn("rounded-xl border border-line px-4 py-3 text-sm", manageNote.tone === "ok" ? "bg-card text-pine" : "bg-sand text-rust")} role="status">
          {manageNote.text}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {people.map((member) => {
          const status = seen(member);
          const on = who === member.userId;
          const role = member.role as Role;
          return (
            <div key={member.userId} className={cn("flex flex-col rounded-xl border bg-card", on ? "border-rust" : "border-line hover:border-rust")}>
            <button
              type="button"
              aria-pressed={on}
              className="flex-1 p-4 text-left"
              onClick={() => setWho(on ? "all" : member.userId)}
            >
              <div className="flex items-center gap-3">
                {member.image ? (
                  <img src={member.image} alt="" className="size-10 rounded-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <span className="grid size-10 place-items-center rounded-full bg-sand text-sm font-semibold">{initials(member.name)}</span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">
                    {member.name}
                    {member.isYou ? <span className="font-normal text-muted"> · you</span> : null}
                  </p>
                  <p className="truncate text-sm text-muted">{member.email || "No email on record"}</p>
                </div>
                <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", role === "owner" ? "bg-ink text-paper" : "bg-sand text-ink")}>
                  {ROLE_LABEL[role] ?? "Staff"}
                </span>
              </div>
              <p className={cn("mt-3 flex items-center gap-2 text-sm", status.active ? "text-pine" : "text-muted")}>
                <span className={cn("size-2 rounded-full", status.active ? "bg-pine" : "bg-line")} aria-hidden />
                {status.label}
              </p>
              <p className="mt-1 text-sm text-muted">
                Joined {when(member.joinedAt)} · {member.actions} {member.actions === 1 ? "change" : "changes"}
                {member.lastActionAt ? ` · last on ${when(member.lastActionAt)}` : ""}
              </p>
            </button>
            {isOwner && !member.isYou ? (
              <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
                <label className="flex items-center gap-2 text-sm">
                  <span className="text-muted">Role</span>
                  <select
                    className="field h-10 w-auto py-0"
                    value={role}
                    disabled={busy === member.userId}
                    onChange={(event) => void changeRole(member, event.target.value as Role)}
                    aria-label={`Role for ${member.name}`}
                  >
                    <option value="owner">Owner</option>
                    <option value="staff">Staff</option>
                    <option value="viewer">View only</option>
                  </select>
                </label>
                {confirmRemove === member.userId ? (
                  <>
                    <button type="button" className="btn btn-rust" disabled={busy === member.userId} onClick={() => void remove(member)}>
                      Remove {member.name.split(" ")[0]}
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => setConfirmRemove(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-ghost ml-auto" onClick={() => setConfirmRemove(member.userId)}>
                    Remove
                  </button>
                )}
              </div>
            ) : null}
            </div>
          );
        })}
      </div>

      <Panel title={who === "all" ? "All activity" : `Activity by ${byId.get(who)?.name ?? "this person"}`}>
        <div className="mb-3 flex flex-wrap gap-2">
          <input
            className="field flex-1"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a company, bill, action or person"
            aria-label="Find in activity"
          />
          {who !== "all" ? (
            <button type="button" className="btn btn-ghost" onClick={() => setWho("all")}>
              Show everyone
            </button>
          ) : null}
        </div>
        {activity.isPending ? <p className="text-sm text-muted">Loading activity…</p> : null}
        {!activity.isPending && shown.length === 0 ? (
          <p className="text-sm text-muted">
            {log.length ? "Nothing matches." : "No changes logged yet. Entries, bills, files, returns and settings changes appear here with who made them."}
          </p>
        ) : null}
        <ul className="flex flex-col divide-y divide-line">
          {shown.slice(0, 300).map((row) => {
            const person = byId.get(row.userId);
            return (
              <li key={row.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="text-sm">
                    <span className="font-semibold">{person?.name ?? "Former member"}</span>{" "}
                    <span className="text-muted">{person?.email ? `(${person.email})` : ""}</span>
                  </p>
                  <p className="text-xs tabular-nums text-muted">{when(row.createdAt)}</p>
                </div>
                <p className="mt-0.5 text-sm">
                  <span className="font-medium">{row.action}</span>
                  {row.detail ? <span className="text-muted"> · {row.detail}</span> : null}
                </p>
              </li>
            );
          })}
        </ul>
        {shown.length > 300 ? <p className="mt-2 text-xs text-muted">Showing the latest 300. Export to see all {shown.length}.</p> : null}
        {shown.length ? (
          <div className="mt-4">
            <ExportBar title={`${yardName} activity`} filename="cxyledge-activity" lines={lines} csv={csv} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
