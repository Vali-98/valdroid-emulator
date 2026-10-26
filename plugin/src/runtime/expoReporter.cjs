const {createRequire} = require('node:module');
const {dirname, join} = require('node:path');
const {isMainThread} = require('node:worker_threads');
function send(event) {
  if (process.connected && typeof process.send === 'function') {
    try {process.send(event, () => {});} catch { /* Never interrupt Metro when the extension disconnects. */ }
  }
}

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
    if (typeof Reporter?.prototype?.shouldFilterClientLog !== 'function' || typeof Reporter.prototype.update !== 'function') throw new Error('Reporter API unavailable');
    Reporter.prototype.shouldFilterClientLog = () => true;
    const update = Reporter.prototype.update;
    Reporter.prototype.update = function(event) {
      if (process.connected && typeof process.send === 'function') {
        if (event.type === 'bundling_error') {
          const error = event.error ?? {};
          const location = error.loc ?? error.cause?.loc ?? {};
          send({type: 'valdroid-bundle-error', message: String(error.message ?? error).slice(0, 12000),
            file: error.filename ?? error.fileName ?? error.originModulePath,
            line: error.lineNumber ?? location.line, column: error.column ?? location.column});
        } else if (event.type === 'bundle_build_done') {
          send({type: 'valdroid-bundle-ready'});
        }
      }
      return update.apply(this, arguments);
    };
    // Fast Refresh reports failures, but does not emit bundle_build_done on recovery.
    // Observe its successful update separately; older Metro versions can still recover via reload.
    try {
      const fromExpo = createRequire(join(root, 'package.json'));
      const metroRoot = dirname(fromExpo.resolve('metro/package.json'));
      const HmrServer = fromExpo(join(metroRoot, 'src/HmrServer.js')).default;
      const prepare = HmrServer.prototype._prepareMessage;
      if (typeof prepare === 'function') {
        HmrServer.prototype._prepareMessage = async function(...args) {
          const message = await prepare.apply(this, args);
          if (message?.type === 'update' && process.connected && typeof process.send === 'function') {
            send({type: 'valdroid-bundle-ready'});
          }
          return message;
        };
      }
    } catch { /* Full bundle success remains available on older Metro versions. */ }
  } catch {
    process.stderr.write('[Valdroid] This Expo version may also print JS logs in Metro. Structured values are available in JS Console.\n');
  }
}
