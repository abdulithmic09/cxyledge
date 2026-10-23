import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** One figure in a tally strip or a small summary box. */
export function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "pine" | "rust";
}) {
  return (
    <div className="card px-4 py-3">
      <p className="label">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-xl font-bold tabular-nums",
          tone === "pine" && "text-pine",
          tone === "rust" && "text-rust",
        )}
      >
        {value}
      </p>
    </div>
  );
}

const COLS: Record<number, string> = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" };

/** Figures in one ruled row, edge to edge on a phone. */
export function Tally({ items, className }: { items: Array<{ label: string; value: ReactNode; tone?: "pine" | "rust" }>; className?: string }) {
  return (
    <div className={cn("tally", COLS[items.length] ?? "grid-cols-2", className)}>
      {items.map((item) => (
        <div key={item.label}>
          <p className="label truncate">{item.label}</p>
          <p className={cn("mt-0.5 truncate text-lg font-bold tabular-nums", item.tone === "pine" && "text-pine", item.tone === "rust" && "text-rust")}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

/** Page title with an optional line of detail and actions on the right. */
export function PageHead({ title, detail, action }: { title: string; detail?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[1.375rem] font-bold leading-tight sm:text-2xl">{title}</h2>
        {detail ? <p className="mt-0.5 text-sm text-muted">{detail}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 gap-2">{action}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Panel({
  title,
  action,
  children,
  className,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("card p-4 sm:p-5", className)}>
      {title ? (
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-base font-bold leading-tight">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="card px-5 py-8 text-center">
      <h2 className="text-base font-bold">{title}</h2>
      <div className="mx-auto mt-1.5 max-w-md text-sm text-muted">{children}</div>
    </div>
  );
}
