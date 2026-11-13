/* global __dirname, console, require */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const context = { window: {}, String: String, Math: Math, Set: Set };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "app", "printer_paper.js"), "utf8"),
  context,
);
const { createPaper, attach } = context.window.A8EPrinterPaper;

const paper = createPaper({ maxLines: 3 });
const changes = [];
paper.onChange(function (count) { changes.push(count); });

paper.add({ type: "line", text: "one", sideways: false, columns: 40 });
paper.add({ type: "line", text: "a <b> & c", sideways: false, columns: 40 });
paper.add({ type: "line", text: "", sideways: false, columns: 40 });
paper.add({ type: "unknown", text: "ignored" });
assert.equal(paper.getLineCount(), 3);
assert.equal(paper.toText(), "one\na <b> & c\n\n");
assert.deepEqual(changes, [1, 2, 3]);

const html = paper.toHtml("T <1>");
assert.ok(html.includes("<title>T &lt;1&gt;</title>"));
assert.ok(html.includes("<div>a &lt;b&gt; &amp; c</div>"));
assert.ok(html.includes("<div>&nbsp;</div>"), "blank line keeps its height");

// The oldest line tears off when the paper is full.
paper.add({ type: "line", text: "four", sideways: true, columns: 29 });
assert.equal(paper.toText(), "a <b> & c\n\nfour\n");
assert.ok(paper.toHtml().includes('<div class="sideways">four</div>'));

paper.clear();
assert.equal(paper.toText(), "");
assert.equal(paper.getLineCount(), 0);

// attach() feeds one paper per app from printer-range device events only.
let listener = null;
const app = { onSioDeviceEvent: function (fn) { listener = fn; return function () {}; } };
const attached = attach(app);
assert.equal(attach(app), attached, "one paper per app");
listener({ device: 0x31, event: { type: "line", text: "disk" } });
listener({ device: 0x40, event: { type: "line", text: "printed" } });
assert.equal(attached.toText(), "printed\n");
assert.equal(attach({}), null);

console.log("printer_paper.test.js passed");
