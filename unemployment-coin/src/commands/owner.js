import { getMint } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fetchMetadata, findMetadataPda, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { PublicKey } from '@solana/web3.js';
import { buildContext } from '../context.js';
import { explorerUrl, loadDeployment, resolveEndpoint } from '../config.js';
import { dbcClient, lamportsToSol } from '../dbc.js';
import { loadKeypair } from '../wallet.js';

/**
 * Enumerate every role and authority attached to the launch and say plainly
 * whether the local wallet holds it. Reads live chain state rather than the
 * deployment file, so it reports what is actually true.
 */
export async function owner(argv) {
  const { connection, cluster } = buildContext(argv, { requireSigner: false });
  const deployment = loadDeployment(cluster);

  const poolAddress = argv.pool
    ? new PublicKey(argv.pool)
    : deployment?.pool
      ? new PublicKey(deployment.pool)
      : null;
  if (!poolAddress) {
    throw new Error(`No pool recorded for ${cluster}. Pass --pool <address>, or run "npm run launch" first.`);
  }

  let wallet = null;
  try {
    wallet = loadKeypair({ cluster, keypairPath: argv.keypair }).publicKey;
  } catch {
    console.log('No local keypair loaded — reporting addresses without ownership checks.\n');
  }

  const client = dbcClient(connection);
  const pool = (await client.state.getPool(poolAddress))?.poolState;
  if (!pool) throw new Error(`No curve pool found at ${poolAddress.toBase58()}.`);
  const config = await client.state.getPoolConfig(pool.config);

  const rows = [
    ['Pool creator', pool.creator, 'claims creator trading fees, withdraws surplus'],
    ['Fee claimer', config.feeClaimer, 'claims partner trading fees'],
    ['Leftover receiver', config.leftoverReceiver, 'receives unsold tokens after migration'],
  ];

  console.log(`Cluster: ${cluster}`);
  console.log(`Pool:    ${poolAddress.toBase58()}`);
  console.log(`Mint:    ${pool.baseMint.toBase58()}`);
  if (wallet) console.log(`Wallet:  ${wallet.toBase58()}`);

  console.log('\nRoles');
  for (const [label, key, what] of rows) {
    console.log(`  ${label.padEnd(20)} ${mark(key, wallet)}  ${what}`);
  }

  const mint = await getMint(connection, pool.baseMint);
  console.log('\nMint authorities');
  console.log(
    `  ${'Mint authority'.padEnd(20)} ${mint.mintAuthority ? mark(mint.mintAuthority, wallet) : 'revoked — supply is permanently fixed'}`
  );
  console.log(
    `  ${'Freeze authority'.padEnd(20)} ${mint.freezeAuthority ? mark(mint.freezeAuthority, wallet) : 'none — holder accounts can never be frozen'}`
  );

  const umi = createUmi(resolveEndpoint(cluster)).use(mplTokenMetadata());
  try {
    const metadata = await fetchMetadata(
      umi,
      findMetadataPda(umi, { mint: publicKey(fromWeb3JsPublicKey(pool.baseMint)) }),
      { commitment: 'confirmed' }
    );
    console.log('\nMetadata');
    console.log(`  ${'Update authority'.padEnd(20)} ${mark(new PublicKey(metadata.updateAuthority), wallet)}`);
    console.log(`  ${'Mutable'.padEnd(20)} ${metadata.isMutable ? 'yes — name, symbol, and logo can still be changed' : 'no — fixed forever'}`);
  } catch {
    console.log('\nMetadata           not readable');
  }

  const metrics = await client.state.getPoolFeeMetrics(poolAddress);
  console.log('\nMoney');
  console.log(`  ${'Unclaimed creator'.padEnd(20)} ${lamportsToSol(metrics.current.creatorQuoteFee).toFixed(9)} SOL`);
  console.log(`  ${'Unclaimed partner'.padEnd(20)} ${lamportsToSol(metrics.current.partnerQuoteFee).toFixed(9)} SOL`);
  console.log(`  ${'Lifetime fees'.padEnd(20)} ${lamportsToSol(metrics.total.totalTradingQuoteFee).toFixed(9)} SOL`);
  console.log(`  ${'Post-migration LP'.padEnd(20)} ${lpDescription(config)}`);

  console.log(`\n${explorerUrl('address', poolAddress.toBase58(), cluster)}`);
}

function mark(key, wallet) {
  const address = key.toBase58();
  if (!wallet) return address;
  return wallet.equals(key) ? `${address}  <- you` : `${address}  (NOT you)`;
}

function lpDescription(config) {
  const locked = Number(config.creatorPermanentLockedLiquidityPercentage ?? 0);
  const claimable = Number(config.creatorLiquidityPercentage ?? 0);
  if (locked === 0 && claimable === 0) return 'none allocated to you';
  if (locked === 100) return '100% permanently locked — you cannot withdraw it';
  return claimable === 100
    ? '100% claimable by you — the liquidity can be withdrawn'
    : `${locked}% permanently locked, ${claimable}% claimable by you`;
}
