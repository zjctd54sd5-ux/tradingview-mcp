import { fetchMetadata, findMetadataPda, updateMetadataAccountV2 } from '@metaplex-foundation/mpl-token-metadata';
import { publicKey } from '@metaplex-foundation/umi';
import { fromWeb3JsPublicKey } from '@metaplex-foundation/umi-web3js-adapters';
import bs58 from 'bs58';
import { buildContext, resolveMint, SEND_OPTIONS } from '../context.js';
import { explorerUrl, loadDeployment, loadTokenConfig, saveDeployment } from '../config.js';

/**
 * Push the current token.config.json name/symbol/uri onto an existing mint.
 * Mainly useful for filling in metadataUri after the assets are hosted.
 */
export async function updateMetadata(argv) {
  const token = loadTokenConfig();
  const { umi, umiSigner, cluster } = buildContext(argv);
  const mintAddress = resolveMint(argv);

  const metadataPda = findMetadataPda(umi, { mint: publicKey(fromWeb3JsPublicKey(mintAddress)) });
  const current = await fetchMetadata(umi, metadataPda, { commitment: 'confirmed' });

  if (!current.isMutable) {
    throw new Error('This metadata was created as immutable and can never be changed.');
  }
  if (current.updateAuthority !== umiSigner.publicKey) {
    throw new Error(`Signer is not the update authority (${current.updateAuthority}).`);
  }

  console.log(`Mint: ${mintAddress.toBase58()} (${cluster})`);
  console.log(`  name   ${current.name.replace(/\0+$/, '')} -> ${token.name}`);
  console.log(`  symbol ${current.symbol.replace(/\0+$/, '')} -> ${token.symbol}`);
  console.log(`  uri    ${current.uri.replace(/\0+$/, '') || '(none)'} -> ${token.metadataUri || '(none)'}`);

  if (argv.dryRun) {
    console.log('\n--dry-run: nothing was sent.');
    return;
  }

  const result = await updateMetadataAccountV2(umi, {
    metadata: metadataPda,
    updateAuthority: umiSigner,
    data: {
      name: token.name,
      symbol: token.symbol,
      uri: token.metadataUri,
      sellerFeeBasisPoints: current.sellerFeeBasisPoints,
      creators: current.creators,
      collection: current.collection,
      uses: current.uses,
    },
    // `isMutable: false` here would be a one-way door, so only set it on request.
    isMutable: argv.makeImmutable ? false : current.isMutable,
    newUpdateAuthority: null,
    primarySaleHappened: null,
  }).sendAndConfirm(umi, SEND_OPTIONS);

  const signature = bs58.encode(result.signature);
  console.log(`\nUpdated. tx ${signature}`);
  if (argv.makeImmutable) console.log('Metadata is now immutable and can never be changed again.');

  const deployment = loadDeployment(cluster);
  if (deployment?.mint === mintAddress.toBase58()) {
    saveDeployment(cluster, {
      ...deployment,
      name: token.name,
      symbol: token.symbol,
      metadataUri: token.metadataUri,
      mutable: argv.makeImmutable ? false : deployment.mutable,
    });
  }

  console.log(explorerUrl('tx', signature, cluster));
}
