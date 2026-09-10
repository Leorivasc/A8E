"use strict";

// Collect diagnostics from an already-running jsA8E Chrome tab via CDP.
// Usage: node jsA8E/tests/cdp_diagnostic.js

async function main() {
  const pages = await (await fetch("http://127.0.0.1:9222/json/list")).json();
  const page = pages.find(function (entry) {
    return entry.type === "page" && entry.url.indexOf("/jsA8E/") >= 0;
  });
  if (!page) throw new Error("jsA8E page not found on CDP port 9222");

  const socket = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = function (event) {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (!resolve) return;
    pending.delete(message.id);
    resolve(message);
  };
  await new Promise(function (resolve, reject) {
    socket.onopen = resolve;
    socket.onerror = reject;
  });

  function call(method, params) {
    return new Promise(function (resolve, reject) {
      const id = ++nextId;
      pending.set(id, function (message) {
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message);
      });
      socket.send(JSON.stringify({ id: id, method: method, params: params }));
    });
  }

  const resume = process.argv.indexOf("--resume") >= 0;
  const keys = process.argv.indexOf("--keys") >= 0;
  const scan = process.argv.indexOf("--scan") >= 0;
  const probe = process.argv.indexOf("--probe") >= 0;
  const stateKeys = process.argv.indexOf("--state-keys") >= 0;
  const forceReload = process.argv.indexOf("--force-reload") >= 0;
  const nmiDisasm = process.argv.indexOf("--nmi-disasm") >= 0;
  const animalPrepare = process.argv.indexOf("--animal-prepare") >= 0;
  const animalButton = process.argv.indexOf("--animal-button") >= 0;
  const animalRun = process.argv.indexOf("--animal-run") >= 0;
  const animalInspect = process.argv.indexOf("--animal-inspect") >= 0;
  if (forceReload) {
    await call("Network.setCacheDisabled", { cacheDisabled: true });
    await call("Page.reload", { ignoreCache: true });
    await new Promise(function (resolve) { setTimeout(resolve, 1500); });
  }
  let expression;
  if (animalInspect) {
    expression =
      "(async()=>{const s=await A8EAutomation.getDebugState();return {state:s,range:await A8EAutomation.readRange(0x9050,0x80,{format:'hex'}),dcb:await A8EAutomation.readRange(0x0300,0x20,{format:'hex'}),disassembly:await A8EAutomation.debug.disassemble({pc:s.pc,beforeInstructions:12,afterInstructions:30}),trace:await A8EAutomation.getTraceTail(100)};})()";
  } else if (animalRun) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.mountDiskFromUrl('/ATR/Animal%20Party.atr',{slot:0,name:'Animal Party.atr'});" +
      "await A8EAutomation.reset();" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "await A8EAutomation.start();" +
      "await new Promise(r=>setTimeout(r,12000));" +
      "const before=await A8EAutomation.getDebugState();" +
      "await A8EAutomation.setJoystick({trigger:true});" +
      "await new Promise(r=>setTimeout(r,120));" +
      "await A8EAutomation.setJoystick({trigger:false});" +
      "const samples=[];for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,500));samples.push(await A8EAutomation.getDebugState());}" +
      "return {before:before,samples:samples,media:await A8EAutomation.getMountedMedia(),trace:await A8EAutomation.getTraceTail(320)};" +
      "})()";
  } else if (animalPrepare) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.mountDiskFromUrl('/ATR/Animal%20Party.atr',{slot:0,name:'Animal Party.atr'});" +
      "await A8EAutomation.setBreakpoints([]);" +
      "await A8EAutomation.reset();" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "await A8EAutomation.start();" +
      "await new Promise(r=>setTimeout(r,12000));" +
      "return {state:await A8EAutomation.getDebugState(),media:await A8EAutomation.getMountedMedia(),sioTurbo:await A8EAutomation.getApp().getSioTurbo(),trace:await A8EAutomation.getTraceTail(160)};" +
      "})()";
  } else if (animalButton) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "const before=await A8EAutomation.getDebugState();" +
      "await A8EAutomation.setJoystick({trigger:true});" +
      "await new Promise(r=>setTimeout(r,120));" +
      "await A8EAutomation.setJoystick({trigger:false});" +
      "const samples=[];for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,500));samples.push(await A8EAutomation.getDebugState());}" +
      "return {before:before,samples:samples,trace:await A8EAutomation.getTraceTail(320)};" +
      "})()";
  } else if (keys) {
    expression = "(async()=>({root:Object.keys(A8EAutomation).sort(),debug:Object.keys(A8EAutomation.debug||{}).sort(),app:Object.keys(await A8EAutomation.getApp()).sort()}))()";
  } else if (scan) {
    expression =
      "(async()=>{" +
      "const bytes=Array.from(await A8EAutomation.debug.readRange(0,0x10000));" +
      "const patterns={sta:[0x8d,0x21,0x61],inc:[0xee,0x21,0x61],dec:[0xce,0x21,0x61],lda:[0xad,0x21,0x61]};" +
      "const matches={};" +
      "for(const [name,pattern] of Object.entries(patterns)){matches[name]=[];for(let i=0;i<=bytes.length-pattern.length;i++){if(pattern.every((v,j)=>bytes[i+j]===v))matches[name].push(i);}}" +
      "return {head:bytes.slice(0x3bf9,0x3c20),matches:matches};" +
      "})()";
  } else if (stateKeys) {
    expression =
      "(async()=>{const a=await A8EAutomation.getApp().getDebugStateAsync();const b=await A8EAutomation.getDebugState();const m={};for(const address of [0x6121,0x6122,0x00d8,0x619b,0xd40e,0xd40f,0xd40b])m[address.toString(16)]=await A8EAutomation.peek(address);return {app:Object.keys(a||{}),root:Object.keys(b||{}),state:a,nmi:a&&a.nmiDiagnostics||null,memory:m};})()";
  } else if (probe) {
    expression =
      "(async()=>{" +
      "const addresses=[0x3bf5,0x3bf9,0x3bfc,0x3bff,0x3c01,0x3c05,0x3c08,0x6121,0x619b];" +
      "const values={};for(const address of addresses)values[address.toString(16)]=await A8EAutomation.debug.readMemory(address);" +
      "values.rootRange=await A8EAutomation.readRange(0x3bf5,0x20,{format:'hex'});" +
      "return values;" +
      "})()";
  } else if (nmiDisasm) {
    expression =
      "(async()=>{const addresses=[0xc018,0x3473,0x3506,0x5d35,0x3bf9];const out={};for(const pc of addresses)out[pc.toString(16)]=await A8EAutomation.debug.disassemble({pc:pc,beforeInstructions:4,afterInstructions:24});return {state:await A8EAutomation.getDebugState(),disassembly:out,trace:await A8EAutomation.getTraceTail(256)};})()";
  } else {
    expression =
      "(async()=>{" +
      (resume ? "await A8EAutomation.start();await new Promise(r=>setTimeout(r,1000));" : "") +
      "const s=await A8EAutomation.getDebugState();" +
      "const t=await A8EAutomation.getTraceTail(120);" +
      "const b=await A8EAutomation.getBankState();" +
      "const io=await A8EAutomation.readRange(0xD000,0x100,{format:\"hex\"});" +
      "const d=await A8EAutomation.debug.disassemble({pc:s.pc,beforeInstructions:20,afterInstructions:40});" +
      "return {state:s,bank:b,io:io,disassembly:d,trace:t};" +
      "})()";
  }
  const result = await call("Runtime.evaluate", {
    expression: expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (!result.result || !result.result.result || result.result.result.value) {
    console.log(JSON.stringify(result.result.result.value, null, 2));
  } else {
    throw new Error(JSON.stringify(result.result));
  }
  socket.close();
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
