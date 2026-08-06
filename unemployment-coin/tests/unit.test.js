import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertClusterAllowed,
  fromBaseUnits,
  loadCurveConfig,
  loadTokenConfig,
  toBaseUnits,
  LP_OWNERSHIP_CHOICES,
  TOKEN_AUTHORITY_CHOICES,
} from '../src/config.js';
import { parseArgs } from '../src/cli.js';
import { spotPrice } from '../src/commands/curve.js';
import { toTokenDecimal, LP_OWNERSHIP, TOKEN_AUTHORITY } from '../src/dbc.js';

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

test('the checked-in curve.config.json is valid', () => {
  const curve = loadCurveConfig();
  assert.equal(curve.totalSupply, 1_000_000_000);
  assert.ok(curve.migrationMarketCapSol > curve.initialMarketCapSol);
});

test('loadCurveConfig rejects an unsellable curve', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unemp-curve-'));
  const write = (config) => {
    const file = path.join(dir, `${Math.random()}.json`);
    fs.writeFileSync(file, JSON.stringify(config));
    return file;
  };
  const base = {
    totalSupply: 1_000_000_000,
    initialMarketCapSol: 30,
    migrationMarketCapSol: 400,
    baseFeeBps: 100,
    creatorTradingFeePercentage: 50,
    dynamicFeeEnabled: true,
    firstBuySol: 0,
    tokenAuthority: 'update',
    lpOwnership: 'locked',
  };

  // A curve that does not rise would let the pool migrate at its start price.
  assert.throws(() => loadCurveConfig(write({ ...base, migrationMarketCapSol: 30 })), /must be greater than/);
  assert.throws(() => loadCurveConfig(write({ ...base, migrationMarketCapSol: 10 })), /must be greater than/);
  assert.throws(() => loadCurveConfig(write({ ...base, baseFeeBps: 10_000 })), /baseFeeBps/);
  assert.throws(() => loadCurveConfig(write({ ...base, creatorTradingFeePercentage: 101 })), /creatorTradingFee/);
  assert.throws(() => loadCurveConfig(write({ ...base, firstBuySol: -1 })), /firstBuySol/);
  assert.throws(() => loadCurveConfig(write({ ...base, totalSupply: 0 })), /totalSupply/);
  assert.doesNotThrow(() => loadCurveConfig(write(base)));

  // Options the chain rejects must not be offered by the config at all: the
  // program refuses mint authority outside transfer-hook configs, and requires
  // at least 10% of post-migration liquidity locked.
  assert.throws(() => loadCurveConfig(write({ ...base, tokenAuthority: 'update-and-mint' })), /tokenAuthority/);
  assert.throws(() => loadCurveConfig(write({ ...base, lpOwnership: 'claimable' })), /lpOwnership/);
  assert.doesNotThrow(() => loadCurveConfig(write({ ...base, lpOwnership: 'max-claimable' })));
  assert.doesNotThrow(() => loadCurveConfig(write({ ...base, tokenAuthority: 'immutable' })));

  fs.rmSync(dir, { recursive: true, force: true });
});

test('every ownership choice maps to real curve parameters', () => {
  for (const authority of TOKEN_AUTHORITY_CHOICES) {
    assert.ok(authority in TOKEN_AUTHORITY, `${authority} has no TokenAuthorityOption`);
  }
  for (const lp of LP_OWNERSHIP_CHOICES) {
    assert.ok(lp in LP_OWNERSHIP, `${lp} has no liquidity distribution`);
  }
  // The chain's floor: never offer a split that would be rejected at launch.
  for (const split of Object.values(LP_OWNERSHIP)) {
    assert.ok(
      split.creatorPermanentLockedLiquidityPercentage >= 10,
      'at least 10% of liquidity must stay locked'
    );
    assert.equal(
      split.creatorPermanentLockedLiquidityPercentage + split.creatorLiquidityPercentage,
      100
    );
  }
});

test('spotPrice decodes the Q64.64 square-root price', () => {
  // The sqrtPrice a 30 SOL starting market cap on 1e9 supply produces on chain;
  // squaring it must give back 30 / 1e9 = 3e-8 SOL per token.
  const price = spotPrice('3195071295335987', 9);
  assert.ok(Math.abs(price - 3e-8) < 1e-12, `expected ~3e-8, got ${price}`);
  assert.ok(Math.abs(price * 1e9 - 30) < 1e-3, 'market cap should round-trip to 30 SOL');
});

test('spotPrice scales with base decimals', () => {
  // Six-decimal tokens are worth 1000x more per whole token at the same sqrtPrice.
  assert.ok(Math.abs(spotPrice('3195071295335987', 6) / spotPrice('3195071295335987', 9) - 1e-3) < 1e-9);
});

test('a bonding-curve launch rejects decimals the program will not take', () => {
  assert.equal(toTokenDecimal(9), 9);
  assert.equal(toTokenDecimal(6), 6);
  assert.throws(() => toTokenDecimal(2), /6, 7, 8, or 9 decimals/);
  assert.throws(() => toTokenDecimal(18), /6, 7, 8, or 9 decimals/);
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
