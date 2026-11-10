/* global __dirname, console, require, setTimeout, clearTimeout, module */

// Shared fixtures for the remote synchronization tests: an in-process
// WebDAV-like server (Basic auth, ETag, If-Match, If-None-Match, MKCOL) and
// independent in-memory libraries that stand for separate browsers.
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");

function loadContext() {
  const context = {
    console, setTimeout, clearTimeout, Promise, Uint8Array, ArrayBuffer, Date, Math, Object,
    String, Number, Boolean, TextEncoder, TextDecoder, Map, Set, Error, JSON, URL, btoa,
    Array, RegExp, Symbol, fetch,
  };
  context.window = context;
  context.self = context;
  context.globalThis = context;
  vm.createContext(context);
  [["core", "library_archive.js"], ["core", "library_package.js"], ["core", "atr_inspector.js"],
    ["core", "disk_library.js"], ["app", "remote_workspace.js"], ["app", "remote_library.js"]].forEach(function (parts) {
    vm.runInContext(
      fs.readFileSync(path.join(__dirname, "..", "js", parts[0], parts[1]), "utf8"),
      context, { filename: parts[1] });
  });
  return context;
}

function startServer(options) {
  const files = new Map();
  const dirs = new Set();
  const stats = { puts: 0, gets: 0 };
  let counter = 0;
  const server = http.createServer(function (req, res) {
    const name = decodeURIComponent(req.url.replace(/^\/dav\//, ""));
    const expected = "Basic " + Buffer.from("leo:secret").toString("base64");
    if (req.headers.authorization !== expected) { res.writeHead(401); res.end(); return; }
    const chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () {
      const body = Buffer.concat(chunks);
      const current = files.get(name);
      const headers = options && options.hideEtag ? {} : (current ? { ETag: current.etag } : {});
      if (req.method === "DELETE") {
        if (!current) { res.writeHead(404); res.end(); return; }
        files.delete(name); res.writeHead(204); res.end(); return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        stats.gets++;
        if (!current) { res.writeHead(404); res.end(); return; }
        headers["Last-Modified"] = new Date(current.modified).toUTCString();
        if (req.headers["if-none-match"] === current.etag) { res.writeHead(304, headers); res.end(); return; }
        res.writeHead(200, headers); res.end(req.method === "GET" ? current.body : undefined); return;
      }
      if (req.method === "MKCOL") {
        if (dirs.has(name)) { res.writeHead(405); res.end(); return; }
        dirs.add(name); res.writeHead(201); res.end(); return;
      }
      if (req.method === "PUT") {
        const slash = name.lastIndexOf("/");
        if (slash >= 0 && !dirs.has(name.substring(0, slash + 1))) { res.writeHead(409); res.end(); return; }
        stats.puts++;
        if (req.headers["if-match"] && (!current || req.headers["if-match"] !== current.etag)) {
          res.writeHead(412); res.end(); return;
        }
        if (req.headers["if-none-match"] === "*" && current) { res.writeHead(412); res.end(); return; }
        const etag = "\"" + (++counter) + "-" + crypto.createHash("md5").update(body).digest("hex") + "\"";
        files.set(name, { body: body, etag: etag, modified: Date.now() });
        res.writeHead(current ? 204 : 201, options && options.hideEtag ? {} : { ETag: etag });
        res.end(); return;
      }
      res.writeHead(405); res.end();
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, "127.0.0.1", function () {
      resolve({ server: server, files: files, dirs: dirs, stats: stats,
        url: "http://127.0.0.1:" + server.address().port + "/dav/" });
    });
  });
}

async function makeBrowser(context) {
  const mounted = new Map();
  let next = 0;
  const library = context.window.A8EDiskLibrary.createApi().create({
    mountDisk: function (bytes, name, slot) {
      const imageIndex = next++;
      mounted.set(slot, { imageIndex: imageIndex, bytes: new Uint8Array(bytes) });
      return { imageIndex: imageIndex, deviceSlot: slot };
    },
    unmountDisk: function (slot) { mounted.delete(slot); },
    getDiskImageBytes: function (imageIndex) {
      for (const item of mounted.values()) if (item.imageIndex === imageIndex) return item.bytes;
      return null;
    },
  });
  await library.init();
  await library.restoreMounts();
  return library;
}


module.exports = { loadContext, startServer, makeBrowser };
