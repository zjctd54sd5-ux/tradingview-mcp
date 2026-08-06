import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import bs58 from 'bs58';
import { Keypair } from '@solana/web3.js';
import { ROOT } from './config.js';

export const KEYS_DIR = path.join(ROOT, '.keys');

export function defaultKeypairPath(cluster) {
  return path.join(KEYS_DIR, `${cluster}-payer.json`);
}

function expandHome(p) {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

function keypairFromSecretArray(bytes, source) {
  if (!Array.isArray(bytes) || (bytes.length !== 64 && bytes.length !== 32)) {
    throw new Error(`${source} is not a Solana keypair file (expected a JSON array of 32 or 64 bytes)`);
  }
  const secret = Uint8Array.from(bytes);
  return secret.length === 32 ? Keypair.fromSeed(secret) : Keypair.fromSecretKey(secret);
}

/**
 * Load the signing keypair, in priority order:
 *   1. --keypair <path>
 *   2. UNEMP_SECRET_KEY  (base58 secret key, or a JSON byte array)
 *   3. .keys/<cluster>-payer.json
 *   4. ~/.config/solana/id.json  (the Solana CLI default)
 */
export function loadKeypair({ cluster, keypairPath }) {
  if (keypairPath) return readKeypairFile(expandHome(keypairPath));

  const fromEnv = process.env.UNEMP_SECRET_KEY?.trim();
  if (fromEnv) {
    if (fromEnv.startsWith('[')) {
      return keypairFromSecretArray(JSON.parse(fromEnv), 'UNEMP_SECRET_KEY');
    }
    return Keypair.fromSecretKey(bs58.decode(fromEnv));
  }

  const local = defaultKeypairPath(cluster);
  if (fs.existsSync(local)) return readKeypairFile(local);

  const cliDefault = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (fs.existsSync(cliDefault)) return readKeypairFile(cliDefault);

  throw new Error(
    `No keypair found for ${cluster}.\n` +
      `Run "npm run keygen -- --cluster ${cluster}" to create one, or pass --keypair <path>, or set UNEMP_SECRET_KEY.`
  );
}

export function readKeypairFile(file) {
  if (!fs.existsSync(file)) throw new Error(`Keypair file not found: ${file}`);
  return keypairFromSecretArray(JSON.parse(fs.readFileSync(file, 'utf8')), file);
}

export function writeKeypairFile(file, keypair) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // 0o600: the secret key is the whole wallet, so keep it owner-readable only.
  fs.writeFileSync(file, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
