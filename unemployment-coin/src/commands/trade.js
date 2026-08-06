import { PublicKey, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { buildContext } from '../context.js';
import { explorerUrl, fromBaseUnits, loadDeployment, toBaseUnits } from '../config.js';
import { SwapMode } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { dbcClient, lamportsToSol, solToLamports } from '../dbc.js';

const DEFAULT_SLIPPAGE_BPS = 100;

function resolvePool(argv) {
  if (argv.pool) return new PublicKey(argv.pool);

  const deployment = loadDeployment(argv.cluster);
  if (!deployment?.pool) {
    throw new Error(
      `No pool given and none recorded for ${argv.cluster}.\n` +
        'Pass --pool <address>, or run "npm run launch" first.'
    );
  }
  return new PublicKey(deployment.pool);
}

/** Buy the token off the curve with SOL. `--amount` is SOL to spend. */
export function buy(argv) {
  return trade(argv, { swapBaseForQuote: false });
}

/** Sell the token back into the curve for SOL. `--amount` is tokens to sell. */
export function sell(argv) {
  return trade(argv, { swapBaseForQuote: true });
}

async function trade(argv, { swapBaseForQuote }) {
  if (argv.amount === undefined) {
    throw new Error(swapBaseForQuote ? '--amount is required (tokens to sell)' : '--amount is required (SOL to spend)');
  }

  const { connection, payer, cluster } = buildContext(argv);
  const poolAddress = resolvePool(argv);
  const client = dbcClient(connection);

  // getPool returns a wrapper whose decoded state sits under `poolState`.
  // swapQuote2 wants the wrapper; reading reserves and config wants the state.
  const poolAccount = await client.state.getPool(poolAddress);
  const pool = poolAccount?.poolState;
  if (!pool) throw new Error(`No curve pool found at ${poolAddress.toBase58()}.`);

  const deployment = loadDeployment(cluster);
  const decimals = deployment?.decimals ?? 9;
  const symbol = deployment?.symbol ?? 'tokens';

  const amountIn = swapBaseForQuote ? toBaseUnits(argv.amount, decimals) : solToLamports(Number(argv.amount));
  const amountInBN = new BN(amountIn.toString());
  if (amountInBN.lten(0)) throw new Error('--amount must be greater than 0');

  const slippageBps = argv.slippageBps === undefined ? DEFAULT_SLIPPAGE_BPS : Number(argv.slippageBps);
  if (!Number.isFinite(slippageBps) || slippageBps < 0 || slippageBps > 10_000) {
    throw new Error('--slippage-bps must be between 0 and 10000');
  }

  const config = await client.state.getPoolConfig(pool.config);
  const quote = await client.pool.swapQuote2({
    virtualPool: poolAccount,
    config,
    swapMode: SwapMode.ExactIn,
    swapBaseForQuote,
    amountIn: amountInBN,
    slippageBps,
    hasReferral: false,
    eligibleForFirstSwapWithMinFee: false,
    // Timestamp because the curve was configured with ActivationType.Timestamp.
    currentPoint: new BN(Math.floor(Date.now() / 1000)),
  });

  const minOut = quote.minimumAmountOut;
  const describeIn = swapBaseForQuote ? `${argv.amount} ${symbol}` : `${argv.amount} SOL`;
  const describeOut = swapBaseForQuote
    ? `${lamportsToSol(quote.outputAmount).toFixed(9)} SOL`
    : `${fromBaseUnits(BigInt(quote.outputAmount.toString()), decimals)} ${symbol}`;

  console.log(`Pool:        ${poolAddress.toBase58()} (${cluster})`);
  console.log(`Direction:   ${swapBaseForQuote ? `sell ${symbol} for SOL` : `buy ${symbol} with SOL`}`);
  console.log(`In:          ${describeIn}`);
  console.log(`Out (quote): ${describeOut}`);
  console.log(`Slippage:    ${slippageBps / 100}%`);
  console.log(`Min out:     ${swapBaseForQuote ? `${lamportsToSol(minOut).toFixed(9)} SOL` : `${fromBaseUnits(BigInt(minOut.toString()), decimals)} ${symbol}`}`);
  console.log(`Trading fee: ${lamportsToSol(quote.tradingFee).toFixed(9)} SOL`);

  if (argv.dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  const transaction = await client.pool.swap({
    owner: payer.publicKey,
    payer: payer.publicKey,
    pool: poolAddress,
    amountIn: amountInBN,
    minimumAmountOut: minOut,
    swapBaseForQuote,
    referralTokenAccount: null,
  });

  const signature = await sendAndConfirmTransaction(connection, transaction, [payer], {
    commitment: 'confirmed',
    preflightCommitment: 'confirmed',
  });

  console.log(`\nDone. tx ${signature}`);
  console.log(explorerUrl('tx', signature, cluster));
}
