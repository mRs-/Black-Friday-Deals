// Shared helpers for the tests: throwaway catalog folders and git repositories.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { devNull, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
export const script = (name) => join(REPO_ROOT, "scripts", name);

export const CATEGORIES = [
  { slug: "dev-tools", title: "Dev Tools", emoji: "🛠", anchor: "dev-tools" },
  { slug: "reference-education", title: "Reference & Education", emoji: "🎓", anchor: "reference--education" },
  { slug: "books", title: "Books", emoji: "📖", anchor: "books" },
];

export const categoriesYaml = (categories = CATEGORIES) =>
  categories.map((c) => `- slug: ${c.slug}\n  title: ${c.title}\n  emoji: ${c.emoji}\n  anchor: ${c.anchor}\n`).join("");

// A deal file's text. Pass null for a field to leave it out.
export function dealYaml(fields = {}) {
  const deal = {
    name: "Example App",
    url: "https://example-app.dev/sale",
    description: "Does one thing well.",
    discount: "40% off",
    ...fields,
  };
  return Object.entries(deal)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${typeof value === "number" ? value : JSON.stringify(value)}\n`)
    .join("");
}

// Creates a temporary folder with the given files ({ "relative/path": "text" }) and
// removes it when the test ends. categories.yml is added unless the files bring their own.
export function makeRoot(t, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "bf-deals-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  write(root, { "deals/categories.yml": categoriesYaml(), ...files });
  return root;
}

export function write(root, files) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

// Runs git in `root`, isolated from the machine's git settings. `date` sets both the
// author and the committer time of a commit.
export function git(root, args, date) {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", "-c", "commit.gpgsign=false", ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: devNull,
      GIT_CONFIG_NOSYSTEM: "1",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
}

export function commitAll(root, message, date) {
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "-m", message], date);
}

// Runs one of the scripts and returns { status, stdout, stderr }.
export function run(name, args = [], env = {}) {
  const result = spawnSync(process.execPath, [script(name), ...args], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "", ...env },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, output: result.stdout + result.stderr };
}
