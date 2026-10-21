/**
 * Invite links: https://<app>/?join=CODE
 * The code is kept on this device until the person has signed in (Google sign-in
 * leaves the page and comes back), then the app joins the book and forgets it.
 */
const KEY = "cxyledge.invite";

export function cleanCode(value: string | null | undefined): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Read ?join= from the address bar, remember it, and tidy the address. */
export function captureInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const url = new URL(window.location.href);
    const code = cleanCode(url.searchParams.get("join"));
    if (code.length >= 6) {
      localStorage.setItem(KEY, code);
      url.searchParams.delete("join");
      window.history.replaceState(null, "", url.pathname + (url.search || "") + url.hash);
    }
  } catch {
    // storage blocked: the person can still type the code in Settings
  }
  return pendingInvite();
}

export function pendingInvite(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const code = cleanCode(localStorage.getItem(KEY));
    return code.length >= 6 ? code : null;
  } catch {
    return null;
  }
}

export function clearInvite() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function inviteLink(code: string): string {
  return `${window.location.origin}/?join=${encodeURIComponent(code)}`;
}
