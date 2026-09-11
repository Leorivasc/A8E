"use strict";

const fs = require("fs");

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
  const animalPrepareShot = process.argv.indexOf("--animal-prepare-shot") >= 0;
  const animalPrebuffer = process.argv.indexOf("--animal-prebuffer") >= 0;
  const animalButton = process.argv.indexOf("--animal-button") >= 0;
  const animalRun = process.argv.indexOf("--animal-run") >= 0;
  const animalInspect = process.argv.indexOf("--animal-inspect") >= 0;
  const animalSio = process.argv.indexOf("--animal-sio") >= 0;
  if (forceReload) {
    await call("Network.setCacheDisabled", { cacheDisabled: true });
    await call("Page.reload", { ignoreCache: true });
    await new Promise(function (resolve) { setTimeout(resolve, 1500); });
  }
  let expression;
  if (animalSio) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.mountDiskFromUrl('/ATR/Animal%20Party.atr',{slot:0,name:'Animal Party.atr'});" +
      "await A8EAutomation.reset();" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "await A8EAutomation.start();" +
      "await new Promise(r=>setTimeout(r," + (animalPrepareShot ? "30000" : "12000") + "));" +
      "const before=await A8EAutomation.getApp().getDebugStateAsync();" +
      "await A8EAutomation.setJoystick({trigger:true});" +
      "await new Promise(r=>setTimeout(r,120));" +
      "await A8EAutomation.setJoystick({trigger:false});" +
      "const samples=[];for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,1000));const ss=await A8EAutomation.getApp().getDebugStateAsync();samples.push({pc:ss.pc,a:ss.a,cycleCounter:ss.cycleCounter,a527:await A8EAutomation.peek(0xA527),a52b:await A8EAutomation.peek(0xA52B),irqst:await A8EAutomation.peek(0xD20E)});}" +
      "const after=await A8EAutomation.getApp().getDebugStateAsync();" +
      "const addresses=[0xA527,0xA529,0xA52A,0xA52B,0xD00E,0xD010,0xD01F,0xD20D,0xD20E,0xD20F];" +
      "const values={};for(const address of addresses)values[address.toString(16)]=await A8EAutomation.peek(address);" +
      "const vectors={nmi:(await A8EAutomation.peek(0xfffa))|(await A8EAutomation.peek(0xfffb)<<8),reset:(await A8EAutomation.peek(0xfffc))|(await A8EAutomation.peek(0xfffd)<<8),irq:(await A8EAutomation.peek(0xfffe))|(await A8EAutomation.peek(0xffff)<<8)};" +
      "const sio=after.sioDiagnostics||{eventCount:0,events:[]};const recentSio=sio.events.filter(e=>e.type!=='serin_frame_end' || e.sequence>=sio.eventCount-12);const compactCode=d=>d&&d.instructions?d.instructions.map(i=>({address:i.address,text:i.text})):null;" +
      "return {before:{pc:before.pc,cycleCounter:before.cycleCounter},samples:samples,after:{pc:after.pc,a:after.a,x:after.x,y:after.y,cycleCounter:after.cycleCounter,running:after.running},values:values,vectors:vectors,code:compactCode(await A8EAutomation.debug.disassemble({pc:after.pc,beforeInstructions:8,afterInstructions:24})),loader:compactCode(await A8EAutomation.debug.disassemble({pc:0x9088,beforeInstructions:4,afterInstructions:28})),nmiCode:compactCode(await A8EAutomation.debug.disassemble({pc:vectors.nmi,beforeInstructions:4,afterInstructions:30})),irqCode:compactCode(await A8EAutomation.debug.disassemble({pc:vectors.irq,beforeInstructions:4,afterInstructions:30})),sio:{eventCount:sio.eventCount,events:recentSio},nmi:after.nmiDiagnostics};" +
      "})()";
  } else if (animalPrebuffer) {
    expression =
      "(async()=>{const s=await A8EAutomation.getApp().getDebugStateAsync();return {state:{pc:s.pc,a:s.a,x:s.x,y:s.y,cycleCounter:s.cycleCounter},dcb:await A8EAutomation.readRange(0x0300,0x40,{format:'hex'}),loader:await A8EAutomation.readRange(0x9040,0x90,{format:'hex'}),ram087e:await A8EAutomation.readRange(0x087e,0x84,{format:'hex'}),ram8100:await A8EAutomation.readRange(0x8100,0x100,{format:'hex'}),ram0700:await A8EAutomation.readRange(0x0700,0x100,{format:'hex'})};})()";
  } else if (animalInspect) {
    expression =
      "(async()=>{const s=await A8EAutomation.getDebugState();const addresses=[0xA527,0xA529,0xA52A,0xA52B,0xD010,0xD01F,0xD20E,0xD20F];const values={};for(const a of addresses)values[a.toString(16)]=await A8EAutomation.peek(a);const bytes=Array.from(await A8EAutomation.debug.readRange(0,0x10000));const patterns={lda:[0xAD,0x27,0xA5],sta:[0x8D,0x27,0xA5],inc:[0xEE,0x27,0xA5],dec:[0xCE,0x27,0xA5]};const matches={};for(const [name,p] of Object.entries(patterns)){matches[name]=[];for(let i=0;i<=bytes.length-p.length;i++)if(p.every((v,j)=>bytes[i+j]===v))matches[name].push(i);}return {state:s,values:values,matches:matches,range:await A8EAutomation.readRange(0x9040,0x90,{format:'hex'}),dcb:await A8EAutomation.readRange(0x0300,0x20,{format:'hex'}),loaded0881:await A8EAutomation.readRange(0x0881,0x80,{format:'hex'}),loaded8180:await A8EAutomation.readRange(0x8180,0x100,{format:'hex'}),disassembly:await A8EAutomation.debug.disassemble({pc:s.pc,beforeInstructions:12,afterInstructions:30}),exitDisassembly:await A8EAutomation.debug.disassemble({pc:0x904c,beforeInstructions:8,afterInstructions:35}),trace:await A8EAutomation.getTraceTail(100)};})()";
  } else if (animalRun) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.mountDiskFromUrl('/ATR/Animal%20Party.atr',{slot:0,name:'Animal Party.atr'});" +
      "await A8EAutomation.reset();" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "await A8EAutomation.start();" +
      "await new Promise(r=>setTimeout(r," + (animalPrepareShot ? "30000" : "12000") + "));" +
      "const before=await A8EAutomation.getApp().getDebugStateAsync();" +
      "await A8EAutomation.setJoystick({trigger:true});" +
      "await new Promise(r=>setTimeout(r,120));" +
      "await A8EAutomation.setJoystick({trigger:false});" +
      "const samples=[];for(let i=0;i<12;i++){await new Promise(r=>setTimeout(r,500));samples.push(await A8EAutomation.getDebugState());}" +
      "return {before:before,samples:samples,media:await A8EAutomation.getMountedMedia(),trace:await A8EAutomation.getTraceTail(320)};" +
      "})()";
  } else if (animalPrepare || animalPrepareShot) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.mountDiskFromUrl('/ATR/Animal%20Party.atr',{slot:0,name:'Animal Party.atr'});" +
      "await A8EAutomation.setBreakpoints([]);" +
      "await A8EAutomation.reset();" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "await A8EAutomation.start();" +
      "await new Promise(r=>setTimeout(r,12000));" +
      "return {state:await A8EAutomation.getDebugState(),media:await A8EAutomation.getMountedMedia(),sioTurbo:await A8EAutomation.getApp().getSioTurbo(),screenshot:" + (animalPrepareShot ? "await A8EAutomation.captureScreenshot({encoding:'base64'})," : "null,") + "trace:await A8EAutomation.getTraceTail(160)};" +
      "})()";
  } else if (animalButton) {
    expression =
      "(async()=>{" +
      "await A8EAutomation.getApp().setSioTurbo(false);" +
      "const before=await A8EAutomation.getDebugState();" +
      "await A8EAutomation.setJoystick({trigger:true});" +
      "await new Promise(r=>setTimeout(r,120));" +
      "await A8EAutomation.setJoystick({trigger:false});" +
      "const samples=[];for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,500));const ss=await A8EAutomation.getApp().getDebugStateAsync();samples.push({pc:ss.pc,a:ss.a,x:ss.x,y:ss.y,cycleCounter:ss.cycleCounter,a527:await A8EAutomation.peek(0xA527),a52b:await A8EAutomation.peek(0xA52B),irqst:await A8EAutomation.peek(0xD20E)});}" +
      "const finalState=await A8EAutomation.getApp().getDebugStateAsync();const sio=finalState.sioDiagnostics||{eventCount:0,events:[]};const events=sio.events.filter(e=>e.type==='command_frame'||e.type==='read_command'||e.type==='response_queued'||(e.type==='serin_frame_end'&&e.sequence>=sio.eventCount-12));return {before:{pc:before.pc,a:before.a,cycleCounter:before.cycleCounter,a527:await A8EAutomation.peek(0xA527),a52b:await A8EAutomation.peek(0xA52B),irqst:await A8EAutomation.peek(0xD20E)},samples:samples,postButton:{status02fc:await A8EAutomation.peek(0x02FC),dcb:await A8EAutomation.readRange(0x0300,0x10,{format:'hex'}),buffer0880:await A8EAutomation.readRange(0x0880,0x82,{format:'hex'})},sio:{eventCount:sio.eventCount,events:events},trace:await A8EAutomation.getTraceTail(40)};" +
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
      "const addresses=[0x0317,0x0300,0x0302,0x0303,0x030e,0x030f,0x3bf5,0x3bf9,0x3bfc,0x3bff,0x3c01,0x3c05,0x3c08,0x6121,0x619b];" +
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
    const value = result.result.result.value;
    if (animalPrepareShot && value && value.screenshot && value.screenshot.base64) {
      fs.writeFileSync("jsA8E/tests/animal-party-pre-button.png", Buffer.from(value.screenshot.base64, "base64"));
      value.screenshot = { width: value.screenshot.width, height: value.screenshot.height, file: "jsA8E/tests/animal-party-pre-button.png" };
    }
    console.log(JSON.stringify(value, null, 2));
  } else {
    throw new Error(JSON.stringify(result.result));
  }
  socket.close();
}

main().catch(function (error) {
  console.error(error.stack || error);
  process.exitCode = 1;
});
