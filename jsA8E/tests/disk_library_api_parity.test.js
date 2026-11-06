/* global __dirname, console */

// Every library method the UI calls must exist in both the main-thread
// library (disk_library.js) and the worker proxy (app_proxy.js).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function read(...parts) {
  return fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
}

// Keys of the first `return { ... }` object that contains `marker`, searching
// from `after`.
function apiKeys(source, after, marker) {
  const from = source.indexOf(after);
  assert.ok(from >= 0, "marker not found: " + after);
  const hit = source.indexOf(marker, from);
  assert.ok(hit >= 0, "marker not found: " + marker);
  const start = source.lastIndexOf("{", hit);
  const end = source.slice(hit).search(/^ {0,8}\},?;?$/m);
  const block = source.slice(start, hit + end);
  const keys = new Set();
  block.replace(/^\s+(\w+): \w+,?$/gm, function (_, key) { keys.add(key); return ""; });
  return keys;
}

const ui = read("js", "app", "disk_library_ui.js");
const used = new Set();
ui.replace(/\blibrary\.([A-Za-z]\w*)\(/g, function (_, name) { used.add(name); return ""; });

const core = apiKeys(read("js", "core", "disk_library.js"), "function createApi", "addFile: addFile");
const proxy = apiKeys(read("js", "core", "app_proxy.js"), "function createDiskLibraryProxy", "listFiles: listFiles");

const missing = [];
used.forEach(function (name) {
  if (!core.has(name)) missing.push("core:" + name);
  if (!proxy.has(name)) missing.push("proxy:" + name);
});
assert.deepEqual(missing, [], "library API differs between worker and main thread: " + missing.join(", "));
console.log("disk_library_api_parity.test.js passed (" + used.size + " methods)");
