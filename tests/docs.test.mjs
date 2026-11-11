// The contributor docs and the workflows must stay in step with the scripts.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { latestYear, loadCategories, readmeRow } from "../scripts/lib/catalog.mjs";
import { MAX_LENGTH, validateDeal } from "../scripts/lib/validate.mjs";
import { REPO_ROOT } from "./helpers.mjs";

const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
const year = latestYear(REPO_ROOT);

test("the example file in CONTRIBUTING.md is valid apart from its placeholder address", () => {
  const contributing = read("CONTRIBUTING.md");
  const example = contributing.match(/```yaml\n([\s\S]*?)```/)[1];
  const { deal, errors } = validateDeal(example, { file: "example.yml", year: String(year) });
  assert.deepEqual(errors.map((error) => [error.field, error.problem]), [["url", "is still the example address"]]);
  assert.deepEqual(Object.keys(deal), ["name", "url", "description", "discount", "percent", "code", "terms", "starts", "ends"]);
  assert.ok(contributing.includes(readmeRow(deal)), "the row shown below the example must be the row the example produces");
});

test("CONTRIBUTING.md lists every category folder and the real length limits", () => {
  const contributing = read("CONTRIBUTING.md");
  const listed = [...contributing.matchAll(/^\| (.+?) \| `deals\/(\d{4})\/([a-z0-9-]+)\/` \|$/gm)].map((match) => [match[1], match[2], match[3]]);
  assert.deepEqual(listed, loadCategories(REPO_ROOT).map((category) => [`${category.emoji} ${category.title}`, String(year), category.slug]));
  for (const field of ["name", "description", "discount", "terms"]) {
    const row = contributing.split("\n").find((line) => line.startsWith(`| \`${field}\` |`));
    assert.match(row, new RegExp(`[Uu]p to ${MAX_LENGTH[field]} characters`), field);
  }
  assert.match(contributing, /https:\/\/blackfriday\.mariuslandwehr\.com\/submit\//);
});

test("the workflows are valid YAML and only call npm scripts that exist", () => {
  const scripts = JSON.parse(read("package.json")).scripts;
  for (const name of ["test", "validate", "build:readme", "build:site", "build"]) assert.ok(scripts[name], `package.json script "${name}"`);

  const dir = join(REPO_ROOT, ".github", "workflows");
  assert.deepEqual(readdirSync(dir).sort(), ["publish.yml", "test.yml"]);
  for (const file of readdirSync(dir)) {
    const text = readFileSync(join(dir, file), "utf8");
    const workflow = parse(text);
    assert.ok(workflow.name && workflow.on && workflow.jobs, file);
    for (const [, script] of text.matchAll(/npm run (?:--silent )?([\w:-]+)/g)) assert.ok(scripts[script], `${file} calls "npm run ${script}"`);
    for (const [, path] of text.matchAll(/node (scripts\/[\w.-]+)/g)) assert.ok(existsSync(join(REPO_ROOT, path)), `${file} calls ${path}`);
  }

  const test = parse(read(".github/workflows/test.yml"));
  assert.deepEqual(test.permissions, { contents: "read" });
  assert.ok("pull_request" in test.on && "push" in test.on);

  const publish = parse(read(".github/workflows/publish.yml"));
  assert.deepEqual(publish.on.push.branches, ["master"]);
  assert.ok("workflow_dispatch" in publish.on);
  assert.deepEqual(publish.permissions, {});
  assert.deepEqual(publish.jobs.readme.permissions, { contents: "write" });
  assert.deepEqual(publish.jobs.site.permissions, { contents: "read" });
  assert.deepEqual(publish.jobs.deploy.permissions, { pages: "write", "id-token": "write" });
  assert.equal(publish.concurrency.group, "publish");
  for (const job of ["readme", "site"]) {
    const checkout = publish.jobs[job].steps.find((step) => step.uses?.startsWith("actions/checkout@"));
    assert.equal(checkout.with["fetch-depth"], 0, `${job}: the deal order needs full history`);
  }
});
