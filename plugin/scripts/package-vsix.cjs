// SPDX-License-Identifier: AGPL-3.0-only
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseArgs } = require('node:util');

const plugin = path.resolve(__dirname, '..');
const repository = path.resolve(plugin, '..');
const targets = ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-x64'];
const abis = ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'];

function selectTargets(target, universal = false) {
  if (universal && target) throw new Error('Use either --universal or --target, not both.');
  if (universal) return targets;
  target ??= `${process.platform}-${process.arch}`;
  if (!targets.includes(target)) throw new Error(`Unsupported target ${target}. Supported targets: ${targets.join(', ')}`);
  return [target];
}

function validateBundle(target, bundle) {
  if (!targets.includes(target)) throw new Error(`Select an explicit supported --target: ${targets.join(', ')}`);
  const required = [
    target.startsWith('win32-') ? 'control-server.exe' : 'control-server',
    'screen-sharing-agent.jar',
    ...abis.map(abi => `agent-libs/${abi}/libscreen-sharing-agent.so`),
  ];
  for (const name of required) {
    const filename = path.join(bundle, name);
    if (!fs.existsSync(filename) || !fs.statSync(filename).isFile() || fs.statSync(filename).size === 0) {
      throw new Error(`Missing or empty ${filename}; build the native server and Android agent first.`);
    }
  }
}

function validateServerBuild(target, build, commit, development) {
  const [platform, arch] = target.split('-');
  const goOS = platform === 'win32' ? 'windows' : platform;
  const goArch = arch === 'x64' ? 'amd64' : arch;
  const settings = new Set(build.split(/\r?\n/).map(line => line.trim().replace(/^build\s+/, '')));
  for (const setting of [`GOOS=${goOS}`, `GOARCH=${goArch}`]) {
    if (!settings.has(setting)) throw new Error(`Server must be built with ${setting}.`);
  }
  if (!development && (!settings.has(`vcs.revision=${commit}`) || !settings.has('vcs.modified=false'))) {
    throw new Error('Rebuild the native server from this clean commit before release packaging.');
  }
}

async function main() {
  const { values } = parseArgs({ options: {
    target: { type: 'string' }, universal: { type: 'boolean', default: false },
    release: { type: 'boolean', default: false }, out: { type: 'string' },
  } });
  const selected = selectTargets(values.target, values.universal);
  const target = values.universal ? undefined : selected[0];
  const development = !values.release;
  for (const platform of selected) validateBundle(platform, path.join(plugin, 'bundle', platform));
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
  if (git(['status', '--porcelain']) && !development) {
    throw new Error('Release packaging requires a clean Git tree. Commit changes, or omit --release for a local-only test package.');
  }
  const commit = git(['rev-parse', 'HEAD']);
  for (const platform of selected) {
    const executable = platform.startsWith('win32-') ? 'control-server.exe' : 'control-server';
    const build = execFileSync('go', ['version', '-m', path.join(plugin, 'bundle', platform, executable)], { encoding: 'utf8' });
    validateServerBuild(platform, build, commit, development);
  }
  if (!process.env.npm_execpath) throw new Error('Run with npm run vsix.');
  execFileSync(process.execPath, [process.env.npm_execpath, 'run', 'build', '--', '--production'], { cwd: plugin, stdio: 'inherit' });
  const manifest = JSON.parse(fs.readFileSync(path.join(plugin, 'package.json'), 'utf8'));
  if (manifest.license !== 'AGPL-3.0-only') throw new Error('Expected AGPL-3.0-only in package.json.');
  const output = path.resolve(values.out || path.join(plugin, 'releases',
    `${manifest.name}-${manifest.version}-${values.universal ? 'universal' : target}${development ? '-dev' : ''}.vsix`));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'valdroid-vsix-'));
  try {
    for (const name of ['README.md', 'CHANGELOG.md', 'media', 'dist/extension.js',
      'dist/webview.js', 'dist/webview.css', 'dist/console.js', 'dist/console.css',
      'dist/THIRD_PARTY_NOTICES.txt', 'dist/react-scan-runtime.js', 'dist/expo-reporter.cjs',
      'dist/metroIntegration.cjs', 'dist/metroPreload.cjs']) {
      fs.mkdirSync(path.dirname(path.join(stage, name)), { recursive: true });
      fs.cpSync(path.join(plugin, name), path.join(stage, name), { recursive: true });
    }
    for (const platform of selected) {
      const bundle = path.join(stage, 'bundle', platform);
      fs.cpSync(path.join(plugin, 'bundle', platform), bundle, { recursive: true });
      if (!platform.startsWith('win32-')) fs.chmodSync(path.join(bundle, 'control-server'), 0o755);
    }
    for (const name of ['LICENSE', 'NOTICE', 'licenses']) {
      fs.cpSync(path.join(repository, name), path.join(stage, name), { recursive: true });
    }
    fs.copyFileSync(path.join(repository, 'control-server/third_party/screen_sharing_service/LICENSE.txt'),
      path.join(stage, 'licenses/android-screen-sharing-agent.txt'));
    const source = `https://github.com/Vali-98/valdroid-emulator/tree/${commit}`;
    fs.writeFileSync(path.join(stage, 'SOURCE.md'), development
      ? '# Development Build\n\nLocal test package. Do not redistribute: bundled artifacts may not match committed source.\n'
      : `# Corresponding Source\n\nVersion: ${manifest.version}\nCommit: ${commit}\n\n[Browse source](${source})\n\nThe included valdroid-source.tar.gz contains this release's repository, including build scripts and dependency lockfiles.\n`);
    if (!development) {
      execFileSync('git', ['archive', '--format=tar.gz', `--output=${path.join(stage, 'valdroid-source.tar.gz')}`, 'HEAD'], { cwd: repository });
    }
    delete manifest.scripts;
    delete manifest.devDependencies;
    fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(stage, '.vscodeignore'), '**/*.map\n');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    const { createVSIX } = require('@vscode/vsce');
    await createVSIX({ cwd: stage, packagePath: output, target, dependencies: false,
      baseContentUrl: `https://github.com/Vali-98/valdroid-emulator/blob/${commit}/plugin/`,
      baseImagesUrl: `https://raw.githubusercontent.com/Vali-98/valdroid-emulator/${commit}/plugin/` });
    console.log(`Created ${output}${development ? ' (local testing only)' : ''}`);
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { targets, abis, selectTargets, validateBundle, validateServerBuild };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
