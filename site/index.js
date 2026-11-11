// `node --test site/` runs this file: Node treats a folder argument as a module
// and looks for its index.js. It loads every test in site/tests/.
import { readdirSync } from "node:fs";

const tests = new URL("./tests/", import.meta.url);
for (const file of readdirSync(tests).filter((name) => name.endsWith(".test.mjs")).sort()) {
  await import(new URL(file, tests));
}
