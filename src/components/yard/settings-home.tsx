import { useEffect, useState } from "react";
import { Archive, Building2, ChevronLeft, ChevronRight, Flame, Smartphone, Users } from "lucide-react";
import { saveLetterhead, type Entry, type Payment, type YardInfo } from "@/lib/inventory/api";
import { useRole } from "@/lib/inventory/role";
import { BackupPanel, backupDue, entriesCsvText, paymentsCsvText } from "@/components/yard/backup-panel";
import { BinPanel } from "@/components/yard/bin-panel";
import { InstallPanel } from "@/components/yard/install-panel";
import { TypesPanel } from "@/components/yard/types-panel";
import { applyLook, DEFAULT_LOOK, NO_COLORS, readLook, writeLook, type Look, type LookAccent, type LookColors, type LookMode, type LookSize } from "@/lib/inventory/look";
import { cn } from "@/lib/cn";
import { YardPanel } from "@/components/yard/yard-panel";
import { Field, Panel } from "@/components/yard/ui";

const MODES: Array<{ id: LookMode; label: string }> = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

type Section = "business" | "team" | "gases" | "backup" | "app";

const SECTIONS: Array<{ id: Section; title: string; hint: string; icon: typeof Users }> = [
  { id: "business", title: "Business details", hint: "Letterhead: address, phone, GST, PAN and logo", icon: Building2 },
  { id: "team", title: "Team & accounts", hint: "Invite people, join a book, rename or switch books", icon: Users },
  { id: "gases", title: "Gas types & prices", hint: "The gases and cylinder sizes you deal in", icon: Flame },
  { id: "backup", title: "Backup & deleted items", hint: "Download a copy, restore, and Recently deleted", icon: Archive },
  { id: "app", title: "App & appearance", hint: "Phone app, light or dark, colours and text size", icon: Smartphone },
];

const SIZES: Array<{ id: LookSize; label: string }> = [
  { id: "sm", label: "Small" },
  { id: "md", label: "Regular" },
  { id: "lg", label: "Large" },
];

