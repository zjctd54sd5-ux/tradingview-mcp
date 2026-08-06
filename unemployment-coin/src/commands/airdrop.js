import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { buildContext } from '../context.js';
import { explorerUrl } from '../config.js';

export async function airdrop(argv) {
  if (argv.cluster === 'mainnet-beta') {
    throw new Error('There is no airdrop on mainnet-beta. Fund the wallet with real SOL instead.');
  }

  const { connection, payer, cluster } = buildContext(argv);
  const sol = Number(argv.amount ?? 2);
  if (!Number.isFinite(sol) || sol <= 0) throw new Error('--amount must be a positive number of SOL');

  console.log(`Requesting ${sol} SOL for ${payer.publicKey.toBase58()} on ${cluster}...`);
  const signature = await connection.requestAirdrop(payer.publicKey, Math.round(sol * LAMPORTS_PER_SOL));
  const blockhash = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature, ...blockhash }, 'confirmed');

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Done. Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  console.log(explorerUrl('tx', signature, cluster));
}
