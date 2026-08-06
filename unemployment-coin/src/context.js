import { Connection, PublicKey } from '@solana/web3.js';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { mplTokenMetadata } from '@metaplex-foundation/mpl-token-metadata';
import { createSignerFromKeypair, signerIdentity } from '@metaplex-foundation/umi';
import { fromWeb3JsKeypair } from '@metaplex-foundation/umi-web3js-adapters';
import { assertClusterAllowed, loadDeployment, resolveEndpoint } from './config.js';
import { loadKeypair } from './wallet.js';

/**
 * Umi's preflight simulation defaults to the `finalized` bank, which lags the
 * `confirmed` state the SPL calls here run against — on a fresh validator that
 * makes a just-funded payer look empty ("no record of a prior credit"). Pin both
 * send and confirm to `confirmed` so the whole flow reads one consistent state.
 */
export const SEND_OPTIONS = {
  send: { preflightCommitment: 'confirmed' },
  confirm: { commitment: 'confirmed' },
};

/**
 * Everything a write command needs: an RPC connection, the signing keypair, and
 * a Umi instance wired to the same signer for the Token Metadata program.
 */
export function buildContext(argv, { requireSigner = true } = {}) {
  const cluster = argv.cluster;
  assertClusterAllowed(cluster, argv);

  const endpoint = resolveEndpoint(cluster);
  const connection = new Connection(endpoint, 'confirmed');

  if (!requireSigner) {
    return { cluster, endpoint, connection };
  }

  const payer = loadKeypair({ cluster, keypairPath: argv.keypair });
  const umi = createUmi(endpoint).use(mplTokenMetadata());
  const umiSigner = createSignerFromKeypair(umi, fromWeb3JsKeypair(payer));
  umi.use(signerIdentity(umiSigner));

  return { cluster, endpoint, connection, payer, umi, umiSigner };
}

/**
 * Resolve the mint to operate on: an explicit --mint wins, otherwise fall back
 * to the mint recorded by `create` for this cluster.
 */
export function resolveMint(argv) {
  if (argv.mint) return new PublicKey(argv.mint);

  const deployment = loadDeployment(argv.cluster);
  if (!deployment?.mint) {
    throw new Error(
      `No mint given and no deployment recorded for ${argv.cluster}.\n` +
        'Pass --mint <address>, or run "npm run create" first.'
    );
  }
  return new PublicKey(deployment.mint);
}
