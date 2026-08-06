import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { createMetadataAccountV3 } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import bs58 from 'bs58';
import { buildContext, SEND_OPTIONS } from '../context.js';
import { explorerUrl, loadDeployment, loadTokenConfig, saveDeployment, toBaseUnits } from '../config.js';
import { readKeypairFile } from '../wallet.js';

// Enough for the mint account, metadata account, one ATA, and fees, with room
// to spare. Below this the run is very likely to fail partway through.
const MIN_SOL = 0.05;

export async function create(argv) {
  const token = loadTokenConfig();
  const { connection, payer, umi, umiSigner, cluster } = buildContext(argv);

  const existing = loadDeployment(cluster);
  if (existing?.mint && !argv.force) {
    throw new Error(
      `A mint is already recorded for ${cluster}: ${existing.mint}\n` +
        'Creating another one makes a second, unrelated token. Pass --force if that is really what you want.'
    );
  }

  const mintKeypair = argv.mintKeypair ? readKeypairFile(argv.mintKeypair) : Keypair.generate();
  const supplyBaseUnits = toBaseUnits(token.initialSupply, token.decimals);
  const freezeAuthority = argv.noFreeze ? null : payer.publicKey;

  console.log(`Cluster:          ${cluster}`);
  console.log(`Payer:            ${payer.publicKey.toBase58()}`);
  console.log(`Name / symbol:    ${token.name} (${token.symbol})`);
  console.log(`Decimals:         ${token.decimals}`);
  console.log(`Initial supply:   ${token.initialSupply} ${token.symbol}`);
  console.log(`Metadata URI:     ${token.metadataUri || '(none)'}`);
  console.log(`Mint address:     ${mintKeypair.publicKey.toBase58()}`);
  console.log(`Freeze authority: ${freezeAuthority ? freezeAuthority.toBase58() : 'disabled'}`);
  console.log(`Metadata mutable: ${token.mutable}`);

  if (!token.metadataUri) {
    console.log(
      '\nNote: metadataUri is empty, so wallets will show the on-chain name and symbol but no logo.\n' +
        'Host assets/metadata.json somewhere public, put the URL in token.config.json, and re-run — or fix it later with "npm run update-metadata".'
    );
  }

  if (argv.dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  const balance = await connection.getBalance(payer.publicKey);
  if (balance < MIN_SOL * LAMPORTS_PER_SOL) {
    throw new Error(
      `Payer has ${balance / LAMPORTS_PER_SOL} SOL, which is below the ~${MIN_SOL} SOL needed.\n` +
        (cluster === 'mainnet-beta'
          ? 'Fund the wallet and try again.'
          : `Run "npm run airdrop -- --cluster ${cluster}".`)
    );
  }

  console.log('\n[1/3] Creating mint...');
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    freezeAuthority,
    token.decimals,
    mintKeypair,
    { commitment: 'confirmed' },
    TOKEN_PROGRAM_ID
  );
  console.log(`      mint ${mint.toBase58()}`);

  // Record the mint before doing anything else. If a later step fails, the
  // address is on disk instead of stranded in a scrollback buffer.
  const record = {
    cluster,
    mint: mint.toBase58(),
    name: token.name,
    symbol: token.symbol,
    decimals: token.decimals,
    metadataUri: token.metadataUri,
    mutable: token.mutable,
    initialSupply: token.initialSupply,
    treasuryTokenAccount: null,
    mintAuthority: payer.publicKey.toBase58(),
    freezeAuthority: freezeAuthority ? freezeAuthority.toBase58() : null,
    updateAuthority: payer.publicKey.toBase58(),
    tokenProgram: TOKEN_PROGRAM_ID.toBase58(),
    createdAt: new Date().toISOString(),
    status: 'mint-created',
  };
  saveDeployment(cluster, record);

  try {
    console.log('[2/3] Writing Token Metadata...');
    const metadataResult = await createMetadataAccountV3(umi, {
      mint: publicKey(fromWeb3JsPublicKey(mint)),
      mintAuthority: umiSigner,
      payer: umiSigner,
      updateAuthority: umiSigner.publicKey,
      data: {
        name: token.name,
        symbol: token.symbol,
        uri: token.metadataUri,
        sellerFeeBasisPoints: 0,
        creators: null,
        collection: null,
        uses: null,
      },
      isMutable: token.mutable,
      collectionDetails: null,
    }).sendAndConfirm(umi, SEND_OPTIONS);
    console.log(`      tx ${bs58.encode(metadataResult.signature)}`);
    record.status = 'metadata-written';
    saveDeployment(cluster, record);

    if (supplyBaseUnits > 0n) {
      console.log('[3/3] Minting initial supply...');
      const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey);
      await mintTo(connection, payer, mint, ata.address, payer, supplyBaseUnits, [], {
        commitment: 'confirmed',
      });
      record.treasuryTokenAccount = ata.address.toBase58();
      console.log(`      ${token.initialSupply} ${token.symbol} -> ${record.treasuryTokenAccount}`);
    } else {
      console.log('[3/3] initialSupply is 0, skipping mint.');
    }
  } catch (error) {
    console.error(
      `\nThe mint ${mint.toBase58()} was created, but a later step failed. It is saved in ` +
        `deployments/${cluster}.json at status "${record.status}".\n` +
        'Finish it with "npm run update-metadata" and/or "npm run mint" rather than running create again.'
    );
    throw error;
  }

  record.status = 'complete';
  saveDeployment(cluster, record);

  console.log(`\nDone. Recorded in deployments/${cluster}.json`);
  console.log(explorerUrl('address', record.mint, cluster));
  console.log(
    '\nWhile the mint authority exists, supply can still be increased. Run "npm run revoke -- --mint-authority" to fix supply permanently.'
  );
}
