// Applies small text edits from patches.json on top of the unpacked app.tgz.
// Edits for one file are applied in order, each searched for after the previous
// one, so repeated snippets land in the right place. A missing match stops the build.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
if (existsSync("patches.json")) {
  const patches = JSON.parse(readFileSync("patches.json", "utf8"));
  const texts = new Map();
  const cursor = new Map();
  for (const [i, p] of patches.entries()) {
    const text = texts.get(p.file) ?? readFileSync(p.file, "utf8");
    const from = cursor.get(p.file) ?? 0;
    const at = text.indexOf(p.old, from);
    if (at < 0) throw new Error(`patch ${i} does not match in ${p.file}`);
    texts.set(p.file, text.slice(0, at) + p.new + text.slice(at + p.old.length));
    cursor.set(p.file, at + p.new.length - 1);
  }
  for (const [file, text] of texts) writeFileSync(file, text);
  console.log(`[patches] applied ${patches.length} edit(s) to ${texts.size} file(s)`);
}
