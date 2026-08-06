import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertClusterAllowed, fromBaseUnits, loadTokenConfig, toBaseUnits } from '../src/config.js';
import { parseArgs } from '../src/cli.js';

test('toBaseUnits scales whole tokens by decimals', () => {
  assert.equal(toBaseUnits(1, 9), 1_000_000_000n);
  assert.equal(toBaseUnits(0, 9), 0n);
  assert.equal(toBaseUnits('0.5', 9), 500_000_000n);
  assert.equal(toBaseUnits(1.25, 2), 125n);
  assert.equal(toBaseUnits(42, 0), 42n);
});

test('toBaseUnits keeps precision past 2^53', () => {
  // 1e9 tokens at 9 decimals is 1e18 base units — float math would round this.
  assert.equal(toBaseUnits('1000000000', 9), 1_000_000_000_000_000_000n);
});

test('toBaseUnits rejects bad input', () => {
  assert.throws(() => toBaseUnits('abc', 9), /not a non-negative decimal/);
  assert.throws(() => toBaseUnits('-5', 9), /not a non-negative decimal/);
  assert.throws(() => toBaseUnits('0.123', 2), /more than 2 decimal places/);
});

test('fromBaseUnits is the inverse of toBaseUnits', () => {
  assert.equal(fromBaseUnits(1_000_000_000n, 9), '1');
  assert.equal(fromBaseUnits(500_000_000n, 9), '0.5');
  assert.equal(fromBaseUnits(0n, 9), '0');
  assert.equal(fromBaseUnits(42n, 0), '42');
  for (const amount of ['1', '0.5', '123.456', '1000000000']) {
    assert.equal(fromBaseUnits(toBaseUnits(amount, 9), 9), amount);
  }
});

test('mainnet writes are blocked without --confirm-mainnet', () => {
  assert.throws(() => assertClusterAllowed('mainnet-beta', {}), /--confirm-mainnet/);
  assert.doesNotThrow(() => assertClusterAllowed('mainnet-beta', { confirmMainnet: true }));
  assert.doesNotThrow(() => assertClusterAllowed('devnet', {}));
});

test('parseArgs handles value flags, booleans, and =syntax', () => {
  const argv = parseArgs(['--cluster', 'testnet', '--amount', '10', '--dry-run', '--to=Abc123']);
  assert.equal(argv.cluster, 'testnet');
  assert.equal(argv.amount, '10');
  assert.equal(argv.dryRun, true);
  assert.equal(argv.to, 'Abc123');
});

test('parseArgs camel-cases multi-word flags', () => {
  const argv = parseArgs(['--confirm-mainnet', '--mint-authority', '--mint-keypair', '/tmp/k.json']);
  assert.equal(argv.confirmMainnet, true);
  assert.equal(argv.mintAuthority, true);
  assert.equal(argv.mintKeypair, '/tmp/k.json');
});

test('parseArgs defaults to devnet and rejects unknown clusters', () => {
  assert.equal(parseArgs([]).cluster, 'devnet');
  assert.throws(() => parseArgs(['--cluster', 'mainnet']), /Unknown --cluster/);
  assert.throws(() => parseArgs(['--amount']), /--amount needs a value/);
  assert.throws(() => parseArgs(['create']), /Unexpected argument/);
});

test('the checked-in token.config.json is valid', () => {
  const config = loadTokenConfig();
  assert.equal(config.name, 'Unemployment Coin');
  assert.equal(config.symbol, 'UNEMP');
  assert.equal(config.decimals, 9);
});

test('loadTokenConfig rejects out-of-spec values', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unemp-'));
  const write = (config) => {
    const file = path.join(dir, `${Math.random()}.json`);
    fs.writeFileSync(file, JSON.stringify(config));
    return file;
  };
  const base = { name: 'Unemployment Coin', symbol: 'UNEMP', decimals: 9, initialSupply: 1, metadataUri: '' };

  assert.throws(() => loadTokenConfig(write({ ...base, symbol: 'WAYTOOLONGSYMBOL' })), /symbol/);
  assert.throws(() => loadTokenConfig(write({ ...base, name: 'x'.repeat(33) })), /name/);
  assert.throws(() => loadTokenConfig(write({ ...base, decimals: 12 })), /decimals/);
  assert.throws(() => loadTokenConfig(write({ ...base, initialSupply: -1 })), /initialSupply/);
  assert.throws(() => loadTokenConfig(write({ ...base, metadataUri: `https://x/${'y'.repeat(200)}` })), /200/);
  assert.doesNotThrow(() => loadTokenConfig(write(base)));

  fs.rmSync(dir, { recursive: true, force: true });
});
