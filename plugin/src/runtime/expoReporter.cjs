const {createRequire} = require('node:module');
const {dirname, join} = require('node:path');
const {isMainThread} = require('node:worker_threads');

// Filter structured client_log events before Expo flattens them to terminal text.
// Application console methods and LogBox keep their original behavior.
// Metro forks workers with inherited execArgv (--require) and environment.
// Only the owning CLI process has a terminal reporter to patch.
if (isMainThread && (!process.env.VALDROID_METRO_PID || process.env.VALDROID_METRO_PID === String(process.pid))) {
  process.env.VALDROID_METRO_PID = String(process.pid);
  try {
    const fromProject = createRequire(process.argv[1]);
    const root = dirname(fromProject.resolve('@expo/cli/package.json'));
    const reporterModule = fromProject(join(root, 'build/src/start/server/metro/MetroTerminalReporter.js'));
    const Reporter = reporterModule.MetroTerminalReporter ?? reporterModule.default;
    if (typeof Reporter?.prototype?.shouldFilterClientLog !== 'function') throw new Error('Reporter API unavailable');
    Reporter.prototype.shouldFilterClientLog = () => true;
  } catch {
    process.stderr.write('[Valdroid] This Expo version may also print JS logs in Metro. Structured values are available in JS Console.\n');
  }
}
