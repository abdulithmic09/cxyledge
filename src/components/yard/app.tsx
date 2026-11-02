import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, Building2, CalendarCheck, ChevronRight, Cylinder, LayoutList, MoreHorizontal, PieChart, Receipt, Settings, Users } from "lucide-react";
import { SignInPanel } from "@/components/yard/sign-in-panel";
import { UserButton } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getYard, joinYard, listDocuments, listPayments, listReturns, normalizeRole, peekInvite, ROLE_LABEL } from "@/lib/inventory/api";
import { RoleContext } from "@/lib/inventory/role";
import { BackupReminder, backupDue } from "@/components/yard/backup-panel";
import { registerOffline, useOnline } from "@/lib/inventory/offline";
import { captureInvite, clearInvite, pendingInvite } from "@/lib/inventory/invite";
import { applyLook, readLook } from "@/lib/inventory/look";
import { applyLang, readLang } from "@/lib/inventory/lang";
import { cn } from "@/lib/cn";
import { BookView } from "@/components/yard/book";
import { CustomersView } from "@/components/yard/customers";
import { BillsView } from "@/components/yard/bills";
import { StockView } from "@/components/yard/stock-view";
import { DaySummary } from "@/components/yard/day-summary";
import { SettingsHome } from "@/components/yard/settings-home";
import { UsersView } from "@/components/yard/users";
import { EntryLauncher, showInBook } from "@/components/yard/entry-launcher";
import { GlobalSearch } from "@/components/yard/global-search";
import { KeyboardShortcuts, type ShortcutView } from "@/components/yard/shortcuts";
import { useBookEntries } from "@/lib/inventory/book-sync";
import { requestBillEdit, requestCylinder } from "@/lib/inventory/nav-requests";

const AnalyticsView = lazy(() => import("@/components/yard/analytics"));

type View = "book" | "customers" | "bills" | "stock" | "more" | "day" | "analyse" | "users" | "setup";

type NavItem = { id: View; label: string; icon: typeof Cylinder; hint?: string };

/** Everything, for the computer's sidebar. */
const NAV: NavItem[] = [
  { id: "book", label: "Book", icon: LayoutList },
  { id: "customers", label: "Customers", icon: Building2 },
  { id: "bills", label: "Bills", icon: Receipt },
  { id: "stock", label: "Stock", icon: Boxes },
  { id: "day", label: "Day summary", icon: CalendarCheck },
  { id: "analyse", label: "Analytics", icon: PieChart },
  { id: "users", label: "Users", icon: Users },
  { id: "setup", label: "Settings", icon: Settings },
];

/** The phone's bottom bar: the four daily screens plus More. */
const BAR: NavItem[] = [
  { id: "book", label: "Book", icon: LayoutList },
  { id: "customers", label: "Customers", icon: Building2 },
  { id: "bills", label: "Bills", icon: Receipt },
  { id: "stock", label: "Stock", icon: Boxes },
  { id: "more", label: "More", icon: MoreHorizontal },
];

const MORE: NavItem[] = [
  { id: "day", label: "Day summary", icon: CalendarCheck, hint: "Today's cylinders, money collected and new dues" },
  { id: "analyse", label: "Analytics", icon: PieChart, hint: "Sales and payments by day, month or year" },
  { id: "users", label: "Users", icon: Users, hint: "People, roles and activity" },
  { id: "setup", label: "Settings", icon: Settings, hint: "Business, gas types, backup, appearance" },
];

const inMore = (view: View) => view === "more" || MORE.some((item) => item.id === view);

export function YardApp() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  useEffect(() => {
    registerOffline();
  }, []);
  return (
    <QueryClientProvider client={client}>
      <Gate />
    </QueryClientProvider>
  );
}

function Gate() {
  const { user, isPending } = useCurrentUserState();
  useEffect(() => {
    captureInvite();
  }, []);
  if (isPending) return <BootScreen label="Opening your yard…" />;
  if (!user) return <SignedOut />;
  return <Shell userId={user.id} />;
}

function BootScreen({ label }: { label: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 text-ink">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid size-11 place-items-center rounded-xl bg-ink text-paper">
          <Cylinder className="size-5" aria-hidden />
        </span>
        <p className="text-sm text-muted">{label}</p>
      </div>
    </main>
  );
}

