// SPDX-License-Identifier: AGPL-3.0-only
const fs = require('node:fs');
const path = require('node:path');

function packageRoot(filename) {
  let directory = path.dirname(path.resolve(filename));
  while (true) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest) && JSON.parse(fs.readFileSync(manifest, 'utf8')).name) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error(`Cannot locate package for ${filename}`);
    directory = parent;
  }
}

function dependencyNotices(metafiles) {
  const roots = new Set();
  for (const metafile of metafiles) {
    for (const filename of Object.keys(metafile.inputs)) {
      if (filename.replaceAll('\\', '/').includes('node_modules/')) roots.add(packageRoot(filename));
    }
  }
  const notices = [];
  for (const root of [...roots].sort()) {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const files = fs.readdirSync(root).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
    const texts = files.map(name => fs.readFileSync(path.join(root, name), 'utf8'));
    if (!texts.length && ['opus-decoder', '@wasm-audio-decoders/common'].includes(manifest.name)) {
      texts.push(fs.readFileSync(path.join(__dirname, '../../licenses/wasm-audio-decoders.txt'), 'utf8'));
    }
    if (!texts.length) throw new Error(`Missing license text for ${manifest.name}@${manifest.version}`);
    notices.push(`${manifest.name}@${manifest.version} (${manifest.license || 'see terms'})\n${texts.join('\n')}`);
  }
  return `Third-party JavaScript components bundled into Valdroid\n\n${notices.join('\n\n----------------------------------------\n\n')}\n`;
}

module.exports = { dependencyNotices };
