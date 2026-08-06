import fs from 'node:fs';
import { Keypair } from '@solana/web3.js';
import { defaultKeypairPath, writeKeypairFile } from '../wallet.js';
import { explorerUrl } from '../config.js';

export function keygen(argv) {
  const file = argv.keypair || defaultKeypairPath(argv.cluster);

  if (fs.existsSync(file) && !argv.force) {
    throw new Error(`${file} already exists. Pass --force to overwrite it (the existing key is lost for good).`);
  }

  const keypair = Keypair.generate();
  writeKeypairFile(file, keypair);

  console.log(`Wrote new keypair to ${file} (mode 0600)`);
  console.log(`Public key: ${keypair.publicKey.toBase58()}`);
  console.log(explorerUrl('address', keypair.publicKey.toBase58(), argv.cluster));
  console.log('\nThis file is the wallet. It is gitignored — back it up if it will hold anything of value.');
}
