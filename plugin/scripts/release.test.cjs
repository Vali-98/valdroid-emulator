// SPDX-License-Identifier: AGPL-3.0-only
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { release } = require('./release.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'valdroid-release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'repo'); fs.mkdirSync(cwd);
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '--initial-branch=main']);
  git(['config', 'user.name', 'Release Test']);
  git(['config', 'user.email', 'release@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'tag.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);
  const manifest = { name: 'release-test', version: '1.2.3' };
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(cwd, 'package-lock.json'), JSON.stringify({ ...manifest,
    lockfileVersion: 3, requires: true, packages: { '': manifest } }, null, 2) + '\n');
  git(['add', '.']); git(['commit', '-m', 'Initial']);
  return { root, cwd, git, read: file => JSON.parse(fs.readFileSync(path.join(cwd, file), 'utf8')) };
}

for (const [bump, version] of [['patch', '1.2.4'], ['minor', '1.3.0'], ['major', '2.0.0']]) {
  test(`${bump} updates both version files, commits and tags, and does not push when declined`, async t => {
    const f = fixture(t);
    const result = await release(bump, { cwd: f.cwd, confirmPush: async (branch, tag) => {
      assert.equal(branch, 'main'); assert.equal(tag, `v${version}`); return false;
    } });
    assert.deepEqual(result, { version, tag: `v${version}`, pushed: false });
    assert.equal(f.read('package.json').version, version);
    assert.equal(f.read('package-lock.json').version, version);
    assert.equal(f.read('package-lock.json').packages[''].version, version);
    assert.equal(f.git(['status', '--porcelain']), '');
    assert.equal(f.git(['log', '-1', '--format=%s']), `Release v${version}`);
    assert.equal(f.git(['rev-parse', `v${version}^{commit}`]), f.git(['rev-parse', 'HEAD']));
    assert.equal(f.git(['cat-file', '-t', `v${version}`]), 'tag');
  });
}

test('rejects invalid bumps, dirty trees, detached HEAD and duplicate tags without changing the version', async t => {
  const f = fixture(t);
  const options = { cwd: f.cwd, confirmPush: async () => assert.fail('Must not prompt') };
  await assert.rejects(release('invalid', options), /Usage/);
  fs.writeFileSync(path.join(f.cwd, 'uncommitted.txt'), 'Keep me');
  await assert.rejects(release('patch', options), /Commit or stash/);
  fs.unlinkSync(path.join(f.cwd, 'uncommitted.txt'));
  f.git(['checkout', '--detach']);
  await assert.rejects(release('patch', options));
  f.git(['checkout', 'main']);
  f.git(['tag', 'v1.2.4']);
  await assert.rejects(release('patch', options), /already exists/);
  assert.equal(f.read('package.json').version, '1.2.3');
  assert.equal(f.read('package-lock.json').version, '1.2.3');
  assert.equal(f.git(['status', '--porcelain']), '');
  assert.equal(f.git(['rev-list', '--count', 'HEAD']), '1');
});

test('pushes the release branch and tag only after confirmation', async t => {
  const f = fixture(t);
  const remote = path.join(f.root, 'remote.git');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'pipe' });
  f.git(['remote', 'add', 'origin', remote]);
  f.git(['tag', '-a', 'unrelated', '-m', 'Keep local']);
  f.git(['config', 'push.followTags', 'true']);
  await release('patch', { cwd: f.cwd, confirmPush: async () => {
    assert.equal(f.git(['ls-remote', 'origin']), ''); return true;
  } });
  assert.equal(f.git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s/)[0], f.git(['rev-parse', 'HEAD']));
  assert.equal(f.git(['ls-remote', 'origin', 'refs/tags/v1.2.4^{}']).split(/\s/)[0], f.git(['rev-parse', 'HEAD']));
  assert.equal(f.git(['ls-remote', 'origin', 'refs/tags/unrelated']), '');
});
