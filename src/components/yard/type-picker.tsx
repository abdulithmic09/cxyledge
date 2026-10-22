import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { groupTypes, joinType, splitType } from "@/lib/inventory/gases";

const OTHER = "__other__";
const SUB_WIDTH = 160;

/**
 * Gas type picker as a cascading menu (like a right-click "New ▸" menu):
 * the first list is the gases; hovering or tapping a gas slides out its
 * cylinder sizes (A-Type, B-Type, D-Type…) beside it. Picking a size saves
 * "<size> <gas>", e.g. "B-Type Oxygen". Arrow keys, Enter and Escape work.
 */
export function TypePicker({
  value,
  types,
  onChange,
  label = "Gas type",
}: {
  value: string;
  types: string[];
  onChange: (value: string) => void;
  label?: string;
}) {
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const sub = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [typing, setTyping] = useState(false);
  const [hot, setHot] = useState(0);
  const [openGas, setOpenGas] = useState<string | null>(null);
  const [inSub, setInSub] = useState(false);
  const [subHot, setSubHot] = useState(0);
  const [subPos, setSubPos] = useState({ left: 0, top: 0 });

  const { gases, sizes } = useMemo(() => groupTypes(types), [types]);
  const current = splitType(value);
  const curGas = gases.find((gas) => gas.toLowerCase() === current.gas.toLowerCase());
  const curSize = sizes.find((size) => size.toLowerCase() === current.size.toLowerCase());
  const known = Boolean(value.trim() && curGas && curSize);
  const showOther = typing || (Boolean(value.trim()) && !known);
  const mainRows = [...gases, OTHER];

  function closeAll() {
    window.clearTimeout(hoverTimer.current);
    setOpen(false);
    setOpenGas(null);
    setInSub(false);
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) closeAll();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // On open: highlight the current gas and make sure the menu clears the bottom bar.
  useEffect(() => {
    if (!open) return;
    setHot(showOther ? mainRows.length - 1 : Math.max(0, gases.findIndex((gas) => gas === curGas)));
    requestAnimationFrame(() => {
      const button = trigger.current?.getBoundingClientRect();
      const height = menu.current?.offsetHeight ?? 0;
      if (!button) return;
      const bar = window.matchMedia("(min-width: 1024px)").matches ? 16 : 80;
      const overflow = button.bottom + 8 + height - (window.innerHeight - bar);
      if (overflow > 0) window.scrollBy({ top: Math.min(overflow, button.top - 72), behavior: "smooth" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Place the size list beside the gas row (right side, else left, else overlapping), then slide it in.
  useLayoutEffect(() => {
    if (!openGas || !menu.current || !anchor.current) return;
    const index = gases.indexOf(openGas);
    const row = menu.current.querySelector<HTMLElement>(`[data-row="${index}"]`);
    if (!row) return;
    const box = anchor.current.getBoundingClientRect();
    const m = menu.current;
    let left = m.offsetLeft + m.offsetWidth - 4;
    if (box.left + left + SUB_WIDTH > window.innerWidth - 8) {
      const flipped = m.offsetLeft - SUB_WIDTH + 4;
      left = box.left + flipped >= 8 ? flipped : window.innerWidth - 8 - SUB_WIDTH - box.left;
    }
    let top = m.offsetTop + row.offsetTop - m.scrollTop - 6;
    const subHeight = sub.current?.offsetHeight ?? sizes.length * 36 + 12;
    const bar = window.matchMedia("(min-width: 1024px)").matches ? 16 : 80;
    const over = box.top + top + subHeight - (window.innerHeight - bar);
    if (over > 0) top -= over;
    setSubPos({ left, top });
    sub.current?.animate(
      [
        { opacity: 0, transform: `translateX(${left < m.offsetLeft ? 6 : -6}px) scale(0.98)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 150, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openGas]);

  function showSizes(gas: string, viaKeys = false) {
    window.clearTimeout(hoverTimer.current);
    setOpenGas(gas);
    setInSub(viaKeys);
    const selected = gas === curGas ? sizes.findIndex((size) => size === curSize) : -1;
    setSubHot(viaKeys ? Math.max(0, selected) : -1);
  }

  function pick(gas: string, size: string) {
    setTyping(false);
    onChange(joinType(size, gas));
    closeAll();
    trigger.current?.focus();
  }

  function pickOther() {
    setTyping(true);
    onChange("");
    closeAll();
  }

  function onRowEnter(event: ReactPointerEvent, index: number) {
    setHot(index);
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(hoverTimer.current);
    const gas = mainRows[index]!;
    hoverTimer.current = window.setTimeout(() => {
      if (gas === OTHER) {
        setOpenGas(null);
        setInSub(false);
      } else showSizes(gas);
    }, openGas ? 120 : 60);
  }

  function onKey(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key;
    if (key === "Tab") {
      closeAll();
      return;
    }
    if (!open) {
      if (key === "ArrowDown" || key === "Enter" || key === " ") {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      if (inSub || openGas) {
        setOpenGas(null);
        setInSub(false);
      } else closeAll();
      return;
    }
    if (inSub && openGas) {
      if (key === "ArrowDown" || key === "ArrowUp") {
        event.preventDefault();
        setSubHot((index) => Math.min(sizes.length - 1, Math.max(0, index + (key === "ArrowDown" ? 1 : -1))));
      } else if (key === "ArrowLeft") {
        event.preventDefault();
        setOpenGas(null);
        setInSub(false);
      } else if ((key === "Enter" || key === " ") && sizes[subHot]) {
        event.preventDefault();
        pick(openGas, sizes[subHot]!);
      }
      return;
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault();
      setOpenGas(null);
      setHot((index) => Math.min(mainRows.length - 1, Math.max(0, index + (key === "ArrowDown" ? 1 : -1))));
    } else if (key === "ArrowRight" || key === "Enter" || key === " ") {
      event.preventDefault();
      const row = mainRows[hot]!;
      if (row === OTHER) {
        if (key !== "ArrowRight") pickOther();
      } else showSizes(row, true);
    }
  }

  const rowBase = "flex h-9 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-sm transition-colors duration-75";
  const panel = "rounded-xl border border-line bg-card p-1.5 shadow-xl shadow-black/15";

  return (
    <div ref={wrap}>
      <span id={`${id}-label`} className="mb-1.5 block text-sm font-medium">
        {label}
      </span>
      <div ref={anchor} className="relative">
        <button
          ref={trigger}
          type="button"
          className="field flex w-full items-center justify-between gap-2 text-left"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-labelledby={`${id}-label`}
          aria-controls={`${id}-menu`}
          onClick={() => (open ? closeAll() : setOpen(true))}
          onKeyDown={onKey}
        >
          {known ? (
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate font-medium">{curGas}</span>
              <span className="shrink-0 text-sm text-muted">{curSize}</span>
            </span>
          ) : (
            <span className={cn("truncate", !showOther && "text-muted")}>{showOther ? value.trim() || "Other…" : "Choose a gas type"}</span>
          )}
          <ChevronDown className={cn("size-4 shrink-0 text-muted transition-transform duration-200 ease-out motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
        </button>

        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-labelledby={`${id}-label`}
          aria-hidden={!open}
          className={cn(
            panel,
            "absolute left-0 top-full z-40 mt-1.5 max-h-80 w-48 origin-top-left overflow-y-auto overscroll-contain",
            "transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none",
            open ? "pointer-events-auto scale-100 opacity-100" : "pointer-events-none -translate-y-1 scale-95 opacity-0",
          )}
          onScroll={() => openGas && setOpenGas(null)}
        >
          {gases.map((gas, index) => {
            const lit = openGas === gas || (!openGas && hot === index);
            return (
              <div
                key={gas}
                data-row={index}
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={openGas === gas}
                tabIndex={-1}
                className={cn(rowBase, lit ? "bg-pine text-white" : "hover:bg-sand")}
                onPointerEnter={(event) => onRowEnter(event, index)}
                onClick={() => showSizes(gas)}
              >
                <span className="grid w-4 shrink-0 place-items-center">{gas === curGas && !showOther ? <Check className="size-3.5" aria-hidden /> : null}</span>
                <span className="flex-1 truncate">{gas}</span>
                <ChevronRight className={cn("size-4 shrink-0", lit ? "text-white" : "text-muted")} aria-hidden />
              </div>
            );
          })}
          <div className="mx-2 my-1 h-px bg-line" role="separator" />
          <div
            role="menuitem"
            tabIndex={-1}
            className={cn(rowBase, !openGas && hot === gases.length ? "bg-pine text-white" : "text-muted hover:bg-sand")}
            onPointerEnter={(event) => onRowEnter(event, gases.length)}
            onClick={pickOther}
          >
            <span className="grid w-4 shrink-0 place-items-center">{showOther ? <Check className="size-3.5" aria-hidden /> : null}</span>
            <span className="flex-1 truncate">Other… (type it)</span>
          </div>
        </div>

        {open && openGas ? (
          <div
            ref={sub}
            role="menu"
            aria-label={`${openGas} sizes`}
            className={cn(panel, "absolute z-50")}
            style={{ left: subPos.left, top: subPos.top, width: SUB_WIDTH }}
            onPointerEnter={() => window.clearTimeout(hoverTimer.current)}
          >
            {sizes.map((size, index) => {
              const selected = openGas === curGas && size === curSize && !showOther;
              return (
                <div
                  key={size}
                  role="menuitemradio"
                  aria-checked={selected}
                  tabIndex={-1}
                  className={cn(rowBase, subHot === index ? "bg-pine text-white" : "hover:bg-sand")}
                  onPointerMove={() => {
                    if (subHot !== index) setSubHot(index);
                    if (!inSub) setInSub(true);
                  }}
                  onClick={() => pick(openGas, size)}
                >
                  <span className="grid w-4 shrink-0 place-items-center">{selected ? <Check className="size-3.5" aria-hidden /> : null}</span>
                  <span className="flex-1 truncate">{size}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {showOther ? (
        <input
          className="field mt-2"
          value={known ? "" : value}
          maxLength={60}
          autoFocus={typing}
          onChange={(event) => onChange(event.target.value)}
          placeholder="e.g. B-Type Helium"
          aria-label="Other gas type"
        />
      ) : null}
      <span className="mt-1 block text-xs text-muted">Pick a gas, then its cylinder size. Change the lists in Settings → Gas types.</span>
    </div>
  );
}
