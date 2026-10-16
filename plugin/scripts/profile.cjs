// Live playback and server resource profiling. Requires an active emulator.
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const base = process.argv[2] || 'http://127.0.0.1:38475';
const seconds = Number(process.argv[3] || 30);
const output = process.argv[4] || '/tmp/valdroid-avc-profile.json';
const serial = process.argv[5] || 'emulator-5554';
if (!Number.isFinite(seconds) || seconds<1 || seconds>300) throw new Error('Duration must be 1–300 seconds');
(async()=>{
 const adb = args => execFileSync('adb',['-s',serial,...args],{encoding:'utf8'});
 adb(['shell','am','start','-W','-n','com.android.chrome/com.google.android.apps.chrome.Main']);
 adb(['shell','am','start','-W','-a','android.settings.SETTINGS']);
 const browser=await chromium.launch({headless:true});
 try {
  const page=await browser.newPage({viewport:{width:1000,height:900}});
  await page.goto(`${base}/api/status`);await page.setContent('<div id="root"></div>');
  await page.addStyleTag({path:path.join(__dirname,'../dist/webview.css')});
  await page.evaluate(base=>{window.acquireVsCodeApi=()=>({postMessage(message){if(message.type==='ready')queueMicrotask(()=>window.dispatchEvent(new MessageEvent('message',{data:{type:'status',state:'online',status:'Profile',serverUrl:base,deviceName:'AVC profiling'}})));}});},base);
  await page.addScriptTag({path:path.join(__dirname,'../dist/webview.js')});
  for(let i=0;i<200;i++) {
   const state=await page.locator('.video-status').count()?await page.locator('.video-status').textContent():'Playing';
   if(i%20===0) console.error(state);
   if(/failed|disconnected|unavailable|cannot keep up|error|backlog|does not support/i.test(state)) throw new Error(`Direct AVC failed: ${state}`);
   if(await page.evaluate(()=>Boolean(document.querySelector('canvas')?.dataset.avcProfile))) break;
   await page.getByRole('button',{name:'Recent apps',exact:true}).click();await page.waitForTimeout(300);
  }
  const read=()=>page.evaluate(()=>JSON.parse(document.querySelector('canvas').dataset.avcProfile||'null'));
  const before=await read();if(!before)throw new Error('No direct AVC presentation');
  const resources=async()=>{const response=await fetch(`${base}/api/resources`);if(!response.ok)throw new Error(`Resources: ${response.status}`);return response.json();};
  const serverBefore=await resources();
  const samples=[];const foreground=[];const start=Date.now();
  while(Date.now()-start<seconds*1000){
   await page.getByRole('button',{name:'Recent apps',exact:true}).click();await page.waitForTimeout(100);
   await page.getByRole('button',{name:'Recent apps',exact:true}).click();await page.waitForTimeout(600);
   const state=await page.locator('.video-status').count()?await page.locator('.video-status').textContent():'Playing';
   if(/failed|disconnected|unavailable|cannot keep up|error|backlog|does not support/i.test(state))throw new Error(state);
   foreground.push(adb(['shell','dumpsys','activity','activities']).split('\n').filter(line=>line.includes('topResumedActivity')).join(' ').trim());
   samples.push({elapsedMs:Date.now()-start,...await read(),server:await resources()});
  }
  const after=await read(),elapsed=(Date.now()-start)/1000;
  const serverAfter=await resources();
  const cpuPercent=serverBefore.pid===serverAfter.pid && serverBefore.cpuTimeNs!==undefined && serverAfter.cpuTimeNs!==undefined && serverAfter.sampledAtMs>serverBefore.sampledAtMs && serverAfter.cpuTimeNs>=serverBefore.cpuTimeNs ? 100*(serverAfter.cpuTimeNs-serverBefore.cpuTimeNs)/((serverAfter.sampledAtMs-serverBefore.sampledAtMs)*1e6):null;
  const report={server:{cpuPercent,heapUsedBytes:serverAfter.heapAllocBytes,heapReservedBytes:serverAfter.heapReservedBytes},environment:'Playwright Chromium running actual React player; server and browser on same host',browserVersion:browser.version(),elapsed,presentedFps:(after.presented-before.presented)/elapsed,decodedFps:(after.decoded-before.decoded)/elapsed,replaced:after.replaced-before.replaced,final:after,verifiedApps:{chrome:foreground.filter(value=>value.includes('com.android.chrome')).length,settings:foreground.filter(value=>value.includes('com.android.settings')).length},foreground,samples};
  fs.writeFileSync(output,JSON.stringify(report,null,2));console.log(JSON.stringify({...report,samples:undefined,foreground:undefined}));
  if(report.verifiedApps.chrome<2 || report.verifiedApps.settings<2)throw new Error('App-switch workload invalid: both Chrome and Settings must appear repeatedly');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
