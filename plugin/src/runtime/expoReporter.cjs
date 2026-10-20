const {createRequire} = require('node:module');
const {dirname, join} = require('node:path');

// Filter structured client_log events before Expo flattens them to terminal text.
// Application console methods and LogBox keep their original behavior.
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
