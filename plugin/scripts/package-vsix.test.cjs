// SPDX-License-Identifier: AGPL-3.0-only
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { abis, validateBundle, validateServerBuild } = require('./package-vsix.cjs');
const { dependencyNotices } = require('./third-party.cjs');

function fixture(t, target = 'darwin-arm64') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valdroid-package-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of [target.startsWith('win32') ? 'control-server.exe' : 'control-server',
    'screen-sharing-agent.jar', ...abis.map(abi => `agent-libs/${abi}/libscreen-sharing-agent.so`)]) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), 'fixture');
  }
  return root;
}

test('packaging always requires an explicit supported target', t => {
  const root = fixture(t);
  assert.throws(() => validateBundle(undefined, root), /explicit supported/);
  assert.throws(() => validateBundle('web', root), /explicit supported/);
  assert.doesNotThrow(() => validateBundle('darwin-arm64', root));
});

test('Windows bundles require the executable suffix', t => {
  assert.doesNotThrow(() => validateBundle('win32-x64', fixture(t, 'win32-x64')));
  assert.throws(() => validateBundle('win32-x64', fixture(t)), /control-server.exe/);
});

test('missing and empty Android libraries prevent packaging', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'agent-libs/x86/libscreen-sharing-agent.so'), '');
  assert.throws(() => validateBundle('darwin-arm64', root), /Missing or empty/);
  fs.rmSync(path.join(root, 'screen-sharing-agent.jar'));
  assert.throws(() => validateBundle('darwin-arm64', root), /screen-sharing-agent.jar/);
});

function buildInfo(os = 'darwin', arch = 'arm64') {
  return [`GOOS=${os}`, `GOARCH=${arch}`, 'CGO_ENABLED=1', 'vcs.revision=abc', 'vcs.modified=false']
    .map(setting => `\tbuild\t${setting}`).join('\r\n');
}

test('server targets map Node platform names to Go names', () => {
  assert.doesNotThrow(() => validateServerBuild('win32-x64', buildInfo('windows', 'amd64'), 'abc', false));
  assert.doesNotThrow(() => validateServerBuild('darwin-x64', buildInfo('darwin', 'amd64'), 'abc', false));
  assert.throws(() => validateServerBuild('linux-x64', buildInfo(), 'abc', true), /GOOS=linux/);
  assert.throws(() => validateServerBuild('darwin-x64', buildInfo(), 'abc', true), /GOARCH=amd64/);
});

test('pure Go server builds can be packaged', () => {
  assert.doesNotThrow(() => validateServerBuild('darwin-arm64', buildInfo().replace('CGO_ENABLED=1', 'CGO_ENABLED=0'), 'abc', true));
});

test('release servers must match the clean source commit', () => {
  assert.throws(() => validateServerBuild('darwin-arm64', buildInfo(), 'different', false), /Rebuild/);
  assert.throws(() => validateServerBuild('darwin-arm64', buildInfo().replace('modified=false', 'modified=true'), 'abc', false), /Rebuild/);
  assert.doesNotThrow(() => validateServerBuild('darwin-arm64', buildInfo(), 'different', true));
});

test('bundled dependency notices are deduplicated across webviews', () => {
  const input = { inputs: { 'node_modules/react/index.js': {}, 'src/extension.ts': {} } };
  const notices = dependencyNotices([input, input]);
  assert.equal(notices.match(/react@/g).length, 1);
  assert.match(notices, /Permission is hereby granted/);
});

test('the audio packages omitted license files have explicit notices', () => {
  const notices = dependencyNotices([{ inputs: { 'node_modules/opus-decoder/index.js': {} } }]);
  assert.match(notices, /Ethan Halsall/);
  assert.match(notices, /Permission is hereby granted/);
});

test('nested module-type package manifests do not hide the dependency license', t => {
  const root = path.join(fixture(t), 'node_modules/example');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'example', version: '1.0.0', license: 'MIT' }));
  fs.writeFileSync(path.join(root, 'dist/package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'LICENSE'), 'Example license');
  const notices = dependencyNotices([{ inputs: { [path.join(root, 'dist/index.js')]: {} } }]);
  assert.match(notices, /example@1.0.0/);
  assert.match(notices, /Example license/);
});
