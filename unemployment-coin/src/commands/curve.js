import { PublicKey } from '@solana/web3.js';
import { buildContext } from '../context.js';
import { explorerUrl, fromBaseUnits, loadDeployment } from '../config.js';
import { dbcClient, lamportsToSol, WSOL_DECIMALS } from '../dbc.js';

/** Show where the bonding curve stands and how far it is from graduating. */
export async function curveStatus(argv) {
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

  const client = dbcClient(connection);
  // getPool returns a wrapper whose decoded state sits under `poolState`.
  // swapQuote2 wants the wrapper; reading reserves wants the state.
  const poolAccount = await client.state.getPool(poolAddress);
  const pool = poolAccount?.poolState;
  if (!pool) throw new Error(`No curve pool found at ${poolAddress.toBase58()}.`);

  const decimals = deployment?.decimals ?? 9;
  const symbol = deployment?.symbol ?? 'tokens';

  const quoteReserve = lamportsToSol(pool.quoteReserve);
  const threshold = lamportsToSol(await client.state.getPoolMigrationQuoteThreshold(poolAddress));
  const progress = await client.state.getPoolQuoteTokenCurveProgress(poolAddress);

  console.log(`Cluster:        ${cluster}`);
  console.log(`Pool:           ${poolAddress.toBase58()}`);
  if (deployment?.mint) console.log(`Mint:           ${deployment.mint}`);
  console.log(`Base reserve:   ${fromBaseUnits(BigInt(pool.baseReserve.toString()), decimals)} ${symbol} left on curve`);
  console.log(`Quote reserve:  ${quoteReserve.toFixed(6)} SOL raised`);
  console.log(`Migrates at:    ${threshold.toFixed(6)} SOL`);
  console.log(`Progress:       ${(progress * 100).toFixed(2)}% ${bar(progress)}`);
  console.log(`Graduated:      ${pool.isMigrated ? 'yes — now trading on DAMM v2' : 'no — still on the curve'}`);

  const price = spotPrice(pool.sqrtPrice, decimals);
  console.log(`Spot price:     ${price.toFixed(12)} SOL per ${symbol}`);
  if (deployment?.totalSupply) {
    console.log(`Market cap:     ${(price * deployment.totalSupply).toFixed(3)} SOL`);
  }

  console.log(`\n${explorerUrl('address', poolAddress.toBase58(), cluster)}`);
}

/**
 * The pool stores price as a Q64.64 square root. Squaring it gives quote units
 * per base unit; the decimal shift converts that to SOL per whole token.
 * Reading it straight from the pool works even on a pool with no trades yet,
 * where quoting a swap has no reserves to price against.
 */
export function spotPrice(sqrtPrice, baseDecimals) {
  const sqrt = Number(BigInt(sqrtPrice.toString())) / 2 ** 64;
  return sqrt * sqrt * 10 ** (baseDecimals - WSOL_DECIMALS);
}

function bar(ratio, width = 24) {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `[${'#'.repeat(filled)}${'-'.repeat(width - filled)}]`;
}
