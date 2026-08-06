import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const CLUSTERS = {
  devnet: 'https://api.devnet.solana.com',
  testnet: 'https://api.testnet.solana.com',
  'mainnet-beta': 'https://api.mainnet-beta.solana.com',
  localnet: 'http://127.0.0.1:8899',
};

/**
 * Resolve the RPC endpoint for a cluster name.
 * `UNEMP_RPC_URL` overrides the public endpoint, which is what you want for
 * anything beyond light devnet use — the public RPCs are heavily rate limited.
 */
export function resolveEndpoint(cluster) {
  if (!(cluster in CLUSTERS)) {
    throw new Error(`Unknown cluster "${cluster}". Expected one of: ${Object.keys(CLUSTERS).join(', ')}`);
  }
  return process.env.UNEMP_RPC_URL || CLUSTERS[cluster];
}

/**
 * Mainnet spends real SOL and creates a permanent, irreversible token. Every
 * write command has to be told twice before it will touch it.
 */
export function assertClusterAllowed(cluster, argv) {
  if (cluster !== 'mainnet-beta') return;
  if (argv.confirmMainnet) return;
  throw new Error(
    'Refusing to run against mainnet-beta without --confirm-mainnet.\n' +
      'This spends real SOL and the resulting token is permanent. Re-run with --confirm-mainnet if that is what you want.'
  );
}

export function loadTokenConfig(configPath = path.join(ROOT, 'token.config.json')) {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const errors = [];
  if (typeof raw.name !== 'string' || raw.name.length === 0 || raw.name.length > 32) {
    errors.push('name must be a non-empty string of at most 32 characters (Token Metadata limit)');
  }
  if (typeof raw.symbol !== 'string' || raw.symbol.length === 0 || raw.symbol.length > 10) {
    errors.push('symbol must be a non-empty string of at most 10 characters (Token Metadata limit)');
  }
  if (!Number.isInteger(raw.decimals) || raw.decimals < 0 || raw.decimals > 9) {
    errors.push('decimals must be an integer between 0 and 9');
  }
  if (typeof raw.initialSupply !== 'number' || raw.initialSupply < 0) {
    errors.push('initialSupply must be a non-negative number (in whole tokens, not base units)');
  }
  if (typeof raw.metadataUri !== 'string') {
    errors.push('metadataUri must be a string (may be empty)');
  }
  if (raw.metadataUri && raw.metadataUri.length > 200) {
    errors.push('metadataUri must be at most 200 characters (Token Metadata limit)');
  }
  if (errors.length) {
    throw new Error(`Invalid ${path.basename(configPath)}:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    name: raw.name,
    symbol: raw.symbol,
    decimals: raw.decimals,
    initialSupply: raw.initialSupply,
    metadataUri: raw.metadataUri,
    mutable: raw.mutable !== false,
  };
}

/**
 * Convert a whole-token amount to base units without going through float math,
 * which silently loses precision above 2^53 base units.
 */
export function toBaseUnits(amount, decimals) {
  const text = typeof amount === 'number' ? amount.toString() : String(amount).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error(`Amount "${amount}" is not a non-negative decimal number`);
  }
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) {
    throw new Error(`Amount "${amount}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

export function fromBaseUnits(baseUnits, decimals) {
  const value = BigInt(baseUnits);
  if (decimals === 0) return value.toString();
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Bonding-curve launch parameters. Separate from token.config.json because the
 * curve governs the *market*, while token.config.json governs the *token*.
 */
export function loadCurveConfig(configPath = path.join(ROOT, 'curve.config.json')) {
  const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const errors = [];
  const positive = (key) => {
    if (typeof raw[key] !== 'number' || !(raw[key] > 0)) errors.push(`${key} must be a positive number`);
  };
  positive('totalSupply');
  positive('initialMarketCapSol');
  positive('migrationMarketCapSol');

  if (raw.migrationMarketCapSol <= raw.initialMarketCapSol) {
    errors.push('migrationMarketCapSol must be greater than initialMarketCapSol — the curve has to rise');
  }
  if (!Number.isInteger(raw.baseFeeBps) || raw.baseFeeBps < 0 || raw.baseFeeBps > 9900) {
    errors.push('baseFeeBps must be an integer between 0 and 9900 (100 = 1%)');
  }
  if (
    !Number.isInteger(raw.creatorTradingFeePercentage) ||
    raw.creatorTradingFeePercentage < 0 ||
    raw.creatorTradingFeePercentage > 100
  ) {
    errors.push('creatorTradingFeePercentage must be an integer between 0 and 100');
  }
  if (typeof raw.firstBuySol !== 'number' || raw.firstBuySol < 0) {
    errors.push('firstBuySol must be a non-negative number');
  }
  if (!TOKEN_AUTHORITY_CHOICES.includes(raw.tokenAuthority)) {
    errors.push(`tokenAuthority must be one of: ${TOKEN_AUTHORITY_CHOICES.join(', ')}`);
  }
  if (!LP_OWNERSHIP_CHOICES.includes(raw.lpOwnership)) {
    errors.push(`lpOwnership must be one of: ${LP_OWNERSHIP_CHOICES.join(', ')}`);
  }
  if (errors.length) {
    throw new Error(`Invalid ${path.basename(configPath)}:\n  - ${errors.join('\n  - ')}`);
  }

  return {
    totalSupply: raw.totalSupply,
    initialMarketCapSol: raw.initialMarketCapSol,
    migrationMarketCapSol: raw.migrationMarketCapSol,
    baseFeeBps: raw.baseFeeBps,
    creatorTradingFeePercentage: raw.creatorTradingFeePercentage,
    dynamicFeeEnabled: raw.dynamicFeeEnabled !== false,
    firstBuySol: raw.firstBuySol,
    tokenAuthority: raw.tokenAuthority,
    lpOwnership: raw.lpOwnership,
  };
}

// Kept here rather than imported from dbc.js so config validation stays free of
// the Solana SDKs — the unit tests load this module on its own.
export const TOKEN_AUTHORITY_CHOICES = ['immutable', 'update'];
export const LP_OWNERSHIP_CHOICES = ['locked', 'max-claimable'];

const DEPLOYMENTS_DIR = path.join(ROOT, 'deployments');

export function deploymentPath(cluster) {
  return path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
}

export function saveDeployment(cluster, record) {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  fs.writeFileSync(deploymentPath(cluster), `${JSON.stringify(record, null, 2)}\n`);
}

export function loadDeployment(cluster) {
  const file = deploymentPath(cluster);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function explorerUrl(kind, value, cluster) {
  const suffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  return `https://explorer.solana.com/${kind}/${value}${suffix}`;
}
