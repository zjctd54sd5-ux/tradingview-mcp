import { Keypair, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import { buildContext } from '../context.js';
import { explorerUrl, loadCurveConfig, loadDeployment, loadTokenConfig, saveDeployment } from '../config.js';
import { deriveDbcPoolAddress } from '@meteora-ag/dynamic-bonding-curve-sdk';
import { buildLaunchCurve, dbcClient, lamportsToSol, solToLamports, toTokenDecimal, WSOL_MINT } from '../dbc.js';
import { readKeypairFile } from '../wallet.js';

// Config account, pool account, mint, metadata, vaults, plus fees.
const MIN_SOL = 0.1;

const AUTHORITY_DESCRIPTION = {
  immutable: 'immutable — metadata fixed forever, supply fixed',
  update: 'you keep metadata update authority; supply fixed either way',
};

/**
 * Launch the token on a Meteora Dynamic Bonding Curve.
 *
 * Unlike `create`, the curve program creates the mint itself and holds the
 * entire supply on the curve — there is no treasury balance to distribute.
 * Buyers mint from the curve at a rising price; once enough SOL accumulates the
 * pool graduates to a standard DAMM v2 AMM.
 */
export async function launch(argv) {
  const token = loadTokenConfig();
  const curve = loadCurveConfig();
  const { connection, payer, cluster } = buildContext(argv);

  const existing = loadDeployment(cluster);
  if (existing?.pool && !argv.force) {
    throw new Error(
      `A curve pool is already recorded for ${cluster}: ${existing.pool}\n` +
        'Launching again creates a second, competing market. Pass --force if that is really what you want.'
    );
  }

  const decimals = toTokenDecimal(token.decimals);
  const curveParams = buildLaunchCurve(curve, decimals);
  const migrationSol = lamportsToSol(curveParams.migrationQuoteThreshold);

  const baseMint = argv.mintKeypair ? readKeypairFile(argv.mintKeypair) : Keypair.generate();
  const configKeypair = Keypair.generate();
  const firstBuy = solToLamports(curve.firstBuySol);

  console.log(`Cluster:            ${cluster}`);
  console.log(`Creator:            ${payer.publicKey.toBase58()}`);
  console.log(`Name / symbol:      ${token.name} (${token.symbol})`);
  console.log(`Decimals:           ${token.decimals}`);
  console.log(`Metadata URI:       ${token.metadataUri || '(none)'}`);
  console.log(`Mint:               ${baseMint.publicKey.toBase58()}`);
  console.log(`Quote asset:        SOL`);
  console.log(`Total supply:       ${curve.totalSupply.toLocaleString('en-US')} ${token.symbol} (all on the curve)`);
  console.log(`Start market cap:   ${curve.initialMarketCapSol} SOL`);
  console.log(`Migration at:       ${curve.migrationMarketCapSol} SOL market cap`);
  console.log(`  ≈ SOL raised:     ${migrationSol.toFixed(3)} SOL before it graduates to DAMM v2`);
  console.log(`Trading fee:        ${curve.baseFeeBps / 100}%${curve.dynamicFeeEnabled ? ' + dynamic' : ''}`);
  console.log(`  goes to you:      creator + partner fees, both claimable with "npm run claim"`);
  console.log(`Creator LP:         ${curve.lpOwnership === 'locked' ? '100% permanently locked at migration' : '90% claimable by you after migration, 10% locked (the chain minimum)'}`);
  console.log(`Token authority:    ${AUTHORITY_DESCRIPTION[curve.tokenAuthority]}`);
  console.log(`Your first buy:     ${curve.firstBuySol} SOL`);

  if (curve.lpOwnership === 'max-claimable') {
    console.log(
      '\nWarning: claimable LP means you can withdraw most of the liquidity backing the token\n' +
        'after migration. Holders can read that setting on chain and price it in.'
    );
  }
  if (!token.metadataUri) {
    const fixable = curve.tokenAuthority !== 'immutable';
    console.log(
      `\nWarning: metadataUri is empty, so the token launches with no logo.${
        fixable
          ? '\nYou keep the update authority, so this is fixable later — but wallets show it bare until then.'
          : '\nThis launch is immutable, so that cannot be fixed afterwards. Host assets/metadata.json first.'
      }`
    );
  }

  if (argv.dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  // Only a hard blocker when it cannot be fixed afterwards.
  if (!token.metadataUri && curve.tokenAuthority === 'immutable' && !argv.allowNoLogo) {
    throw new Error('Refusing to launch permanently without a logo. Set metadataUri, or pass --allow-no-logo.');
  }

  const balance = await connection.getBalance(payer.publicKey);
  const needed = MIN_SOL * LAMPORTS_PER_SOL + firstBuy.toNumber();
  if (balance < needed) {
    throw new Error(
      `Payer has ${balance / LAMPORTS_PER_SOL} SOL but needs about ${needed / LAMPORTS_PER_SOL} ` +
        `(${MIN_SOL} for accounts and fees${curve.firstBuySol ? ` + ${curve.firstBuySol} for the first buy` : ''}).`
    );
  }

  const client = dbcClient(connection);

  console.log('\n[1/2] Building config + pool transaction...');
  const shared = {
    payer: payer.publicKey,
    config: configKeypair.publicKey,
    feeClaimer: payer.publicKey,
    leftoverReceiver: payer.publicKey,
    quoteMint: WSOL_MINT,
    ...curveParams,
    preCreatePoolParam: {
      name: token.name,
      symbol: token.symbol,
      uri: token.metadataUri,
      poolCreator: payer.publicKey,
      baseMint: baseMint.publicKey,
    },
  };

  // With a first buy the SDK splits this into two transactions, because config
  // creation and the buy cannot share one. Without it, a single tx does both.
  const signatures = [];
  if (firstBuy.gtn(0)) {
    const { createConfigTx, createPoolWithFirstBuyTx } = await client.partner.createConfigAndPoolWithFirstBuy({
      ...shared,
      firstBuyParam: {
        buyer: payer.publicKey,
        receiver: payer.publicKey,
        buyAmount: firstBuy,
        minimumAmountOut: new BN(0),
        referralTokenAccount: null,
      },
    });
    console.log('[2/2] Sending config, then pool + first buy...');
    signatures.push(await send(connection, createConfigTx, [payer, configKeypair]));
    signatures.push(await send(connection, createPoolWithFirstBuyTx, [payer, baseMint]));
  } else {
    const tx = await client.partner.createConfigAndPool(shared);
    console.log('[2/2] Sending config + pool...');
    signatures.push(await send(connection, tx, [payer, configKeypair, baseMint]));
  }

  const pool = deriveDbcPoolAddress(WSOL_MINT, baseMint.publicKey, configKeypair.publicKey);

  const record = {
    ...(existing ?? {}),
    cluster,
    venue: 'meteora-dbc',
    mint: baseMint.publicKey.toBase58(),
    pool: pool.toBase58(),
    config: configKeypair.publicKey.toBase58(),
    quoteMint: WSOL_MINT.toBase58(),
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    metadataUri: token.metadataUri,
    totalSupply: curve.totalSupply,
    initialMarketCapSol: curve.initialMarketCapSol,
    migrationMarketCapSol: curve.migrationMarketCapSol,
    migrationQuoteThresholdSol: migrationSol,
    tokenAuthority: curve.tokenAuthority,
    lpOwnership: curve.lpOwnership,
    creator: payer.publicKey.toBase58(),
    feeClaimer: payer.publicKey.toBase58(),
    leftoverReceiver: payer.publicKey.toBase58(),
    launchedAt: new Date().toISOString(),
    status: 'launched',
  };
  saveDeployment(cluster, record);

  console.log(`\nLaunched. Recorded in deployments/${cluster}.json`);
  console.log(`Mint: ${record.mint}`);
  console.log(`Pool: ${record.pool}`);
  for (const signature of signatures) console.log(explorerUrl('tx', signature, cluster));
  console.log('\nIt is tradeable now: "npm run buy -- --amount 0.1" and "npm run curve" to watch progress.');
}

function send(connection, transaction, signers) {
  return sendAndConfirmTransaction(connection, transaction, signers, {
    commitment: 'confirmed',
    // Preflight against `confirmed` for the same reason the metadata writes do:
    // the finalized bank lags far enough to report a funded payer as empty.
    preflightCommitment: 'confirmed',
  });
}
