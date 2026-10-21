import { useEffect, useState } from "react";

/** Start the service worker that keeps the last-loaded book readable without internet. */
export function registerOffline() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  if (!import.meta.env.PROD) return;
  const go = () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // offline reading is a bonus; the app works without it
    });
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/** Forget everything saved for offline use on this device (used on sign-out). */
export async function clearOfflineData() {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("cxyledge-")).map((key) => caches.delete(key)));
    }
  } catch {
    // ignore
  }
}

export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as InstallEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

/** Add-to-home-screen state for the Settings panel. */
export function useInstall() {
  const [, bump] = useState(0);
  const [standalone, setStandalone] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "android" | "desktop">("desktop");
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    const nav = navigator as Navigator & { standalone?: boolean };
    setStandalone(window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true);
    const ua = navigator.userAgent;
    setPlatform(/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? "ios" : /Android/i.test(ua) ? "android" : "desktop");
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return {
    standalone,
    platform,
    canPrompt: deferred !== null,
    async prompt() {
      if (!deferred) return false;
      await deferred.prompt();
      const choice = await deferred.userChoice.catch(() => ({ outcome: "dismissed" }));
      deferred = null;
      bump((n) => n + 1);
      return choice.outcome === "accepted";
    },
  };
}
