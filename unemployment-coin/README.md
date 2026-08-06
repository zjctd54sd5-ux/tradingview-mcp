# Unemployment Coin (UNEMP)

An SPL token on Solana, plus the CLI to create and run it.

This is a self-contained subproject — it has its own `package.json` and shares
nothing with the TradingView MCP server in the parent directory.

## What it does

- Creates an SPL mint (SPL Token program, configurable decimals)
- Writes a Metaplex Token Metadata account so wallets show a name, symbol, and logo
- Mints the initial supply to the payer's associated token account
- Mints more, transfers, inspects, and permanently revokes authorities

## Setup

```bash
cd unemployment-coin
npm install
```

## Quick start (devnet)

```bash
npm run keygen          # writes .keys/devnet-payer.json (gitignored, mode 0600)
npm run airdrop         # 2 devnet SOL
npm run create          # mint + metadata + initial supply
npm run info            # confirm what landed on chain
```

`create` writes `deployments/devnet.json` with the mint address, authorities, and
treasury account. Every later command reads that file, so you rarely need `--mint`.

If the public devnet faucet is rate limited, get SOL from
<https://faucet.solana.com> instead, or run against a local validator:

```bash
solana-test-validator --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s --url devnet --reset
npm run create -- --cluster localnet
```

The `--clone-upgradeable-program` flag matters: a fresh local validator has no
Token Metadata program, so metadata writes fail without it.

## Configuration

`token.config.json`:

| Field | Meaning |
|---|---|
| `name` | Display name, max 32 chars |
| `symbol` | Ticker, max 10 chars |
| `decimals` | 0–9. 9 is the SPL convention |
| `initialSupply` | Whole tokens minted at creation |
| `metadataUri` | HTTPS/Arweave URL of the off-chain JSON, max 200 chars |
| `mutable` | Whether metadata can be edited later |

### Logo and off-chain metadata

`metadataUri` points at a JSON file that carries the logo — the chain stores only
the URL. `assets/metadata.json` is a ready template:

1. Upload your logo (512×512 PNG works well) somewhere public — Arweave, IPFS, or
   any HTTPS host.
2. Put that image URL into `assets/metadata.json` (both `image` and
   `properties.files[0].uri`).
3. Upload `assets/metadata.json`, put *its* URL into `metadataUri`.
4. `npm run create`, or `npm run update-metadata` if the mint already exists.

Creating without a `metadataUri` is fine — the name and symbol still show up, just
no logo — and you can fill it in later as long as `mutable` was `true`.

## Commands

| Command | What it does |
|---|---|
| `npm run keygen` | Generate a payer keypair |
| `npm run airdrop` | Request devnet/testnet SOL (`--amount`) |
| `npm run create` | Create mint, write metadata, mint initial supply |
| `npm run mint -- --amount 1000 --to <wallet>` | Mint more supply |
| `npm run transfer -- --amount 50 --to <wallet>` | Send tokens |
| `npm run update-metadata` | Push config name/symbol/uri onto the mint |
| `npm run revoke -- --mint-authority --yes` | Permanently fix supply |
| `npm run info` | Mint state, metadata, balances |

npm needs `--` before flags: `npm run mint -- --amount 1000`.

Common options: `--cluster devnet|testnet|mainnet-beta|localnet`, `--keypair <path>`,
`--mint <address>`, `--dry-run`, `--confirm-mainnet`.

Environment: `UNEMP_RPC_URL` (custom RPC — worth setting off devnet, the public
endpoints are heavily rate limited), `UNEMP_SECRET_KEY` (base58 or JSON byte array,
for CI), `UNEMP_CLUSTER`.

## Authorities

A fresh mint keeps two authorities, both held by the payer:

- **Mint authority** — can create more tokens. While it exists, supply is not capped.
- **Freeze authority** — can freeze any holder's token account.

Holders and explorers treat both as risk. To give up the ability to inflate supply:

```bash
npm run revoke -- --mint-authority --yes
```

This is irreversible. `--no-freeze` on `create` skips the freeze authority from
the start. Without `--yes`, `revoke` prints what it would do and stops.

## Going to mainnet

Every write against `mainnet-beta` refuses unless you pass `--confirm-mainnet`.
Real SOL, permanent result:

```bash
npm run create -- --cluster mainnet-beta --confirm-mainnet --dry-run   # review
npm run create -- --cluster mainnet-beta --confirm-mainnet             # send
```

Budget roughly 0.02 SOL for the mint, metadata account, and token account rent.

Note that a mint alone is not tradeable — that needs a liquidity pool on a DEX,
which is separate work and a separate financial decision.

## Security

- `.keys/` is gitignored and written mode 0600. It is the wallet; anything with
  the secret key can move every token the wallet holds.
- Use a keypair created for this and nothing else, not your personal wallet.
- `deployments/*.json` holds only public addresses and is safe to commit.

## Tests

```bash
npm test
```

Covers base-unit conversion, config validation, argument parsing, and the mainnet
guard. Chain operations are not unit tested — exercise those against a local
validator or devnet.
