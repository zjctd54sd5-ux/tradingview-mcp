import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { fetchMetadata, findMetadataPda, mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import { buildContext, resolveMint } from '../context.js';
import { explorerUrl, fromBaseUnits, resolveEndpoint } from '../config.js';
import { loadKeypair } from '../wallet.js';

export async function info(argv) {
  const { connection, cluster } = buildContext(argv, { requireSigner: false });
  const mintAddress = resolveMint(argv);
  const mintInfo = await getMint(connection, mintAddress);

  console.log(`Cluster:          ${cluster}`);
  console.log(`Mint:             ${mintAddress.toBase58()}`);
  console.log(`Decimals:         ${mintInfo.decimals}`);
  console.log(`Supply:           ${fromBaseUnits(mintInfo.supply, mintInfo.decimals)}`);
  console.log(`Mint authority:   ${mintInfo.mintAuthority?.toBase58() ?? 'revoked (supply is fixed)'}`);
  console.log(`Freeze authority: ${mintInfo.freezeAuthority?.toBase58() ?? 'none'}`);

  const umi = createUmi(resolveEndpoint(cluster)).use(mplTokenMetadata());
  const metadataPda = findMetadataPda(umi, { mint: publicKey(fromWeb3JsPublicKey(mintAddress)) });
  try {
    // Explicit `confirmed`: the default read commitment lags, so a metadata
    // account written seconds ago would otherwise look like it does not exist.
    const metadata = await fetchMetadata(umi, metadataPda, { commitment: 'confirmed' });
    console.log(`\nName:             ${metadata.name.replace(/\0+$/, '')}`);
    console.log(`Symbol:           ${metadata.symbol.replace(/\0+$/, '')}`);
    console.log(`URI:              ${metadata.uri.replace(/\0+$/, '') || '(none)'}`);
    console.log(`Update authority: ${metadata.updateAuthority}`);
    console.log(`Mutable:          ${metadata.isMutable}`);
  } catch (error) {
    // Only "the account isn't there" is expected here; anything else is a real
    // failure and should not be reported as a missing metadata account.
    if (error.name === 'AccountNotFoundError') {
      console.log('\nNo Token Metadata account found for this mint.');
    } else {
      console.log(`\nCould not read Token Metadata: ${error.message}`);
    }
  }

  // Wallet section is best-effort: `info` is useful without a local keypair.
  try {
    const payer = loadKeypair({ cluster, keypairPath: argv.keypair });
    const sol = await connection.getBalance(payer.publicKey);
    const ata = await getAssociatedTokenAddress(mintAddress, payer.publicKey);
    const balance = await getAccount(connection, ata)
      .then((a) => fromBaseUnits(a.amount, mintInfo.decimals))
      .catch(() => '0 (no token account)');
    console.log(`\nWallet:           ${payer.publicKey.toBase58()}`);
    console.log(`SOL balance:      ${sol / LAMPORTS_PER_SOL}`);
    console.log(`Token balance:    ${balance}`);
  } catch {
    console.log('\nNo local keypair loaded, skipping wallet balances.');
  }

  console.log(`\n${explorerUrl('address', mintAddress.toBase58(), cluster)}`);
}
