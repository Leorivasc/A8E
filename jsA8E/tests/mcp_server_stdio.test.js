/* global __dirname, console, process, require, setTimeout, clearTimeout */

// Runs the real mcp_server.js over stdio against the real emulator and ROMs:
// standard handshake, ordered answers, a default buildAndRun (awaitEntry) of a
// program that never returns control, and the printer domain.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const serverPath = path.resolve(__dirname, '..', 'mcp_server.js');
const roms = ['ATARIXL.ROM', 'ATARIBAS.ROM'].map(function (name) { return path.resolve(__dirname, '..', name); });

if (!roms.every(function (file) { return fs.existsSync(file); })) {
  console.log('mcp_server_stdio.test.js skipped (Atari OS/BASIC ROMs are unavailable).');
  process.exit(0);
}

const servers = [];

function startServer() {
  const child = spawn(process.execPath, [serverPath, '--turbo', '--skip-rendering'], { stdio: ['pipe', 'pipe', 'inherit'] });
  servers.push(child);
  const received = [];
  let pending = '';
  let waiter = null;

  child.stdout.on('data', function (chunk) {
    pending += chunk;
    let index;
    while ((index = pending.indexOf('\n')) >= 0) {
      received.push(JSON.parse(pending.slice(0, index)));
      pending = pending.slice(index + 1);
    }
    if (waiter) waiter();
  });

  function send(message) {
    child.stdin.write(JSON.stringify(Object.assign({ jsonrpc: '2.0' }, message)) + '\n');
  }

  function waitForCount(count, timeoutMs) {
    return new Promise(function (resolve, reject) {
      const timer = setTimeout(function () {
        waiter = null;
        reject(new Error('timed out waiting for ' + count + ' replies, got ' + received.length));
      }, timeoutMs);
      function check() {
        if (received.length >= count) {
          clearTimeout(timer);
          waiter = null;
          resolve();
        }
      }
      waiter = check;
      check();
    });
  }

  function call(id, domain, action, args) {
    send({ id: id, method: 'tools/call', params: { name: 'call_automation', arguments: { domain: domain, action: action, args: args || {} } } });
  }

  return { child: child, received: received, send: send, waitForCount: waitForCount, call: call };
}

async function handshakeAndBuild() {
  const { child, received, send, waitForCount } = startServer();
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'ping' });
  send({
    id: 3,
    method: 'tools/call',
    params: {
      name: 'call_automation',
      arguments: { domain: 'dev', action: 'buildAndRun', args: { text: '.ORG $2000\nSTART:\n LDA #$44\n STA $0600\n JMP START\n .RUN START\n' } },
    },
  });
  // Sent while the build above is still running: must be answered after it.
  send({ id: 4, method: 'ping' });
  send({ id: 5, method: 'tools/call', params: { name: 'call_automation', arguments: { domain: 'debug', action: 'peek', args: { address: 0x0600 } } } });
  await waitForCount(5, 120000);

  assert.deepEqual(received.map(function (reply) { return reply.id; }), [1, 2, 3, 4, 5], 'answers keep request order and notifications get none');
  assert.deepEqual(received[1].result, {});

  const launch = received[2].result;
  assert.ok(!launch.isError, 'buildAndRun with the default awaitEntry returns without error');
  assert.equal(launch.structuredContent.result.phase, 'entry_breakpoint_hit');
  assert.equal(received[4].result.structuredContent.result, 0x44, 'the program ran after reaching its entry');
  child.stdin.end();
}

// A fresh machine: boot BASIC, LPRINT, read the paper, switch the model.
async function printerThroughMcp() {
  const { child, received, send, waitForCount, call } = startServer();
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  call(2, 'system', 'start');
  call(3, 'system', 'waitForCycles', { count: 8000000, timeoutMs: 60000 });
  call(4, 'input', 'typeText', { text: 'LPRINT "PRINTED VIA MCP"\n', interKeyDelayMs: 40 });
  call(5, 'system', 'waitForCycles', { count: 6000000, timeoutMs: 60000 });
  call(6, 'printer', 'getText');
  call(7, 'printer', 'setModel', { model: '820' });
  call(8, 'printer', 'getModel');
  call(9, 'printer', 'getLines');
  call(10, 'printer', 'clear');
  call(11, 'printer', 'getLineCount');
  call(12, 'printer', 'setModel', { model: 'bogus' });
  await waitForCount(12, 240000);

  const result = function (index) { return received[index].result.structuredContent.result; };
  assert.match(result(5), /^PRINTED VIA MCP$/m, 'LPRINT reached printer.getText');
  assert.equal(result(6), '820');
  assert.equal(result(7), '820');
  assert.equal(result(8)[0].text, 'PRINTED VIA MCP');
  assert.equal(result(9), true);
  assert.equal(result(10), 0);
  assert.equal(received[11].result.isError, true, 'an unknown model is an error result');
  child.stdin.end();
}

handshakeAndBuild().then(printerThroughMcp).then(function () {
  console.log('mcp_server_stdio.test.js passed');
}, function (err) {
  console.error(err && err.stack ? err.stack : err);
  servers.forEach(function (child) { child.kill(); });
  process.exitCode = 1;
});
