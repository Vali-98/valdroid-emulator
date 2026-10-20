const {installMetroIntegration} = require('./metroIntegration.cjs');
const {isMainThread} = require('node:worker_threads');
if (isMainThread && process.env.VALDROID_METRO_SESSION && (!process.env.VALDROID_METRO_PID || process.env.VALDROID_METRO_PID === String(process.pid))) {
  process.env.VALDROID_METRO_PID = String(process.pid);
  // Fail loudly rather than silently launching an app without the requested tools.
  installMetroIntegration(process.env.VALDROID_METRO_SESSION, process.argv[1]);
}
