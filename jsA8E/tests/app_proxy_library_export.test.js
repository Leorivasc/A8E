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
      if (message.cmd !== "diskLibraryExport") return;
      assert.equal(typeof message.payload.onProgress, "undefined");
      assert.equal(typeof message.payload.isCanceled, "undefined");
      assert.equal(typeof message.payload.signal, "undefined");
      setTimeout(() => {
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

  const result = await app.diskLibrary.exportPackage({
    fileName: "library.a8e",
    onProgress: function () {},
    isCanceled: function () { return false; },
    signal: { aborted: false },
  });
  assert.equal(result.fileName, "library.a8e");
  assert.equal(result.bytes.byteLength, 1);
  assert.equal(workers.length, 1);

  app.dispose();
  console.log("app_proxy_library_export.test.js passed");
}

main().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
