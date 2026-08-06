import { LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { buildContext, resolvePool } from '../context.js';
import { explorerUrl, fromBaseUnits, loadDeployment } from '../config.js';
import { dbcClient, lamportsToSol } from '../dbc.js';

// Claim everything available; the program caps each side at what has accrued.
const MAX = new BN('18446744073709551615');

/**
 * Sweep accrued trading fees into the launching wallet.
 *
 * A launch sets both `poolCreator` and `feeClaimer` to that one wallet, so fees
 * land in two separate on-chain buckets that both belong to it. Claiming only
 * the creator side silently leaves the partner side stranded, so this claims
 * both and reports them separately.
 */
export async function claim(argv) {
  const { connection, payer, cluster } = buildContext(argv);
  const poolAddress = resolvePool(argv);
  const client = dbcClient(connection);

  const poolAccount = await client.state.getPool(poolAddress);
  const pool = poolAccount?.poolState;
  if (!pool) throw new Error(`No curve pool found at ${poolAddress.toBase58()}.`);

  const deployment = loadDeployment(cluster);
  const decimals = deployment?.decimals ?? 9;
  const symbol = deployment?.symbol ?? 'tokens';

  const metrics = await client.state.getPoolFeeMetrics(poolAddress);
  const { creatorQuoteFee, creatorBaseFee, partnerQuoteFee, partnerBaseFee } = metrics.current;

  console.log(`Pool:    ${poolAddress.toBase58()} (${cluster})`);
  console.log(`Wallet:  ${payer.publicKey.toBase58()}`);
  console.log('\nUnclaimed:');
  console.log(`  creator  ${lamportsToSol(creatorQuoteFee).toFixed(9)} SOL` + baseSuffix(creatorBaseFee, decimals, symbol));
  console.log(`  partner  ${lamportsToSol(partnerQuoteFee).toFixed(9)} SOL` + baseSuffix(partnerBaseFee, decimals, symbol));
  console.log(`Lifetime fees on this pool: ${lamportsToSol(metrics.total.totalTradingQuoteFee).toFixed(9)} SOL`);

  const claimCreator = creatorQuoteFee.gtn(0) || creatorBaseFee.gtn(0);
  const claimPartner = partnerQuoteFee.gtn(0) || partnerBaseFee.gtn(0);

  if (!claimCreator && !claimPartner) {
    console.log('\nNothing to claim yet — fees accrue as people trade.');
    return;
  }

  if (argv.dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  const before = await connection.getBalance(payer.publicKey);
  const signatures = [];

  if (claimCreator) {
    if (!pool.creator.equals(payer.publicKey)) {
      throw new Error(`Wallet is not the pool creator (${pool.creator.toBase58()}).`);
    }
    const tx = await client.creator.claimCreatorTradingFee({
      creator: payer.publicKey,
      payer: payer.publicKey,
      pool: poolAddress,
      maxBaseAmount: MAX,
      maxQuoteAmount: MAX,
    });
    signatures.push(await send(connection, tx, payer));
    console.log('\nClaimed creator fees.');
  }

  if (claimPartner) {
    const config = await client.state.getPoolConfig(pool.config);
    if (!config.feeClaimer.equals(payer.publicKey)) {
      throw new Error(`Wallet is not the fee claimer (${config.feeClaimer.toBase58()}).`);
    }
    const tx = await client.partner.claimPartnerTradingFee({
      feeClaimer: payer.publicKey,
      payer: payer.publicKey,
      pool: poolAddress,
      maxBaseAmount: MAX,
      maxQuoteAmount: MAX,
    });
    signatures.push(await send(connection, tx, payer));
    console.log('Claimed partner fees.');
  }

  const after = await connection.getBalance(payer.publicKey);
  console.log(`\nSOL balance: ${(before / LAMPORTS_PER_SOL).toFixed(9)} -> ${(after / LAMPORTS_PER_SOL).toFixed(9)}`);
  console.log(`Net (after tx fees): ${((after - before) / LAMPORTS_PER_SOL).toFixed(9)} SOL`);
  for (const signature of signatures) console.log(explorerUrl('tx', signature, cluster));
}

function baseSuffix(baseFee, decimals, symbol) {
  return baseFee.gtn(0) ? ` + ${fromBaseUnits(BigInt(baseFee.toString()), decimals)} ${symbol}` : '';
}

function send(connection, transaction, payer) {
  return sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });
}
