import { HINDI } from "@/lib/inventory/hindi";

export type Lang = "en" | "hi";
const KEY = "cxyledge.lang";

export function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === "hi" ? "hi" : "en";
  } catch {
    return "en";
  }
}

/**
 * Hindi option. The screens are written in English; when Hindi is on, words on screen that are in
 * the Hindi list are swapped as they appear. Names, serial numbers, amounts and anything typed in
 * boxes are never touched. Bills, receipts and WhatsApp messages stay in English.
 */
const ATTRS = ["placeholder", "aria-label", "title"] as const;
const SKIP = "input, textarea, script, style, .code, [data-no-translate], [contenteditable]";
const originals = new WeakMap<Text, string>();
const attrOriginals = new WeakMap<Element, Record<string, string>>();
let observer: MutationObserver | null = null;
let current: Lang = "en";

function lookup(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 200) return null;
  const hit = HINDI[trimmed] ?? HINDI[trimmed.replace(/\s+/g, " ")];
  if (!hit) return null;
  const lead = text.match(/^\s*/)?.[0] ?? "";
  const tail = text.match(/\s*$/)?.[0] ?? "";
  return lead + hit + tail;
}

function translateText(node: Text) {
  const parent = node.parentElement;
  if (!parent || parent.closest(SKIP)) return;
  const source = originals.get(node);
  const value = node.nodeValue ?? "";
  // If React changed the text since we translated it, treat the new text as the English source.
  const english = source != null && value === lookup(source) ? source : value;
  const hindi = lookup(english);
  if (hindi && hindi !== value) {
    originals.set(node, english);
    node.nodeValue = hindi;
  }
}

function translateAttrs(el: Element) {
  if (el.closest("[data-no-translate]")) return;
  for (const name of ATTRS) {
    const value = el.getAttribute(name);
    if (!value) continue;
    const saved = attrOriginals.get(el) ?? {};
    const english = saved[name] != null && value === lookup(saved[name]!) ? saved[name]! : value;
    const hindi = lookup(english);
    if (hindi && hindi !== value) {
      saved[name] = english;
      attrOriginals.set(el, saved);
      el.setAttribute(name, hindi);
    }
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return translateText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.matches("script, style")) return;
  translateAttrs(el);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let next = walker.nextNode();
  while (next) {
    if (next.nodeType === Node.TEXT_NODE) translateText(next as Text);
    else translateAttrs(next as Element);
    next = walker.nextNode();
  }
}

function restoreAll() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let next = walker.nextNode();
  while (next) {
    if (next.nodeType === Node.TEXT_NODE) {
      const source = originals.get(next as Text);
      if (source != null && (next as Text).nodeValue === lookup(source)) (next as Text).nodeValue = source;
    } else {
      const saved = attrOriginals.get(next as Element);
      if (saved) for (const [name, value] of Object.entries(saved)) if ((next as Element).getAttribute(name) === lookup(value)) (next as Element).setAttribute(name, value);
    }
    next = walker.nextNode();
  }
}

export function applyLang(lang: Lang) {
  if (typeof document === "undefined") return;
  current = lang;
  document.documentElement.lang = lang === "hi" ? "hi" : "en";
  if (lang === "hi") {
    walk(document.body);
    if (!observer) {
      observer = new MutationObserver((records) => {
        if (current !== "hi") return;
        for (const record of records) {
          if (record.type === "characterData") translateText(record.target as Text);
          else if (record.type === "attributes") translateAttrs(record.target as Element);
          else record.addedNodes.forEach(walk);
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] });
    }
  } else {
    observer?.disconnect();
    observer = null;
    restoreAll();
  }
}

export function setLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // remembered on this device only when storage works
  }
  applyLang(lang);
}
