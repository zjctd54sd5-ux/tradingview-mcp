import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { buildContext } from '../context.js';
import { loadCurveConfig, loadDeployment, loadTokenConfig, resolveEndpoint } from '../config.js';
import { buildLaunchCurve, lamportsToSol, toTokenDecimal } from '../dbc.js';
import { loadKeypair } from '../wallet.js';

const REQUIRED_SOL = 0.1;

/**
 * Check everything that has to be true before a real launch, so failures show
 * up here rather than halfway through an irreversible mainnet transaction.
 */
export async function preflight(argv) {
  const cluster = argv.cluster;
  const checks = [];
  const add = (ok, label, detail) => checks.push({ level: ok ? 'ok' : 'FAIL', label, detail });
  // Advice rather than a requirement: shown, but never blocks a launch.
  const warn = (label, detail) => checks.push({ level: 'warn', label, detail });

  let token = null;
  let curve = null;

  try {
    token = loadTokenConfig();
    add(true, 'token.config.json valid', `${token.name} (${token.symbol}), ${token.decimals} decimals`);
  } catch (error) {
    add(false, 'token.config.json valid', error.message.split('\n')[0]);
  }

  try {
    curve = loadCurveConfig();
    toTokenDecimal(token?.decimals ?? 9);
    add(true, 'curve.config.json valid', `${curve.initialMarketCapSol} -> ${curve.migrationMarketCapSol} SOL market cap`);
  } catch (error) {
    add(false, 'curve.config.json valid', error.message.split('\n')[0]);
  }

  if (token && curve) {
    const built = buildLaunchCurve(curve, toTokenDecimal(token.decimals));
    add(
      true,
      'curve builds',
      `graduates after ~${lamportsToSol(built.migrationQuoteThreshold).toFixed(3)} SOL raised`
    );

    // The logo is the single thing that most often ships wrong, and on an
    // immutable launch it cannot be corrected afterwards.
    if (!token.metadataUri) {
      add(
        curve.tokenAuthority !== 'immutable',
        'metadata URI set',
        curve.tokenAuthority === 'immutable'
          ? 'empty, and this launch is immutable — the token would have no logo forever'
          : 'empty — token launches with no logo, but you keep authority to fix it'
      );
    } else {
      const reachable = await head(token.metadataUri);
      add(reachable.ok, 'metadata URI reachable', reachable.detail);
      if (reachable.json) {
        const image = reachable.json.image;
        if (image) {
          const img = await head(image);
          add(img.ok, 'logo image reachable', `${image} — ${img.detail}`);
        } else {
          add(false, 'logo image reachable', 'metadata JSON has no "image" field');
        }
      }
    }
  }

  let payer = null;
  try {
    payer = loadKeypair({ cluster, keypairPath: argv.keypair });
    add(true, 'keypair loaded', payer.publicKey.toBase58());
  } catch (error) {
    add(false, 'keypair loaded', error.message.split('\n')[0]);
  }

  try {
    const { connection } = buildContext({ ...argv, confirmMainnet: true }, { requireSigner: false });
    const version = await connection.getVersion();
    const endpoint = resolveEndpoint(cluster);
    const isPublic = endpoint.includes('api.mainnet-beta.solana.com');
    add(true, 'RPC reachable', `${endpoint} (solana-core ${version['solana-core']})`);
    if (cluster === 'mainnet-beta' && isPublic) {
      warn(
        'using the public RPC',
        'fine for a one-off launch; set UNEMP_RPC_URL to a private endpoint if it times out'
      );
    }

    if (payer) {
      const balance = await connection.getBalance(payer.publicKey);
      const needed = REQUIRED_SOL + (curve?.firstBuySol ?? 0);
      add(
        balance >= needed * LAMPORTS_PER_SOL,
        'wallet funded',
        `${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, need ~${needed.toFixed(4)}`
      );
    }
  } catch (error) {
    add(false, 'RPC reachable', error.message.split('\n')[0]);
  }

  const existing = loadDeployment(cluster);
  add(!existing?.pool, 'no existing launch on this cluster', existing?.pool ? `already launched: ${existing.pool}` : 'clear');

  const width = Math.max(...checks.map((c) => c.label.length));
  console.log(`Preflight for ${cluster}\n`);
  for (const { level, label, detail } of checks) {
    console.log(`  ${level.padEnd(4)}  ${label.padEnd(width)}  ${detail}`);
  }

  const failed = checks.filter((c) => c.level === 'FAIL');
  if (failed.length) {
    console.log(`\n${failed.length} check(s) failed. Fix these before launching.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nAll checks passed.');
  if (cluster === 'mainnet-beta') {
    console.log('Launch with:  npm run launch -- --cluster mainnet-beta --confirm-mainnet');
  } else {
    console.log(`Launch with:  npm run launch -- --cluster ${cluster}`);
  }
}

async function head(url) {
  if (!/^https?:\/\//.test(url)) return { ok: false, detail: 'not an http(s) URL' };
  try {
    const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { ok: false, detail: `HTTP ${response.status}` };
    const type = response.headers.get('content-type') ?? '';
    if (type.includes('json')) {
      return { ok: true, detail: `HTTP 200, ${type}`, json: await response.json().catch(() => null) };
    }
    return { ok: true, detail: `HTTP 200, ${type}` };
  } catch (error) {
    return { ok: false, detail: error.message };
  }
}
