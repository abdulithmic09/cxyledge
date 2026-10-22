import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

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
    <div className="rounded-xl border border-line bg-card px-4 py-3">
      <p className="text-sm text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-3xl font-semibold tabular-nums tracking-tight",
          tone === "pine" && "text-pine",
          tone === "rust" && "text-rust",
        )}
      >
        {value}
      </p>
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
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
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
    <section className={cn("rounded-xl border border-line bg-card p-4 sm:p-5", className)}>
      {title ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="font-display text-2xl leading-tight">{title}</h2>
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function EmptyNote({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-card px-5 py-8 text-center">
      <h2 className="font-display text-2xl">{title}</h2>
      <div className="mx-auto mt-2 max-w-md text-sm text-muted">{children}</div>
    </div>
  );
}
