#!/usr/bin/env node
// Propagates the version from package.json to the files that cannot read it at
// runtime: manifest.json (.mcpb bundle) and server.json (MCP registry).
//
//   node scripts/sync-version.mjs            write the version everywhere
//   node scripts/sync-version.mjs --check    fail if anything is out of sync
//
// src/constants.ts reads package.json directly, so it never needs syncing.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const checkOnly = process.argv.includes("--check");

const readJson = (file) => JSON.parse(readFileSync(join(rootDir, file), "utf8"));
const { version } = readJson("package.json");

if (typeof version !== "string" || !version) {
  console.error("sync-version: package.json has no version");
  process.exit(1);
}

/** Every place a version is duplicated, as a path into that file's JSON. */
const targets = [
  { file: "manifest.json", path: ["version"] },
  { file: "server.json", path: ["version"] },
  { file: "server.json", path: ["packages", 0, "version"] }
];

const readAt = (root, path) => path.reduce((node, key) => (node == null ? undefined : node[key]), root);

function writeAt(root, path, value) {
  const parent = readAt(root, path.slice(0, -1));
  const key = path[path.length - 1];
  if (parent == null) throw new Error(`missing ${path.slice(0, -1).join(".")}`);
  const changed = parent[key] !== value;
  parent[key] = value;
  return changed;
}

const stale = [];
const documents = new Map();

for (const { file, path } of targets) {
  if (!documents.has(file)) documents.set(file, readJson(file));
  const document = documents.get(file);
  const label = `${file}:${path.join(".")}`;
  const current = readAt(document, path);
  if (current !== version) stale.push({ label, current });
  writeAt(document, path, version);
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(`sync-version: ${stale.length} file(s) do not match package.json ${version}:`);
    for (const { label, current } of stale) console.error(`  ${label} is ${current ?? "missing"}`);
    console.error("Run: npm run sync-version");
    process.exit(1);
  }
  console.log(`sync-version: everything matches ${version}`);
  process.exit(0);
}

if (stale.length === 0) {
  console.log(`sync-version: already at ${version}`);
  process.exit(0);
}

for (const [file, document] of documents) {
  writeFileSync(join(rootDir, file), `${JSON.stringify(document, null, 2)}\n`, "utf8");
}
console.log(`sync-version: set ${version} in ${stale.map(({ label }) => label).join(", ")}`);
