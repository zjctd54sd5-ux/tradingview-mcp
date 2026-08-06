#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { CLUSTERS } from './config.js';
import { keygen } from './commands/keygen.js';
import { airdrop } from './commands/airdrop.js';
import { create } from './commands/create.js';
import { mint } from './commands/mint.js';
import { transfer } from './commands/transfer.js';
import { revoke } from './commands/revoke.js';
import { info } from './commands/info.js';
import { updateMetadata } from './commands/update-metadata.js';
import { launch } from './commands/launch.js';
import { buy, sell } from './commands/trade.js';
import { curveStatus } from './commands/curve.js';
import { claim } from './commands/claim.js';
import { owner } from './commands/owner.js';
import { preflight } from './commands/preflight.js';

const COMMANDS = {
  keygen: { run: keygen, help: 'Generate a local payer keypair' },
  airdrop: { run: airdrop, help: 'Request devnet/testnet SOL for the payer' },
  preflight: { run: preflight, help: 'Check everything is ready before a real launch' },
  launch: { run: launch, help: 'Launch on a bonding curve — mint + market in one go (tradeable)' },
  buy: { run: buy, help: 'Buy off the curve      (--amount <SOL>)' },
  sell: { run: sell, help: 'Sell into the curve    (--amount <tokens>)' },
  curve: { run: curveStatus, help: 'Curve price, SOL raised, progress to graduation' },
  claim: { run: claim, help: 'Sweep your accrued trading fees (creator + partner) to your wallet' },
  owner: { run: owner, help: 'Every role and authority on the launch, and whether you hold it' },
  create: { run: create, help: 'Create a plain SPL token instead (no market)' },
  mint: { run: mint, help: 'Mint additional supply  (--amount, --to)' },
  transfer: { run: transfer, help: 'Send tokens         (--amount, --to)' },
  revoke: { run: revoke, help: 'Drop authorities permanently (--mint-authority, --freeze-authority, --yes)' },
  'update-metadata': { run: updateMetadata, help: 'Push token.config.json name/symbol/uri onto the mint' },
  info: { run: info, help: 'Show mint, metadata, and balances' },
};

// Flags that take a value; everything else is boolean.
const VALUE_FLAGS = new Set([
  'cluster',
  'keypair',
  'mint',
  'mint-keypair',
  'amount',
  'to',
  'pool',
  'slippage-bps',
]);

function toCamel(flag) {
  return flag.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

export function parseArgs(args) {
  const argv = { cluster: process.env.UNEMP_CLUSTER || 'devnet' };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected argument "${arg}"`);

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s);
    if (VALUE_FLAGS.has(rawName)) {
      const value = inlineValue ?? args[++i];
      if (value === undefined) throw new Error(`--${rawName} needs a value`);
      argv[toCamel(rawName)] = value;
    } else {
      argv[toCamel(rawName)] = inlineValue === undefined ? true : inlineValue !== 'false';
    }
  }

  if (!(argv.cluster in CLUSTERS)) {
    throw new Error(`Unknown --cluster "${argv.cluster}". Expected one of: ${Object.keys(CLUSTERS).join(', ')}`);
  }
  return argv;
}

function usage() {
  const width = Math.max(...Object.keys(COMMANDS).map((k) => k.length));
  console.log('Unemployment Coin (UNEMP) — SPL token tooling\n');
  console.log('Usage: node src/cli.js <command> [options]\n');
  console.log('Commands:');
  for (const [name, { help }] of Object.entries(COMMANDS)) {
    console.log(`  ${name.padEnd(width)}  ${help}`);
  }
  console.log('\nCommon options:');
  console.log(`  --cluster <name>     ${Object.keys(CLUSTERS).join(' | ')}  (default: devnet)`);
  console.log('  --keypair <path>     Payer keypair file (default: .keys/<cluster>-payer.json)');
  console.log('  --mint <address>     Target mint (default: the one in deployments/<cluster>.json)');
  console.log('  --pool <address>     Target curve pool (default: the one in deployments/<cluster>.json)');
  console.log('  --slippage-bps <n>   Slippage tolerance for buy/sell (default: 100 = 1%)');
  console.log('  --dry-run            Print what would happen without sending a transaction');
  console.log('  --confirm-mainnet    Required for any write against mainnet-beta');
  console.log('\nEnvironment:');
  console.log('  UNEMP_RPC_URL        Override the RPC endpoint (recommended off devnet)');
  console.log('  UNEMP_SECRET_KEY     Payer secret key, base58 or JSON byte array');
  console.log('  UNEMP_CLUSTER        Default cluster');
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    usage();
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    console.error(`Unknown command "${name}"\n`);
    usage();
    process.exitCode = 1;
    return;
  }

  await command.run(parseArgs(rest));
}

// Only run when invoked directly, so tests can import parseArgs.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\nError: ${error.message}`);
    if (process.env.UNEMP_DEBUG) console.error(error);
    process.exitCode = 1;
  });
}
