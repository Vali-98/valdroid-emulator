// SPDX-License-Identifier: AGPL-3.0-only
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');

async function promptPush(branch, tag) {
  if (!process.stdin.isTTY) return false;
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await prompt.question(`Push ${branch} and ${tag} to origin and start release CI? [y/N] `)).trim());
  } finally { prompt.close(); }
}

async function release(bump, { cwd = path.resolve(__dirname, '..'), confirmPush = promptPush,
  npmCLI = process.env.npm_execpath } = {}) {
  if (!['patch', 'minor', 'major'].includes(bump)) throw new Error('Usage: npm run release patch|minor|major');
  if (!npmCLI) throw new Error('Run this script with npm run release.');
  const git = (args, options = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', ...options });
  if (git(['status', '--porcelain']).trim()) throw new Error('Commit or stash your changes before releasing.');
  const branch = git(['symbolic-ref', '--short', 'HEAD']).trim();
  git(['var', 'GIT_AUTHOR_IDENT']);
  git(['var', 'GIT_COMMITTER_IDENT']);

  const files = ['package.json', 'package-lock.json'];
  const originals = files.map(file => fs.readFileSync(path.join(cwd, file)));
  let version, tag;
  try {
    execFileSync(process.execPath, [npmCLI, '--prefix', cwd, '--offline', 'version', bump,
      '--no-git-tag-version', '--ignore-scripts'], { cwd, stdio: 'pipe' });
    version = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).version;
    tag = `v${version}`;
    if (git(['tag', '--list', tag]).trim()) throw new Error(`Tag ${tag} already exists.`);
  } catch (error) {
    files.forEach((file, index) => fs.writeFileSync(path.join(cwd, file), originals[index]));
    throw error;
  }

  git(['add', '--', ...files]);
  git(['commit', '-m', `Release ${tag}`, '--', ...files], { stdio: 'inherit' });
  git(['tag', '-a', tag, '-m', `Release ${tag}`]);
  console.log(`Created release commit and tag ${tag}.`);

  const pushed = await confirmPush(branch, tag);
  if (pushed) {
    git(['push', '--atomic', '--no-follow-tags', 'origin', `HEAD:refs/heads/${branch}`, `refs/tags/${tag}`], { stdio: 'inherit' });
  } else {
    console.log(`Kept locally. Push later: git push --atomic origin HEAD:refs/heads/${branch} refs/tags/${tag}`);
  }
  return { version, tag, pushed };
}

module.exports = { release };
if (require.main === module) {
  if (process.argv.length !== 3) {
    console.error('Usage: npm run release patch|minor|major'); process.exitCode = 1;
  } else {
    release(process.argv[2]).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
