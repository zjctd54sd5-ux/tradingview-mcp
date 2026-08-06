import { PublicKey } from '@solana/web3.js';
import { getMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import { buildContext, resolveMint } from '../context.js';
import { explorerUrl, fromBaseUnits, toBaseUnits } from '../config.js';

export async function mint(argv) {
  if (argv.amount === undefined) throw new Error('--amount is required (in whole tokens)');

  const { connection, payer, cluster } = buildContext(argv);
  const mintAddress = resolveMint(argv);
  const mintInfo = await getMint(connection, mintAddress);

  if (!mintInfo.mintAuthority) {
    throw new Error(`Mint authority for ${mintAddress.toBase58()} has been revoked — supply is fixed and cannot grow.`);
  }
  if (!mintInfo.mintAuthority.equals(payer.publicKey)) {
    throw new Error(
      `Payer ${payer.publicKey.toBase58()} is not the mint authority (${mintInfo.mintAuthority.toBase58()}).`
    );
  }

  const recipient = argv.to ? new PublicKey(argv.to) : payer.publicKey;
  const amount = toBaseUnits(argv.amount, mintInfo.decimals);
  if (amount === 0n) throw new Error('--amount must be greater than 0');

  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mintAddress, recipient);
  const signature = await mintTo(connection, payer, mintAddress, ata.address, payer, amount, [], {
    commitment: 'confirmed',
  });

  const after = await getMint(connection, mintAddress);
  console.log(`Minted ${argv.amount} tokens to ${recipient.toBase58()}`);
  console.log(`Token account: ${ata.address.toBase58()}`);
  console.log(`Total supply:  ${fromBaseUnits(after.supply, after.decimals)}`);
  console.log(explorerUrl('tx', signature, cluster));
}