export function SettingsHome({ yard, entries, payments, onChanged }: { yard: YardInfo; entries: Entry[]; payments: Payment[]; onChanged: () => void }) {
  const { isOwner } = useRole();
  const [look, setLook] = useState<Look>(DEFAULT_LOOK);
  const [address, setAddress] = useState(yard.address);
  const [gst, setGst] = useState(yard.gst);
  const [pan, setPan] = useState(yard.pan);
  const [phone, setPhone] = useState(yard.phone);
  const [logo, setLogo] = useState(yard.logo);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section | null>(null);
  const due = isOwner && backupDue(yard);

  useEffect(() => {
    setLook(readLook());
  }, []);

  useEffect(() => {
    setAddress(yard.address);
    setGst(yard.gst);
    setPan(yard.pan);
    setPhone(yard.phone);
    setLogo(yard.logo);
  }, [yard]);

  function updateLook(partial: Partial<Look>) {
    const next = { ...look, ...partial };
    setLook(next);
    writeLook(next);
    applyLook(next);
  }

  const current = SECTIONS.find((item) => item.id === section);

  if (current) {
    return (
      <div className="flex flex-col gap-4">
        <button type="button" className="-ml-2 flex w-fit items-center gap-1 rounded-lg px-2 py-1 text-sm font-semibold text-muted hover:bg-sand" onClick={() => setSection(null)}>
          <ChevronLeft className="size-4" aria-hidden /> Settings
        </button>
        <div>
          <h2 className="font-display text-3xl">{current.title}</h2>
          <p className="mt-1 text-sm text-muted">{current.hint}.</p>
        </div>
        {section === "business" ? (
          <>
            <Panel title="Letterhead">
              {!isOwner ? <p className="mb-3 text-sm text-muted">Only the owner can change the letterhead.</p> : null}
              <fieldset disabled={!isOwner} className="contents">
              <form
                className="grid gap-3"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setError("");
                  const result = await saveLetterhead({ data: { address, gst, pan, phone, logo } });
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setMessage("Letterhead saved for this account.");
                  onChanged();
                }}
              >
                <Field label="Address">
                  <textarea className="field field-area min-h-20" value={address} maxLength={240} onChange={(event) => setAddress(event.target.value)} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Phone">
                    <input className="field" value={phone} maxLength={24} onChange={(event) => setPhone(event.target.value)} />
                  </Field>
                  <Field label="GST">
                    <input className="field" value={gst} maxLength={20} onChange={(event) => setGst(event.target.value)} />
                  </Field>
                  <Field label="PAN">
                    <input className="field" value={pan} maxLength={12} onChange={(event) => setPan(event.target.value)} />
                  </Field>
                </div>
                <Field label="Logo" hint="Small PNG or JPG, under about 80 KB.">
                  <input
                    className="field py-2"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      if (file.size > 80_000) {
                        setError("Use a logo under 80 KB.");
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => setLogo(String(reader.result ?? ""));
                      reader.readAsDataURL(file);
                    }}
                  />
                </Field>
                {logo ? <img src={logo} alt="" className="h-12 w-auto" /> : null}
                {error ? <p className="text-sm text-rust">{error}</p> : null}
                {message ? <p className="text-sm text-pine">{message}</p> : null}
                <button type="submit" className="btn btn-pine w-fit">
                  Save letterhead
                </button>
              </form>
              </fieldset>
            </Panel>
          </>
        ) : null}
        {section === "team" ? <YardPanel yard={yard} onChanged={onChanged} /> : null}
        {section === "gases" ? (
          <>
            <TypesPanel yard={yard} onChanged={onChanged} />
            <p className="text-sm text-muted">Prices for each customer are on their page: Customers → the company → Rates.</p>
          </>
        ) : null}
        {section === "backup" ? (
          <>
            <BackupPanel yard={yard} entriesCsv={() => entriesCsvText(entries)} paymentsCsv={() => paymentsCsvText(payments)} onChanged={onChanged} />
            {isOwner ? <BinPanel onChanged={onChanged} /> : null}
          </>
        ) : null}
        {section === "app" ? (
          <>
            <InstallPanel />
            <Panel title="Appearance">
              <p className="mb-3 text-sm text-muted">Theme, colours, and type size stay on this device.</p>
              <div className="grid grid-cols-3 gap-2">
                {MODES.map((item) => (
                  <button key={item.id} type="button" className={cn("btn", look.mode === item.id ? "btn-pine" : "btn-ghost")} onClick={() => updateLook({ mode: item.id })}>
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["rust", "pine"] as LookAccent[]).map((accent) => (
                  <button key={accent} type="button" className={cn("btn", look.accent === accent ? "btn-pine" : "btn-ghost")} onClick={() => updateLook({ accent })}>
                    {accent === "rust" ? "Rust accent" : "Pine accent"}
                  </button>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["background", "Background colour", "#f3efe6"],
                    ["text", "Text colour", "#1c1915"],
                    ["accent", "Accent colour", "#8f3d16"],
                  ] as Array<[keyof LookColors, string, string]>
                ).map(([key, label, fallback]) => (
                  <label key={key} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 text-sm">
                    <span>
                      {label}
                      <span className="block text-xs text-muted">{look.colors[key] ? look.colors[key] : "Theme default"}</span>
                    </span>
                    <input
                      type="color"
                      aria-label={label}
                      className="h-9 w-12 cursor-pointer rounded border border-line bg-transparent"
                      value={look.colors[key] || fallback}
                      onChange={(event) => updateLook({ colors: { ...look.colors, [key]: event.target.value } })}
                    />
                  </label>
                ))}
              </div>
              <div className="mt-2">
                <button type="button" className="btn btn-ghost" onClick={() => updateLook({ colors: NO_COLORS })} disabled={!look.colors.background && !look.colors.text && !look.colors.accent}>
                  Reset custom colours
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {SIZES.map((item) => (
                  <button key={item.id} type="button" className={cn("btn", look.size === item.id ? "btn-pine" : "btn-ghost")} onClick={() => updateLook({ size: item.id })}>
                    {item.label}
                  </button>
                ))}
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-3xl">Settings</h2>
        <p className="mt-1 text-sm text-muted">
          Active book <span className="font-semibold text-ink">{yard.name}</span>.
        </p>
      </div>
      <ul className="overflow-hidden rounded-xl border border-line bg-card">
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const dot = item.id === "backup" && due;
          return (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <button type="button" className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-sand" onClick={() => setSection(item.id)}>
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sand text-ink">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {item.title}
                    {dot ? <span className="rounded-full bg-rust px-2 py-0.5 text-[0.7rem] font-semibold text-rust-fg">Backup due</span> : null}
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
  );
}