function SignedOut() {
  const [invitedTo, setInvitedTo] = useState<string | null>(null);
  useEffect(() => {
    const code = captureInvite();
    if (!code) return;
    peekInvite({ data: code })
      .then((result) => setInvitedTo(result.ok ? result.name : null))
      .catch(() => {});
  }, []);
  return (
    <main className="relative grid min-h-screen place-items-center bg-paper px-4 py-10 text-ink">
      <div className="navy absolute inset-x-0 top-0 h-[42vh]" aria-hidden />
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5 text-white">
          <span className="grid size-10 place-items-center rounded-xl bg-paper text-ink">
            <Cylinder className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-display text-xl leading-tight">Cxyledge</p>
            <p className="text-xs text-white/70">Cylinder book for gas agencies</p>
          </div>
        </div>
        <div className="card p-6 shadow-xl shadow-black/10">
          {invitedTo ? (
            <p className="mb-4 rounded-md bg-brand-soft px-3 py-2.5 text-sm" role="status">
              You&apos;re invited to <span className="font-semibold">{invitedTo}</span>. Sign in and you&apos;ll go straight into that book.
            </p>
          ) : null}
          <h1 className="text-xl font-bold">Welcome</h1>
          <p className="mt-1 text-sm text-muted">Sign in or create an account to open your book.</p>
          <div className="mt-4">
            <SignInPanel />
          </div>
        </div>
      </div>
    </main>
  );
}

