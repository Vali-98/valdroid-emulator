const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { summarize } = require('./browser-perf.cjs');
const runner = path.join(__dirname, 'test-perf.cjs');

test('benchmark help does not build or touch a device', () => {
  const result = spawnSync(process.execPath, [runner, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0); assert.match(result.stdout, /--browser/); assert.equal(result.stderr, '');
});

test('invalid benchmark options fail before building', () => {
  for (const args of [['--fps', '0'], ['--transport', 'bad'], ['--browser'], ['--device', 'emulator-5554', '--replay', 'unused']]) {
    const result = spawnSync(process.execPath, [runner, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1); assert.doesNotMatch(result.stderr, /Building/);
  }
});

test('browser percentiles use nearest rank without modifying samples', () => {
  const values = [100, 10, 40];
  assert.deepEqual(summarize(values), { samples:3, meanMs:50, p50Ms:40, p95Ms:100, p99Ms:100, maxMs:100 });
  assert.deepEqual(values, [100, 10, 40]); assert.equal(summarize([]).samples, 0);
});
