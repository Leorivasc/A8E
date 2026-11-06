"use strict";

// Browser-only VBXE gate. It deliberately uses the CDP WebSocket directly so
// the repository does not gain a browser automation dependency. When no
// debugging browser is available the test exits successfully with an explicit
// skip; CI can make it mandatory by setting A8E_REQUIRE_CDP=1.
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const cdpHttpUrl = process.env.A8E_CDP_HTTP || "http://127.0.0.1:9222";
const goldenPath = path.join(__dirname, "fixtures", "vbxe_browser_golden.json");
const golden = JSON.parse(fs.readFileSync(goldenPath, "utf8"));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", chunk => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error("CDP HTTP status " + response.statusCode));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(1500, () => request.destroy(new Error("CDP unavailable")));
  });
}

function websocketFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = crypto.randomBytes(4);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, 0x80 | payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    throw new Error("CDP command is unexpectedly large");
  }
  const masked = Buffer.alloc(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
  return Buffer.concat([header, mask, masked]);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.url = new URL(webSocketUrl);
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.handshake = false;
    this.nextId = 1;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      const port = Number(this.url.port || 80);
      this.socket = net.createConnection({ host: this.url.hostname, port });
      const key = crypto.randomBytes(16).toString("base64");
      let settled = false;
      const fail = error => {
        if (!settled) { settled = true; reject(error); }
        this.close(error);
      };
      this.socket.on("error", fail);
      this.socket.on("close", () => {
        for (const entry of this.pending.values()) entry.reject(new Error("CDP socket closed"));
        this.pending.clear();
      });
      this.socket.on("data", chunk => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        if (!this.handshake) {
          const end = this.buffer.indexOf("\r\n\r\n");
          if (end < 0) return;
          const status = this.buffer.toString("ascii", 0, end);
          if (!/^HTTP\/1\.1 101/.test(status)) {
            fail(new Error("invalid CDP WebSocket handshake"));
            return;
          }
          this.buffer = this.buffer.subarray(end + 4);
          this.handshake = true;
          if (!settled) { settled = true; resolve(); }
        }
        this.readFrames();
      });
      this.socket.on("connect", () => {
        const path = this.url.pathname + (this.url.search || "");
        this.socket.write(
          "GET " + path + " HTTP/1.1\r\n" +
          "Host: " + this.url.host + "\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: " + key + "\r\n" +
          "Sec-WebSocket-Version: 13\r\n\r\n",
        );
      });
    });
  }

  readFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        throw new Error("large CDP event is unsupported");
      }
      const masked = (second & 0x80) !== 0;
      if (masked) offset += 4;
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(offset - 4, offset);
        const decoded = Buffer.alloc(length);
        for (let i = 0; i < length; i++) decoded[i] = payload[i] ^ mask[i & 3];
        payload = decoded;
      }
      this.buffer = this.buffer.subarray(offset + length);
      const opcode = first & 0x0f;
      if (opcode === 0x8) { this.close(); return; }
      if (opcode === 0x9) {
        const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
        this.socket.write(pong);
        continue;
      }
      if (opcode !== 0x1) continue;
      let message;
      try { message = JSON.parse(payload.toString("utf8")); } catch { continue; }
      if (message.id === undefined) continue;
      const entry = this.pending.get(message.id);
      if (!entry) continue;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || "CDP command failed"));
      else entry.resolve(message.result || {});
    }
  }

  command(method, params) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(websocketFrame(JSON.stringify({ id, method, params: params || {} })));
    });
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "browser evaluation failed");
    }
    return result.result && result.result.value;
  }

  close(error) {
    if (this.socket) this.socket.destroy();
    if (error) {
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    }
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function assertGolden(name, actual) {
  const expected = golden.captures[name];
  assert.ok(expected, "missing browser golden capture: " + name);
  for (const key of ["requestedWorker", "worker", "rendererBackend",
    "width", "height", "bytes", "hash"]) {
    assert.deepEqual(actual[key], expected[key],
      "browser golden mismatch for " + name + "." + key);
  }
}

function compareExternalReference(captures) {
  const referencePath = process.env.A8E_VBXE_REFERENCE;
  if (!referencePath) return;
  const reference = JSON.parse(fs.readFileSync(referencePath, "utf8"));
  const expectedCaptures = reference.captures || {};
  for (const name of Object.keys(expectedCaptures)) {
    const actual = captures[name];
    assert.ok(actual, "missing capture for external reference: " + name);
    for (const key of Object.keys(expectedCaptures[name])) {
      assert.deepEqual(actual[key], expectedCaptures[name][key],
        "external VBXE reference mismatch for " + name + "." + key);
    }
  }
  console.log("vbxe_browser_backend: external reference matched " + referencePath);
}

async function waitForAutomation(client) {
  for (let i = 0; i < 50; i++) {
    try {
      if (await client.evaluate("Boolean(window.A8EAutomation && window.A8EAutomation.whenReady)")) return;
    } catch { /* navigation is still in progress */ }
    await wait(100);
  }
  throw new Error("A8EAutomation did not become ready");
}

async function captureBackend(client, url, worker) {
  await client.command("Page.navigate", { url });
  await waitForAutomation(client);
  return client.evaluate(`(async () => {
    const api = await window.A8EAutomation.whenReady();
    const state = await api.getSystemState({ timeoutMs: 5000 });
    if (!state.running) await api.start();
    await api.waitForFrames({ count: 60, timeoutMs: 15000 });
    const shot = await api.captureScreenshot();
    const text = String(shot.base64 || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return {
      requestedWorker: ${worker ? "true" : "false"},
      worker: !!(await api.getSystemState({ timeoutMs: 5000 })).worker,
      rendererBackend: (await api.getSystemState({ timeoutMs: 5000 })).rendererBackend,
      width: shot.width,
      height: shot.height,
      bytes: text.length,
      hash: hash >>> 0,
    };
  })()`);
}

(async () => {
  let targets;
  try {
    targets = await getJson(cdpHttpUrl + "/json/list");
  } catch (error) {
    if (process.env.A8E_REQUIRE_CDP === "1") throw error;
    console.log("vbxe_browser_backend: skipped (CDP unavailable)");
    return;
  }
  const target = targets.find(item => item.type === "page" &&
    item.webSocketDebuggerUrl && /^https?:/i.test(item.url || ""));
  if (!target) {
    if (process.env.A8E_REQUIRE_CDP === "1") throw new Error("no browser page target");
    console.log("vbxe_browser_backend: skipped (no HTTP page target)");
    return;
  }
  const originalUrl = target.url;
  const base = new URL(originalUrl);
  base.search = "";
  base.hash = "";
  const client = new CdpClient(target.webSocketDebuggerUrl);
  try {
    await client.connect();
    await client.command("Page.enable");
    await client.command("Runtime.enable");
    await client.command("Network.enable");
    await client.command("Network.setCacheDisabled", { cacheDisabled: true });
    const main = await captureBackend(client,
      base.toString() + "?a8e_vbxe=fx1.26&a8e_worker=0", false);
    const worker = await captureBackend(client,
      base.toString() + "?a8e_vbxe=fx1.26&a8e_worker=1", true);
    const main2d = await captureBackend(client,
      base.toString() + "?a8e_vbxe=fx1.26&a8e_worker=0&a8e_renderer=2d", false);
    const worker2d = await captureBackend(client,
      base.toString() + "?a8e_vbxe=fx1.26&a8e_worker=1&a8e_renderer=2d", true);
    assert.equal(main.worker, false, "main-thread backend was not selected");
    assert.equal(worker.worker, true, "worker backend was not selected");
    assert.equal(main.width, worker.width, "backend screenshot widths differ");
    assert.equal(main.height, worker.height, "backend screenshot heights differ");
    assert.ok(main.bytes > 100, "main-thread screenshot is empty");
    assert.ok(worker.bytes > 100, "worker screenshot is empty");
    assert.equal(main.hash, worker.hash, "worker/fallback screenshots differ");
    assert.equal(main2d.rendererBackend, "2d", "main-thread Canvas2D backend was not selected");
    assert.equal(worker2d.rendererBackend, "2d", "worker Canvas2D backend was not selected");
    assert.equal(main2d.width, worker2d.width, "Canvas2D screenshot widths differ");
    assert.equal(main2d.height, worker2d.height, "Canvas2D screenshot heights differ");
    assert.ok(main2d.bytes > 100 && worker2d.bytes > 100, "Canvas2D screenshot is empty");
    assert.equal(main2d.hash, worker2d.hash, "Canvas2D worker/fallback screenshots differ");
    assertGolden("main", main);
    assertGolden("worker", worker);
    assertGolden("main2d", main2d);
    assertGolden("worker2d", worker2d);
    compareExternalReference({ main, worker, main2d, worker2d });
    console.log("vbxe_browser_backend: worker/fallback VBXE capture matched");
    console.log(JSON.stringify({ main, worker, main2d, worker2d }));
  } finally {
    try { await client.command("Page.navigate", { url: originalUrl }); } catch { /* page may have closed */ }
    client.close();
  }
})().catch(error => {
  console.error("vbxe_browser_backend: " + error.message);
  process.exitCode = 1;
});