function Shell({ userId }: { userId: string }) {
  const [view, setView] = useState<View>("book");
  const [focusCompany, setFocusCompany] = useState<string | null>(null);
  const goTo = useCallback((next: ShortcutView) => {
    setFocusCompany(null);
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);
  // Bumped when another screen hands something over, so Bills and Stock open fresh with it.
  const [visit, setVisit] = useState(0);
  const [joinNote, setJoinNote] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  // Hold the book load until an invite is used, so a new teammate doesn't get an empty book of their own first.
  const [joining, setJoining] = useState(() => Boolean(pendingInvite()));
  const queryClient = useQueryClient();

  // Finish an invite link: join the book once the person is signed in.
  useEffect(() => {
    const code = pendingInvite();
    if (!code) return;
    let live = true;
    joinYard({ data: code })
      .then((result) => {
        if (!live) return;
        clearInvite();
        if (result.ok) {
          setJoinNote({ tone: "ok", text: "You've joined the book from your invite. Everything you add now syncs with your team." });
          void queryClient.invalidateQueries();
        } else {
          setJoinNote({ tone: "bad", text: `That invite didn't work: ${result.error} Ask for a new invite link.` });
        }
      })
      .catch(() => {
        if (live) setJoinNote({ tone: "bad", text: "Couldn't join from the invite. Try the link again." });
      })
      .finally(() => {
        if (live) setJoining(false);
      });
    return () => {
      live = false;
    };
  }, [queryClient]);

  useEffect(() => {
    applyLook(readLook());
    if (readLang() === "hi") applyLang("hi");
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyLook(readLook());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const yardQuery = useQuery({
    queryKey: ["yard", userId],
    queryFn: () => getYard(),
    enabled: !joining,
    refetchInterval: 8000,
    refetchOnWindowFocus: true,
  });
  const entryQuery = useBookEntries(userId, yardQuery.data?.id);
  const returnQuery = useQuery({
    queryKey: ["returns", userId, yardQuery.data?.id],
    queryFn: () => listReturns(),
    enabled: Boolean(yardQuery.data?.id),
    refetchInterval: 8000,
  });
  const docQuery = useQuery({
    queryKey: ["docs", userId, yardQuery.data?.id],
    queryFn: () => listDocuments(),
    enabled: Boolean(yardQuery.data?.id),
    // Files are large; refresh them now and then, and whenever something is saved.
    refetchInterval: 60000,
  });
  const paymentQuery = useQuery({
    queryKey: ["payments", userId, yardQuery.data?.id],
    queryFn: () => listPayments(),
    enabled: Boolean(yardQuery.data?.id),
    refetchInterval: 8000,
  });
  const online = useOnline();

  const yard = yardQuery.data;
  const entries = entryQuery.data ?? [];
  const payments = paymentQuery.data ?? [];
  const role = normalizeRole(yard?.role);
  const failed = yardQuery.isError || entryQuery.isError;
  const loading = yardQuery.isPending || (Boolean(yard) && entryQuery.isPending);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ["yard", userId] });
    void queryClient.invalidateQueries({ queryKey: ["entries", userId] });
    void queryClient.invalidateQueries({ queryKey: ["returns", userId] });
    void queryClient.invalidateQueries({ queryKey: ["activity"] });
    void queryClient.invalidateQueries({ queryKey: ["members"] });
    void queryClient.invalidateQueries({ queryKey: ["docs", userId] });
    void queryClient.invalidateQueries({ queryKey: ["payments", userId] });
    void queryClient.invalidateQueries({ queryKey: ["bin"] });
  }

  return (
    <RoleContext.Provider value={role}>
    <div className="min-h-screen bg-paper text-ink">
      <header className="no-print sticky top-0 z-20 border-b border-line bg-card">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4 lg:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="grid size-9 shrink-0 place-items-center rounded-[0.65rem] bg-ink text-paper">
              <Cylinder className="size-[1.1rem]" aria-hidden />
            </span>
            <p className="min-w-0 leading-tight">
              <span className="block font-display text-lg leading-none">Cxyledge</span>
              <span className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
                {yard?.name ?? "Shared yard"}
                {yard && role !== "owner" ? <span className="shrink-0 rounded bg-sand px-1.5 py-px text-[0.65rem] font-semibold text-ink">{ROLE_LABEL[role]}</span> : null}
              </span>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {yard ? (
              <GlobalSearch
                entries={entries}
                payments={payments}
                onOpenCompany={(company) => {
                  setFocusCompany(company);
                  setView("customers");
                }}
                onOpenEntry={(id) => {
                  setFocusCompany(null);
                  setView("book");
                  showInBook(id);
                }}
                onOpenBill={(billNo) => {
                  requestBillEdit(billNo);
                  setVisit((value) => value + 1);
                  setView("bills");
                }}
                onFindCylinder={(serial) => {
                  requestCylinder(serial);
                  setVisit((value) => value + 1);
                  setView("stock");
                }}
              />
            ) : null}
            <UserButton />
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl lg:grid-cols-[12.5rem_minmax(0,1fr)]">
        <aside className="no-print hidden lg:block">
          <nav className="sticky top-16 flex flex-col gap-1 px-3 py-5" aria-label="Sections">
            {NAV.map((item) => {
              const Icon = item.icon;
              const on = view === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={on ? "page" : undefined}
                  className={cn(
                    "flex h-10 items-center gap-2.5 rounded-xl px-3 text-left text-sm font-medium",
                    on ? "bg-card font-semibold text-ink shadow-card ring-1 ring-line [&>svg]:text-gold" : "text-muted hover:bg-card/70 hover:text-ink",
                  )}
                  onClick={() => {
                    setFocusCompany(null);
                    setView(item.id);
                  }}
                >
                  <Icon className="size-4" aria-hidden />
                  {item.label}
                  {item.id === "setup" && role === "owner" && yard && backupDue(yard) && entries.length > 0 ? (
                    <span className="ml-auto size-2 rounded-full bg-rust" aria-label="Backup due" />
                  ) : null}
                </button>
              );
            })}
            <KeyboardShortcuts onGo={goTo} />
          </nav>
        </aside>
        <main className="min-w-0 px-4 py-4 pb-40 lg:px-8 lg:py-6 lg:pb-24">
          {!online ? (
            <p className="mb-4 rounded-lg border border-line bg-sand px-3.5 py-2.5 text-sm" role="status">
              <span className="font-semibold">No internet.</span> You&apos;re seeing the book as it was last loaded. New entries and payments are kept on this phone and go into the book once you&apos;re back online. Edits and bills need internet.
            </p>
          ) : null}
          {failed && online ? (
            <p className="mb-4 rounded-xl border border-line bg-sand px-4 py-3 text-sm text-rust" role="alert">
              The yard could not be loaded.{" "}
              <button type="button" className="font-semibold underline" onClick={refresh}>
                Try again
              </button>
            </p>
          ) : null}
          {joinNote ? (
            <p
              className={cn("mb-4 rounded-xl border border-line px-4 py-3 text-sm", joinNote.tone === "ok" ? "bg-card text-pine" : "bg-sand text-rust")}
              role="status"
            >
              {joinNote.text}{" "}
              <button type="button" className="font-semibold underline" onClick={() => setJoinNote(null)}>
                Dismiss
              </button>
            </p>
          ) : null}
          {yard && role === "viewer" ? (
            <p className="mb-4 card px-4 py-3 text-sm text-muted" role="status">
              You have view-only access to {yard.name}. You can look at everything and export reports, but not change anything.
            </p>
          ) : null}
          {loading ? <p className="text-sm text-muted">Loading the shared book…</p> : null}
          {!loading && yard && view === "book" ? (
            <BookView entries={entries} payments={payments} cylinderTypes={yard.cylinderTypes} userId={userId} yardId={yard.id} logs={returnQuery.data ?? []} onChanged={refresh} syncedAt={entryQuery.dataUpdatedAt} notice={role === "owner" && online ? <BackupReminder yard={yard} hasData={entries.length > 0} onDone={refresh} /> : null} />
          ) : null}
          {!loading && yard && view === "customers" ? (
            <CustomersView
              key={focusCompany ?? "all"}
              yard={yard}
              entries={entries}
              payments={payments}
              documents={docQuery.data ?? []}
              onChanged={refresh}
              initialCompany={focusCompany}
              onOpenBills={() => {
                setFocusCompany(null);
                setVisit((value) => value + 1);
                setView("bills");
              }}
            />
          ) : null}
          {!loading && view === "analyse" ? (
            <Suspense fallback={<p className="text-sm text-muted">Drawing the analysis…</p>}>
              <AnalyticsView entries={entries} payments={payments} yardName={yard?.name ?? "Cxyledge"} />
            </Suspense>
          ) : null}
          {!loading && yard && view === "bills" ? <BillsView key={`bills-${visit}`} yard={yard} entries={entries} onChanged={refresh} /> : null}
          {!loading && yard && view === "stock" ? <StockView key={`stock-${visit}`} yard={yard} entries={entries} payments={payments} onChanged={refresh} /> : null}
          {!loading && yard && view === "day" ? <DaySummary yard={yard} entries={entries} payments={payments} /> : null}
          {!loading && yard && view === "users" ? <UsersView yardName={yard.name} /> : null}
          {!loading && yard && view === "setup" ? <SettingsHome yard={yard} entries={entries} payments={payments} onChanged={refresh} /> : null}
          {!loading && yard && view === "more" ? (
            <div className="flex flex-col gap-4">
              <h2 className="text-xl font-semibold sm:text-2xl">More</h2>
              <ul className="card overflow-hidden">
                {MORE.map((item) => {
                  const Icon = item.icon;
                  const dot = item.id === "setup" && role === "owner" && backupDue(yard) && entries.length > 0;
                  return (
                    <li key={item.id} className="border-b border-line last:border-b-0">
                      <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-sand" onClick={() => setView(item.id)}>
                        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                          <Icon className="size-5" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2 font-semibold">
                            {item.label}
                            {dot ? <span className="tag tag-due">Backup due</span> : null}
                          </span>
                          <span className="block text-xs text-muted">{item.hint}</span>
                        </span>
                        <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </main>
      </div>

      {!loading && yard ? (
        <EntryLauncher
          yard={yard}
          entries={entries}
          payments={payments}
          cylinderTypes={yard.cylinderTypes}
          onChanged={refresh}
          onShowBook={() => {
            setFocusCompany(null);
            setView("book");
          }}
          onOpenBills={() => {
            setFocusCompany(null);
            setVisit((value) => value + 1);
            setView("bills");
          }}
        />
      ) : null}

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-card pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Sections">
        <div className="mx-auto flex max-w-lg">
          {BAR.map((item) => {
            const Icon = item.icon;
            const on = item.id === "more" ? inMore(view) : view === item.id;
            const dot = item.id === "more" && role === "owner" && Boolean(yard) && backupDue(yard!) && entries.length > 0;
            return (
              <button
                key={item.id}
                type="button"
                aria-current={on ? "page" : undefined}
                className={cn(
                  "relative flex min-h-[3.75rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[0.7rem] font-semibold",
                  on ? "text-gold" : "text-muted",
                )}
                onClick={() => {
                  setFocusCompany(null);
                  setView(item.id);
                }}
              >
                <span className="relative">
                  <Icon className="size-5" aria-hidden />
                  {dot ? <span className="absolute -right-1.5 -top-1 size-2.5 rounded-full border-2 border-card bg-rust" aria-label="Backup due" /> : null}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
    </RoleContext.Provider>
  );
}
