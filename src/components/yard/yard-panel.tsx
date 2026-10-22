import { useEffect, useState } from "react";
import { createYard, joinYard, renameYard, rotateInviteCode, switchYard, type YardInfo } from "@/lib/inventory/api";
import { inviteLink } from "@/lib/inventory/invite";
import { Field, Panel } from "@/components/yard/ui";
import { useRole } from "@/lib/inventory/role";

export function YardPanel({ yard, onChanged }: { yard: YardInfo; onChanged: () => void }) {
  const [name, setName] = useState(yard.name);
  const [code, setCode] = useState("");
  const [fresh, setFresh] = useState("");
  const { isOwner } = useRole();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirmRotate, setConfirmRotate] = useState(false);
  const link = typeof window === "undefined" ? "" : inviteLink(yard.inviteCode);
  const inviteText = `Join ${yard.name} on Cxyledge, our shared cylinder book. Open this link and sign in: ${link}`;

  async function shareInvite() {
    setError("");
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${yard.name} on Cxyledge`, text: `Join ${yard.name} on Cxyledge, our shared cylinder book.`, url: link });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Invite link copied. Paste it into WhatsApp, SMS or email.");
    } catch {
      setError("Couldn't copy here. Use the WhatsApp or Email button instead.");
    }
  }

  useEffect(() => {
    setName(yard.name);
  }, [yard.name]);

  return (
    <div className="flex flex-col gap-4">
      <Panel title="This account">
        <p className="text-sm text-muted">
          {yard.members} {yard.members === 1 ? "person is" : "people are"} in this book. Manage who can do what on the Users tab. The same sign-in on a phone or a computer sees the same lines.
        </p>
        <fieldset disabled={!isOwner} className="contents">
        <form
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const result = await renameYard({ data: name });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setMessage("Account name saved.");
            onChanged();
          }}
        >
          <div className="flex-1">
            <Field label="Name on the header and bills">
              <input className="field" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </Field>
          </div>
          <button type="submit" className="btn btn-pine">
            Save name
          </button>
        </form>
        </fieldset>
      </Panel>

      <Panel title="Accounts">
        <p className="mb-3 text-sm text-muted">Each account has its own cylinders, bills, and files. The active one is marked.</p>
        <div className="flex flex-col gap-2">
          {yard.yards.map((item) => (
            <button
              key={item.id}
              type="button"
              className={item.active ? "btn btn-pine justify-start" : "btn btn-ghost justify-start"}
              onClick={async () => {
                if (item.active) return;
                const result = await switchYard({ data: item.id });
                if (!result.ok) {
                  setError(result.error);
                  return;
                }
                setMessage(`Now using ${item.name}.`);
                onChanged();
              }}
            >
              {item.name}
              {item.active ? " · active" : ""}
            </button>
          ))}
        </div>
        <form
          className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const result = await createYard({ data: fresh });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setFresh("");
            setMessage("New account created and selected.");
            onChanged();
          }}
        >
          <div className="flex-1">
            <Field label="Add another company account">
              <input className="field" value={fresh} maxLength={60} onChange={(event) => setFresh(event.target.value)} placeholder="Second yard" />
            </Field>
          </div>
          <button type="submit" className="btn btn-rust">
            Add account
          </button>
        </form>
      </Panel>

      {isOwner ? (
      <Panel title="Invite your team">
        <p className="text-sm text-muted">
          Send this link to a teammate. They open it, sign in with Google or email, and land straight in {yard.name}. Anything they add syncs to everyone.
        </p>
        <p className="mt-3 break-all rounded-lg border border-line bg-sand px-3 py-2 font-mono text-sm">{link}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className="btn btn-rust" onClick={() => void shareInvite()}>
            Share invite
          </button>
          <a className="btn btn-ghost" href={`https://wa.me/?text=${encodeURIComponent(inviteText)}`} target="_blank" rel="noopener noreferrer">
            WhatsApp
          </a>
          <a className="btn btn-ghost" href={`mailto:?subject=${encodeURIComponent(`Join ${yard.name} on Cxyledge`)}&body=${encodeURIComponent(inviteText)}`}>
            Email
          </a>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setError("");
              navigator.clipboard
                ?.writeText(link)
                .then(() => setMessage("Invite link copied."))
                .catch(() => setError("Couldn't copy here. Select the link above instead."));
            }}
          >
            Copy link
          </button>
        </div>
        <p className="mt-4 text-sm text-muted">
          Or they can type the code <span className="font-mono font-semibold tracking-widest text-ink">{yard.inviteCode}</span> under Join with a code.
        </p>
        {yard.role === "owner" ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {confirmRotate ? (
              <>
                <span className="text-sm">Old links and the old code will stop working. People already in the book stay in.</span>
                <button
                  type="button"
                  className="btn btn-rust"
                  onClick={async () => {
                    setError("");
                    const result = await rotateInviteCode();
                    setConfirmRotate(false);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    setMessage("New invite link made. Old links no longer work.");
                    onChanged();
                  }}
                >
                  Make new link
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => setConfirmRotate(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => setConfirmRotate(true)}>
                Turn off old links
              </button>
            )}
          </div>
        ) : null}
        <p className="mt-3 text-sm text-muted">New people join as Staff. Change anyone to Owner or View only on the Users tab.</p>
      </Panel>
      ) : (
        <Panel title="Invite your team">
          <p className="text-sm text-muted">Only the owner can invite people. Ask them for an invite link.</p>
        </Panel>
      )}

      <Panel title="Join with a code">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            const result = await joinYard({ data: code });
            if (!result.ok) {
              setError(result.error);
              return;
            }
            setCode("");
            setMessage("Joined. This device is now on that account.");
            onChanged();
          }}
        >
          <div className="flex-1">
            <Field label="Code from the other phone or office">
              <input
                className="field font-mono tracking-widest uppercase"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="AB12CD34"
                autoCapitalize="characters"
              />
            </Field>
          </div>
          <button type="submit" className="btn btn-rust">
            Join
          </button>
        </form>
      </Panel>

      {error ? (
        <p role="alert" className="text-sm text-rust">
          {error}
        </p>
      ) : null}
      {message ? (
        <p role="status" className="text-sm text-pine">
          {message}
        </p>
      ) : null}
    </div>
  );
}
