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

// 1029 lines: attribute runs become spans, bit image columns an SVG, and
// plain text gets a placeholder for the image.
const rich = createPaper();
rich.add({
  type: "line",
  text: "a<b",
  columns: 80,
  runs: [
    { text: "a", elongated: false, underline: false },
    { text: "<b", elongated: true, underline: true },
  ],
  dots: [0x7f, 0x01, 0x40],
});
rich.add({ type: "line", text: "", columns: 80, runs: [], dots: [0x08] });
assert.equal(rich.toText(), "a<b [bit image, 3 columns]\n[bit image, 1 columns]\n");
const body = rich.toHtmlBody();
assert.ok(body.includes('a<span class="wide ul" style="margin-right:2ch">&lt;b</span>'), body);
assert.ok(body.includes('viewBox="0 0 3 7"'));
assert.ok(body.includes('<rect x="0" y="0" width="1" height="1"/>'), "bit 6 is the top pin");
assert.ok(body.includes('<rect x="2" y="0" width="1" height="1"/>'));
assert.ok(body.includes('<rect x="1" y="6" width="1" height="1"/>'), "bit 0 is the bottom pin");
assert.ok(!body.includes("\n"), "lines are blocks: no newline between them");
assert.ok(rich.toHtml("t").includes(".dots{display:block}"));

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
