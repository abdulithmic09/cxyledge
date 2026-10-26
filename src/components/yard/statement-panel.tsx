import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Link2Off, MessageCircle, X } from "lucide-react";
import { createStatementLink, getStatementLink, revokeStatementLink } from "@/lib/inventory/statement";
import { balanceMessage, whatsappLink } from "@/lib/inventory/whatsapp";
import type { CompanyBalance } from "@/lib/inventory/analyse";
import type { YardInfo } from "@/lib/inventory/api";
import { formatDay } from "@/lib/inventory/model";
import { useRole } from "@/lib/inventory/role";

export const statementUrl = (token: string) => `${window.location.origin}/s/${token}`;

/** The company's statement link, shared by the hero's WhatsApp button too. */
export function useStatementLink(company: string) {
  return useQuery({ queryKey: ["statement-link", company], queryFn: () => getStatementLink({ data: company }), staleTime: 60_000 });
}

/** Turn a company's private statement link on or off, copy it, or send it on WhatsApp. */
export function StatementPanel({ yard, balance, phone, onClose }: { yard: YardInfo; balance: CompanyBalance; phone: string; onClose: () => void }) {
  const { canEdit } = useRole();
  const company = balance.company;
  const client = useQueryClient();
  const link = useStatementLink(company);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [confirmOff, setConfirmOff] = useState(false);
  const url = link.data ? statementUrl(link.data.token) : "";

  const refresh = () => client.invalidateQueries({ queryKey: ["statement-link", company] });
  const turnOn = async () => {
    setBusy(true);
    setNote("");
    try {
      const result = await createStatementLink({ data: company });
      if (!result.ok) setNote(result.error);
      await refresh();
    } catch {
      setNote("Couldn't make the link. Check the internet and try again.");
    } finally {
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await revokeStatementLink({ data: company });
      await refresh();
      setConfirmOff(false);
      setNote("Link turned off. The old link no longer opens.");
    } catch {
      setNote("Couldn't turn it off. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setNote("Link copied.");
    } catch {
      setNote(url);
    }
  };

  return (
    <section className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg leading-tight">Statement link</h2>
          <p className="mt-0.5 text-sm text-muted">
            A private web page for {company} with their balance, unpaid bills and cylinders. It stays up to date by itself, and they don&apos;t need to sign in.
          </p>
        </div>
        <button type="button" className="btn btn-ghost size-9 min-h-0 shrink-0 p-0" onClick={onClose} aria-label="Close">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {link.isPending ? <p className="mt-3 text-sm text-muted">Checking…</p> : null}

      {!link.isPending && !link.data ? (
        canEdit ? (
          <button type="button" className="btn btn-pine mt-3 gap-1.5" disabled={busy} onClick={turnOn}>
            <Link2 className="size-4" aria-hidden /> {busy ? "Making link…" : "Turn on statement link"}
          </button>
        ) : (
          <p className="mt-3 text-sm text-muted">No link yet. Ask the owner or staff to turn it on.</p>
        )
      ) : null}

      {link.data ? (
        <div className="mt-3 flex flex-col gap-2.5">
          <p className="code break-all rounded-lg bg-sand px-3 py-2 text-xs">{url}</p>
          <p className="text-xs text-muted">
            On since {formatDay(link.data.createdAt.slice(0, 10))} · opened {link.data.views} {link.data.views === 1 ? "time" : "times"}
            {link.data.lastViewedAt ? `, last on ${formatDay(link.data.lastViewedAt.slice(0, 10))}` : ""}
          </p>
          <div className="flex flex-wrap gap-2 [&>*]:h-10 [&>*]:min-h-0 [&>*]:px-3.5 [&>*]:text-sm">
            <a className="btn btn-pine gap-1.5" href={whatsappLink(phone, balanceMessage({ yardName: yard.name, balance, statementUrl: url }))} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="size-4" aria-hidden /> Send on WhatsApp
            </a>
            <button type="button" className="btn btn-ghost gap-1.5" onClick={copy}>
              <Copy className="size-4" aria-hidden /> Copy link
            </button>
            <a className="btn btn-ghost gap-1.5" href={url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="size-4" aria-hidden /> Open
            </a>
            {canEdit ? (
              confirmOff ? (
                <button type="button" className="btn btn-danger gap-1.5" disabled={busy} onClick={turnOff}>
                  <Link2Off className="size-4" aria-hidden /> {busy ? "Turning off…" : "Yes, turn off"}
                </button>
              ) : (
                <button type="button" className="btn btn-ghost gap-1.5" onClick={() => setConfirmOff(true)}>
                  <Link2Off className="size-4" aria-hidden /> Turn off
                </button>
              )
            ) : null}
          </div>
          <p className="text-xs text-muted">Anyone with this link can see this one company&apos;s statement, nothing else. Turn it off any time; you can make a new one later.</p>
        </div>
      ) : null}
      {note ? (
        <p className="mt-2 text-sm" role="status">
          {note}
        </p>
      ) : null}
    </section>
  );
}
