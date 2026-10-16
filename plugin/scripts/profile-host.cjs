// macOS/Linux host sampler. CPU is ps's reported percentage, RSS is resident KiB.
// node scripts/profile-host.cjs [base URL] [seconds] [report.json]
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const run = promisify(execFile);
const base = process.argv[2] || 'http://127.0.0.1:38475';
const seconds = Number(process.argv[3] || 30);
const output = process.argv[4] || '/tmp/valdroid-host-profile.json';
if (!Number.isFinite(seconds) || seconds < 1 || seconds > 300) throw new Error('Duration must be 1–300 seconds');
(async () => {
 const samples = [];
 const start = Date.now();
 while (Date.now() - start < seconds * 1000) {
  const resources = await (await fetch(`${base}/api/resources`)).json();
  const { stdout } = await run('ps', ['-axo', 'pid=,pcpu=,rss=,comm=']);
  const processes = stdout.split('\n').flatMap(line => {
   const m = line.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
   if (!m) return [];
   const pid = Number(m[1]), command = m[4];
   const group = pid === resources.pid ? 'server' : /qemu-system/.test(command) ? 'emulator' : /chrome-headless-shell|chromium_headless_shell/.test(command) ? 'browser' : undefined;
   return group ? [{pid, group, cpuPercent:Number(m[2]), rssKiB:Number(m[3])}] : [];
  });
  samples.push({elapsedMs:Date.now()-start,resources,processes});
  fs.writeFileSync(output,JSON.stringify({note:'ps CPU is platform-reported, not per-stage CPU. Browser includes all headless Chromium processes on the host.',samples},null,2));
  await new Promise(resolve=>setTimeout(resolve,1000));
 }
 console.log(`Wrote ${samples.length} host samples to ${output}`);
})().catch(error=>{console.error(error);process.exitCode=1;});
