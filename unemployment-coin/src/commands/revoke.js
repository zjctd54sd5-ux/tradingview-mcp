import { AuthorityType, getMint, setAuthority } from '@solana/spl-token';
import { buildContext, resolveMint } from '../context.js';
import { explorerUrl, loadDeployment, saveDeployment } from '../config.js';

/**
 * Permanently drops the mint and/or freeze authority. Revoking the mint
 * authority fixes supply forever; revoking the freeze authority means holder
 * accounts can never be frozen. Neither can be undone.
 */
export async function revoke(argv) {
  const wantsMint = Boolean(argv.mintAuthority);
  const wantsFreeze = Boolean(argv.freezeAuthority);
  if (!wantsMint && !wantsFreeze) {
    throw new Error('Pass --mint-authority and/or --freeze-authority to say what to revoke.');
  }

  const { connection, payer, cluster } = buildContext(argv);
  const mintAddress = resolveMint(argv);
  const mintInfo = await getMint(connection, mintAddress);

  if (!argv.yes) {
    console.log(`Would revoke on ${mintAddress.toBase58()} (${cluster}):`);
    if (wantsMint) console.log('  - mint authority   -> supply permanently fixed');
    if (wantsFreeze) console.log('  - freeze authority -> holder accounts can never be frozen');
    throw new Error('This cannot be undone. Re-run with --yes to go through with it.');
  }

  const signatures = {};

  if (wantsMint) {
    if (!mintInfo.mintAuthority) {
      console.log('Mint authority is already revoked, skipping.');
    } else if (!mintInfo.mintAuthority.equals(payer.publicKey)) {
      throw new Error(`Payer is not the mint authority (${mintInfo.mintAuthority.toBase58()}).`);
    } else {
      signatures.mintAuthority = await setAuthority(
        connection,
        payer,
        mintAddress,
        payer,
        AuthorityType.MintTokens,
        null,
        [],
        { commitment: 'confirmed' }
      );
      console.log(`Mint authority revoked. tx ${signatures.mintAuthority}`);
    }
  }

  if (wantsFreeze) {
    if (!mintInfo.freezeAuthority) {
      console.log('Freeze authority is already revoked (or was never set), skipping.');
    } else if (!mintInfo.freezeAuthority.equals(payer.publicKey)) {
      throw new Error(`Payer is not the freeze authority (${mintInfo.freezeAuthority.toBase58()}).`);
    } else {
      signatures.freezeAuthority = await setAuthority(
        connection,
        payer,
        mintAddress,
        payer,
        AuthorityType.FreezeAccount,
        null,
        [],
        { commitment: 'confirmed' }
      );
      console.log(`Freeze authority revoked. tx ${signatures.freezeAuthority}`);
    }
  }

  const after = await getMint(connection, mintAddress);
  const deployment = loadDeployment(cluster);
  if (deployment?.mint === mintAddress.toBase58()) {
    saveDeployment(cluster, {
      ...deployment,
      mintAuthority: after.mintAuthority ? after.mintAuthority.toBase58() : null,
      freezeAuthority: after.freezeAuthority ? after.freezeAuthority.toBase58() : null,
    });
  }

  for (const signature of Object.values(signatures)) {
    console.log(explorerUrl('tx', signature, cluster));
  }
}
