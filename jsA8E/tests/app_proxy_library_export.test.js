/* global __dirname, console, process, setTimeout */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

async function main() {
  const source = fs.readFileSync(
    path.join(__dirname, "..", "js", "core", "app_proxy.js"),
    "utf8",
  );
  const workers = [];

  class FakePort {
    constructor() {
      this.onmessage = null;
    }

    postMessage() {}

    start() {}
  }

  class FakeMessageChannel {
    constructor() {
      this.port1 = new FakePort();
      this.port2 = new FakePort();
    }
  }

  class FakeCanvas {
    constructor() {
      this.width = 456;
      this.height = 240;
    }

    transferControlToOffscreen() {
      return {};
    }
  }

  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.messages = [];
      workers.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
      if (message.type === "init") {
        setTimeout(() => {
          this.onmessage({
            data: { type: "init-done", rendererBackend: "2d" },
          });
          this.onmessage({
            data: {
              type: "diskLibrarySnapshot",
              ready: true,
              restored: true,
              files: [],
              folders: [],
              trash: [{ id: "deleted", name: "DELETED.ATR", deletedAt: 1 }],
              revisions: { disk1: [{ id: "r1", size: 3, preferred: true }] },
            },
          });
        }, 0);
        return;
      }
      if (message.type !== "req") return;
      if (message.cmd === "diskLibraryRestoreTrash") {
        assert.equal(message.payload.id, "deleted");
        setTimeout(() => {
          this.onmessage({
            data: { type: "response", id: message.id, ok: true, result: true },
          });
        }, 0);
        return;
      }
      if (message.cmd === "diskLibraryRenameFolder" ||
          message.cmd === "diskLibrarySelectRevision" ||
          message.cmd === "diskLibraryVerify" ||
          message.cmd === "diskLibraryStorageEstimate" ||
          message.cmd === "diskLibraryCancel") {
        setTimeout(() => {
          this.onmessage({
            data: { type: "response", id: message.id, ok: true, result: { cmd: message.cmd, payload: message.payload } },
          });
        }, 0);
        return;
      }
      if (message.cmd !== "diskLibraryExport") return;
      assert.equal(typeof message.payload.onProgress, "undefined");
      assert.equal(typeof message.payload.isCanceled, "undefined");
      assert.equal(typeof message.payload.signal, "undefined");
      assert.equal(typeof message.payload.opId, "number");
      setTimeout(() => {
        this.onmessage({
          data: {
            type: "diskLibraryProgress",
            opId: message.payload.opId,
            progress: { phase: "export", completed: 1, total: 2, current: "A.ATR" },
          },
        });
        this.onmessage({
          data: {
            type: "response",
            id: message.id,
            ok: true,
            result: {
              buffer: new ArrayBuffer(1),
              fileName: message.payload.fileName,
            },
          },
        });
      }, 0);
    }

    terminate() {}
  }

  const context = {
    console,
    setTimeout,
    clearTimeout,
    Worker: FakeWorker,
    MessageChannel: FakeMessageChannel,
    OffscreenCanvas: function OffscreenCanvas() {},
    HTMLCanvasElement: FakeCanvas,
  };
  context.window = context;
  context.self = context;
  FakeCanvas.prototype.transferControlToOffscreen = FakeCanvas.prototype.transferControlToOffscreen;
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "app_proxy.js" });

  const app = context.window.A8EApp.create({
    canvas: new FakeCanvas(),
    worker: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));
  const trash = app.diskLibrary.listTrash();
  assert.equal(trash.length, 1);
  assert.equal(trash[0].id, "deleted");
  assert.equal(trash[0].name, "DELETED.ATR");
  assert.equal(trash[0].deletedAt, 1);
  assert.equal(await app.diskLibrary.restoreTrash("deleted"), true);

  const progress = [];
  let cancelRequested = true;
  const result = await app.diskLibrary.exportPackage({
    fileName: "library.a8e",
    onProgress: function (p) { progress.push(p); },
    isCanceled: function () { return cancelRequested; },
    signal: { aborted: false },
  });
  assert.equal(progress.length, 1);
  assert.equal(progress[0].current, "A.ATR");
  assert.ok(workers[0].messages.some((m) => m.cmd === "diskLibraryCancel" && m.payload.opId > 0));
  cancelRequested = false;
  assert.equal(result.fileName, "library.a8e");
  assert.equal(result.bytes.byteLength, 1);
  assert.equal(workers.length, 1);

  const workspace = await app.diskLibrary.exportWorkspacePackage({ fileName: "workspace.a8e" });
  assert.equal(workspace.fileName, "workspace.a8e");
  assert.equal(workspace.bytes.byteLength, 1);
  const revisions = app.diskLibrary.listRevisions("disk1");
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].id, "r1");
  assert.equal(app.diskLibrary.listRevisions("missing").length, 0);
  assert.equal((await app.diskLibrary.renameFolder("f", "New")).payload.name, "New");
  assert.equal((await app.diskLibrary.selectRevision("disk1", "r1")).payload.revisionId, "r1");
  assert.equal((await app.diskLibrary.verifyFile("disk1")).cmd, "diskLibraryVerify");
  assert.equal((await app.diskLibrary.getStorageEstimate()).cmd, "diskLibraryStorageEstimate");

  app.dispose();
  console.log("app_proxy_library_export.test.js passed");
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
