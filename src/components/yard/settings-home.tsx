import { useEffect, useState } from "react";
import { Archive, Building2, ChevronLeft, ChevronRight, Flame, Smartphone, Users } from "lucide-react";
import { saveLetterhead, type Entry, type Payment, type YardInfo } from "@/lib/inventory/api";
import { useRole } from "@/lib/inventory/role";
import { BackupPanel, backupDue, entriesCsvText, paymentsCsvText } from "@/components/yard/backup-panel";
import { BinPanel } from "@/components/yard/bin-panel";
import { InstallPanel } from "@/components/yard/install-panel";
import { TypesPanel } from "@/components/yard/types-panel";
import { readLang, setLang, type Lang } from "@/lib/inventory/lang";
import { applyLook, DEFAULT_LOOK, NO_COLORS, readLook, writeLook, type Look, type LookAccent, type LookColors, type LookMode, type LookSize } from "@/lib/inventory/look";
import { cn } from "@/lib/cn";
import { YardPanel } from "@/components/yard/yard-panel";
import { Field, PageHead, Panel } from "@/components/yard/ui";

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
  { id: "app", title: "App & appearance", hint: "Language, phone app, light or dark, colours and text size", icon: Smartphone },
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
  const [email, setEmail] = useState(yard.email ?? "");
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
    setEmail(yard.email ?? "");
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
      <div className="flex flex-col gap-3">
        <button type="button" className="-ml-2 -mb-1 flex w-fit items-center gap-1 rounded-md px-2 py-1 text-sm text-muted hover:bg-sand hover:text-ink" onClick={() => setSection(null)}>
          <ChevronLeft className="size-4" aria-hidden /> Settings
        </button>
        <PageHead title={current.title} />
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
                  const result = await saveLetterhead({ data: { address, gst, pan, phone, email, logo } });
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
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Phone">
                    <input className="field" value={phone} maxLength={40} inputMode="tel" onChange={(event) => setPhone(event.target.value)} />
                  </Field>
                  <Field label="Email">
                    <input className="field" type="email" value={email} maxLength={80} onChange={(event) => setEmail(event.target.value)} />
                  </Field>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
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
            <LanguagePanel />
            <InstallPanel />
            <Panel title="Appearance">
              <p className="mb-3 text-sm text-muted">Theme, colours, and type size stay on this device.</p>
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Theme</span>
                  <div className="seg" role="group" aria-label="Theme">
                    {MODES.map((item) => (
                      <button key={item.id} type="button" aria-pressed={look.mode === item.id} onClick={() => updateLook({ mode: item.id })}>
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Colour</span>
                  <div className="seg" role="group" aria-label="Colour">
                    {(["rust", "pine"] as LookAccent[]).map((accent) => (
                      <button key={accent} type="button" aria-pressed={look.accent === accent} onClick={() => updateLook({ accent })}>
                        <span className={cn("mr-1.5 inline-block size-2.5 rounded-full align-middle", accent === "rust" ? "bg-[#1e4d3c]" : "bg-[#8f3d16]")} aria-hidden />
                        {accent === "rust" ? "Green" : "Rust"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {(
                  [
                    ["background", "Background colour", "#f3efe6"],
                    ["text", "Text colour", "#1c1915"],
                    ["accent", "Accent colour", "#1e4d3c"],
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
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">Text size</span>
                <div className="seg" role="group" aria-label="Text size">
                  {SIZES.map((item) => (
                    <button key={item.id} type="button" aria-pressed={look.size === item.id} onClick={() => updateLook({ size: item.id })}>
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </Panel>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PageHead title="Settings" detail={yard.name} />
      <ul className="card overflow-hidden">
        {SECTIONS.map((item) => {
          const Icon = item.icon;
          const dot = item.id === "backup" && due;
          return (
            <li key={item.id} className="border-b border-line last:border-b-0">
              <button type="button" className="flex w-full items-center gap-3 px-4 py-3.5 text-left hover:bg-sand" onClick={() => setSection(item.id)}>
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {item.title}
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
  );
}

/** English or Hindi on this device. */
function LanguagePanel() {
  const [lang, setLangState] = useState<Lang>("en");
  useEffect(() => setLangState(readLang()), []);
  const pick = (next: Lang) => {
    setLang(next);
    setLangState(next);
  };
  return (
    <Panel title="Language">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted" data-no-translate>
          Screens in English or Hindi. Bills and WhatsApp messages stay in English. / स्क्रीन अंग्रेज़ी या हिन्दी में। बिल और WhatsApp संदेश अंग्रेज़ी में रहेंगे।
        </p>
        <div className="seg" role="group" aria-label="Language" data-no-translate>
          <button type="button" aria-pressed={lang === "en"} onClick={() => pick("en")}>
            English
          </button>
          <button type="button" aria-pressed={lang === "hi"} onClick={() => pick("hi")}>
            हिन्दी
          </button>
        </div>
      </div>
    </Panel>
  );
}
