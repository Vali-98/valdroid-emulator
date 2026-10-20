const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {createRequire} = require('node:module');
const {spawnSync} = require('node:child_process');

async function hashAPK(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function resolveArtifact(directory, architecture) {
  const metadata = JSON.parse(await fs.readFile(path.join(directory, 'output-metadata.json'), 'utf8'));
  if (!/^[A-Za-z][\w]*(?:\.[A-Za-z][\w]*)+$/.test(metadata.applicationId ?? '') || metadata.variantName?.toLowerCase() !== 'debug' || !Array.isArray(metadata.elements)) {
    throw new Error('Android build metadata is missing a valid debug application ID/variant.');
  }
  const compatible = metadata.elements.filter(item => Array.isArray(item.filters) && item.filters.every(filter => filter.filterType === 'ABI' && filter.value === architecture));
  const universal = compatible.filter(item => !item.filters.length);
  const candidates = universal.length ? universal : compatible;
  if (candidates.length !== 1) throw new Error('Cannot identify one compatible standalone APK. Split APK sets and ambiguous outputs are not supported yet.');
  const name = candidates[0].outputFile;
  if (typeof name !== 'string' || path.basename(name) !== name || !name.endsWith('.apk')) throw new Error('Unsafe APK output path.');
  const file = await fs.realpath(path.join(directory, name));
  if (path.dirname(file) !== await fs.realpath(directory) || !(await fs.stat(file)).isFile()) throw new Error('APK output is outside its build directory.');
  return {file, applicationId: metadata.applicationId};
}

async function runPhase(phase, stateFile, root, cli, deviceName, serial, port) {
  const fromProject = createRequire(cli);
  const cliRoot = path.dirname(fromProject.resolve('@expo/cli/package.json'));
  const load = relative => fromProject(path.join(cliRoot, 'build/src', relative));
  const {setNodeEnv, loadEnvFiles} = load('utils/nodeEnv.js');
  setNodeEnv('development'); loadEnvFiles(root);
  const {resolveDeviceAsync} = load('run/android/resolveDevice.js');
  const device = await resolveDeviceAsync(deviceName);
  if (device.identifier !== serial) throw new Error(`Expo selected ${device.identifier}, expected ${serial}. Refusing to use another device.`);
  if (phase === 'build' || phase === 'clean-build') {
    const {ensureNativeProjectAsync} = load('run/ensureNativeProject.js');
    const {resolveGradlePropsAsync} = load('run/android/resolveGradlePropsAsync.js');
    const {resolveLaunchPropsAsync} = load('run/android/resolveLaunchProps.js');
    const {assembleAsync} = load('start/platforms/android/gradle.js');
    await ensureNativeProjectAsync(root, {platform: 'android', install: false});
    if (phase === 'clean-build') {
      const android = path.join(root, 'android');
      const result = spawnSync(process.platform === 'win32' ? 'gradlew.bat' : './gradlew', ['clean'], {cwd: android, stdio: 'inherit', shell: process.platform === 'win32'});
      if (result.error) throw result.error;
      if (result.status !== 0) throw new Error('Gradle clean failed.');
    }
    const props = await resolveGradlePropsAsync(root, {variant: 'debug'}, device.device);
    await assembleAsync(path.join(root, 'android'), {...props, variant: 'debug', port, buildCache: true});
    const artifact = await resolveArtifact(props.apkVariantDirectory, props.architectures);
    const launch = await resolveLaunchPropsAsync(root, {appId: artifact.applicationId});
    const sha256 = await hashAPK(artifact.file);
    const apkPath = path.join(path.dirname(stateFile), `artifact-${sha256}.apk`);
    await fs.copyFile(artifact.file, apkPath);
    if (await hashAPK(apkPath) !== sha256) throw new Error('APK changed while caching it. Build again.');
    const state = {root: await fs.realpath(root), serial, port, apkPath, sha256, applicationId: artifact.applicationId, launchActivity: launch.launchActivity, variant: 'debug'};
    await fs.writeFile(stateFile, JSON.stringify(state), {mode: 0o600});
    console.log(`[Valdroid] Built ${state.applicationId}; cached APK ${sha256.slice(0, 12)}.`);
    return;
  }
  if (phase !== 'launch') throw new Error(`Unknown lifecycle phase: ${phase}`);
  const state = JSON.parse(await fs.readFile(stateFile, 'utf8'));
  if (state.root !== await fs.realpath(root) || state.serial !== serial || state.port !== port) throw new Error('Launch artifact belongs to another session.');
  const {getSchemesForAndroidAsync} = load('utils/scheme.js');
  const {DevServerManager} = load('start/server/DevServerManager.js');
  // A headless representation attaches to our existing Metro; it doesn't start
  // or own a second server. Keep Expo's scheme/dev-client URL implementation.
  const manager = await DevServerManager.startMetroAsync(root, {port, headless: true, devClient: true, minify: false, location: {scheme: (await getSchemesForAndroidAsync(root))?.[0], hostType: 'localhost'}});
  const server = manager.getDefaultDevServer();
  try {
    await server.openCustomRuntimeAsync('emulator', {applicationId: state.applicationId, customAppId: state.applicationId, launchActivity: state.launchActivity}, {device: device.device});
  } finally {
    // Do not call manager.stopAsync(): that also manages the shared ADB server.
    await server.stopAsync();
    await manager.notifier?.stopObserving();
  }
}

module.exports = {hashAPK, resolveArtifact, runPhase};
if (require.main === module) {
  const [phase, stateFile, root, cli, deviceName, serial, port] = process.argv.slice(2);
  runPhase(phase, stateFile, root, cli, deviceName, serial, Number(port)).catch(error => {console.error(`[Valdroid] ${error.stack ?? error}`); process.exitCode = 1;});
}
