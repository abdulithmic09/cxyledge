import { useState } from "react";
import { useInstall } from "@/lib/inventory/offline";
import { Panel } from "@/components/yard/ui";

/** Add Cxyledge to the home screen so it opens like an app and still shows the book without internet. */
export function InstallPanel() {
  const install = useInstall();
  const [note, setNote] = useState("");

  return (
    <Panel title="Phone app">
      {install.standalone ? (
        <p className="text-sm text-pine">Cxyledge is installed on this device. It opens from your home screen and shows the last-loaded book even without internet.</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            Add Cxyledge to your home screen. It opens like an app, and if the network in the yard drops you can still see the book as it was last loaded. Saving changes needs internet.
          </p>
          {install.canPrompt ? (
            <button
              type="button"
              className="btn btn-rust mt-3"
              onClick={() => {
                void install.prompt().then((ok) => setNote(ok ? "Installed. Look for Cxyledge on your home screen." : ""));
              }}
            >
              Add to home screen
            </button>
          ) : install.platform === "ios" ? (
            <ol className="mt-3 list-decimal pl-5 text-sm">
              <li>Open this page in Safari.</li>
              <li>Tap the Share button (square with an arrow).</li>
              <li>Choose <span className="font-semibold">Add to Home Screen</span>, then Add.</li>
            </ol>
          ) : install.platform === "android" ? (
            <ol className="mt-3 list-decimal pl-5 text-sm">
              <li>Open this page in Chrome.</li>
              <li>Tap the ⋮ menu at the top right.</li>
              <li>Choose <span className="font-semibold">Add to Home screen</span> or <span className="font-semibold">Install app</span>.</li>
            </ol>
          ) : (
            <p className="mt-3 text-sm">On a computer, use the install icon at the right end of Chrome or Edge&apos;s address bar. On a phone, open this page and use Add to Home Screen.</p>
          )}
          {note ? <p className="mt-2 text-sm text-pine">{note}</p> : null}
        </>
      )}
    </Panel>
  );
}
