import { PublicKey } from '@solana/web3.js';
import {
  getAccount,
  getAssociatedTokenAddress,
  getMint,
  getOrCreateAssociatedTokenAccount,
  transfer as splTransfer,
} from '@solana/spl-token';
import { buildContext, resolveMint } from '../context.js';
import { explorerUrl, fromBaseUnits, toBaseUnits } from '../config.js';

export async function transfer(argv) {
  if (!argv.to) throw new Error('--to <wallet address> is required');
  if (argv.amount === undefined) throw new Error('--amount is required (in whole tokens)');

  const { connection, payer, cluster } = buildContext(argv);
  const mintAddress = resolveMint(argv);
  const mintInfo = await getMint(connection, mintAddress);

  const amount = toBaseUnits(argv.amount, mintInfo.decimals);
  if (amount === 0n) throw new Error('--amount must be greater than 0');

  const sourceAddress = await getAssociatedTokenAddress(mintAddress, payer.publicKey);
  const source = await getAccount(connection, sourceAddress).catch(() => {
    throw new Error(`${payer.publicKey.toBase58()} holds no account for this token.`);
  });
  if (source.amount < amount) {
    throw new Error(
      `Insufficient balance: have ${fromBaseUnits(source.amount, mintInfo.decimals)}, tried to send ${argv.amount}.`
    );
  }

  // Creating the recipient's ATA costs the payer rent (~0.002 SOL) if it does
  // not exist yet; that is expected and unavoidable for a first-time holder.
  const recipient = new PublicKey(argv.to);
  const destination = await getOrCreateAssociatedTokenAccount(connection, payer, mintAddress, recipient);

  const signature = await splTransfer(
    connection,
    payer,
    sourceAddress,
    destination.address,
    payer,
    amount,
    [],
    { commitment: 'confirmed' }
  );

  const remaining = await getAccount(connection, sourceAddress);
  console.log(`Sent ${argv.amount} to ${recipient.toBase58()}`);
  console.log(`Remaining balance: ${fromBaseUnits(remaining.amount, mintInfo.decimals)}`);
  console.log(explorerUrl('tx', signature, cluster));
}
