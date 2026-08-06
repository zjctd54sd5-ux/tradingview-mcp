# Unemployment Coin (UNEMP)

A tradeable Solana token, plus the CLI to launch and run it.

This is a self-contained subproject — it has its own `package.json` and shares
nothing with the TradingView MCP server in the parent directory.

## Two paths

**`launch` — a tradeable token.** Creates the mint *and* a market for it in one
transaction, on a [Meteora Dynamic Bonding Curve](https://docs.meteora.ag).
Anyone can buy immediately; price rises along the curve as they do. Once enough
SOL accumulates, the pool graduates to a standard DAMM v2 AMM and trades like any
other pair. This is what makes UNEMP tradeable.

**`create` — a plain token.** An SPL mint with the supply in your wallet and no
market. Useful if you want to distribute manually or add liquidity elsewhere
later. Nobody can buy it until you create a pool somewhere.

The two are alternatives, not steps. `launch` does not take a mint from `create`
— the curve program creates its own mint so it can hold the entire supply.

## Setup

```bash
cd unemployment-coin
npm install
```

## Quick start — launch it tradeable (devnet)

```bash
npm run keygen                  # writes .keys/devnet-payer.json (gitignored, mode 0600)
npm run airdrop                 # 2 devnet SOL
npm run launch -- --dry-run     # review the market terms first
npm run launch
npm run buy -- --amount 0.1     # buy 0.1 SOL worth off the curve
npm run curve                   # price, SOL raised, progress to graduation
npm run sell -- --amount 1000   # sell 1000 UNEMP back into the curve
```

`launch` writes `deployments/devnet.json` with the mint, pool, and config
addresses. Every later command reads that file, so you rarely need `--pool`.

If the public devnet faucet is rate limited, get SOL from
<https://faucet.solana.com> instead.

## How the curve works

`curve.config.json`:

| Field | Meaning |
|---|---|
| `totalSupply` | Whole tokens, all of it on the curve |
| `initialMarketCapSol` | Market cap at the first buy — sets the starting price |
| `migrationMarketCapSol` | Market cap at which the pool graduates to a real AMM |
| `baseFeeBps` | Trading fee, 100 = 1% |
| `creatorTradingFeePercentage` | Split between your creator and partner buckets — both are your wallet |
| `dynamicFeeEnabled` | Add a volatility surcharge on top of the base fee |
| `firstBuySol` | SOL you spend buying your own token in the launch tx |
| `tokenAuthority` | `update` (keep metadata authority) or `immutable` |
| `lpOwnership` | `locked` or `max-claimable` (see below) |

The SOL needed to graduate is *derived* from the two market caps, not set
directly. The committed defaults (30 → 400 SOL) work out to ~86 SOL raised;
`launch` prints the exact figure before it sends anything.

## What you own

A launch points every role at your wallet — pool creator, fee claimer, and
leftover receiver. `npm run owner` reads them back off chain and marks each one
`<- you` or `(NOT you)`, so ownership is verified rather than assumed.

| Thing | Who has it |
|---|---|
| Trading fees | You, both buckets — `npm run claim` |
| Unsold tokens after migration | You, as leftover receiver |
| Metadata (name, symbol, logo) | You, while `tokenAuthority` is `update` |
| Supply | Nobody — permanently fixed at launch |
| Post-migration liquidity | Depends on `lpOwnership` |

**Two things the chain will not let you own**, found by trying them:

- **Mint authority.** The `CreatorUpdateAndMintAuthority` option exists in the
  SDK, but the program rejects it outside transfer-hook configs — *"Mint
  authority token update options are only supported for transfer-hook configs"*.
  A DBC launch always ends with supply permanently fixed. That is good for how
  the token reads to buyers.
- **All of the liquidity.** At least 10% of post-migration LP must be
  permanently locked — *"At least 1000 BPS (10%) must be locked at day 1"*. So
  `lpOwnership: "locked"` locks 100%, and `max-claimable` locks the 10% minimum
  and leaves 90% withdrawable by you. `locked` is the default; `max-claimable`
  is the most the chain allows, and holders can read the setting on chain.

Fees are always collected in SOL rather than in UNEMP, so fee income does not
create sell pressure on the token.

## Claiming your fees

```bash
npm run claim
```

Fees land in two separate on-chain buckets — a creator bucket and a partner
bucket — and a launch makes your wallet the owner of both. `claim` sweeps both;
claiming only one would silently strand the other. It prints unclaimed amounts,
lifetime fees, and your net SOL change.

`npm run owner` shows the unclaimed balances without moving anything.

## The plain-token path

```bash
npm run create          # mint + metadata + initial supply, no market
npm run info            # confirm what landed on chain
```

`create` writes the same `deployments/<cluster>.json` with the mint address,
authorities, and treasury account.

## Testing against a local validator

A fresh local validator has neither the Token Metadata program nor the bonding
curve program, so both must be cloned in or every write fails:

```bash
solana-test-validator --reset --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s \
  --clone-upgradeable-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN

npm run launch -- --cluster localnet
npm run buy -- --cluster localnet --amount 1
npm run curve -- --cluster localnet
```

Localnet has an unlimited faucet, which makes it the practical way to rehearse a
launch when the devnet faucet is dry.

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
4. `npm run launch`, or for the plain-token path `npm run create` (and
   `npm run update-metadata` if the mint already exists).

A missing `metadataUri` is recoverable on both paths as long as you kept the
update authority (`tokenAuthority: "update"` for a launch, `mutable: true` for
`create`) — name and symbol still show, just no logo. With
`tokenAuthority: "immutable"` it is permanent, and `launch` refuses to run
without one unless you pass `--allow-no-logo`.

Since the URL is what the chain stores, host it somewhere that will outlive your
interest in it — Arweave or pinned IPFS rather than a personal server.

## Commands

| Command | What it does |
|---|---|
| `npm run keygen` | Generate a payer keypair |
| `npm run airdrop` | Request devnet/testnet SOL (`--amount`) |
| `npm run preflight` | Check config, logo, wallet, and RPC before a real launch |
| `npm run launch` | Create mint + bonding curve market — makes it tradeable |
| `npm run buy -- --amount 0.5` | Buy off the curve, `--amount` in SOL |
| `npm run sell -- --amount 1000` | Sell into the curve, `--amount` in tokens |
| `npm run curve` | Price, market cap, SOL raised, progress to graduation |
| `npm run claim` | Sweep accrued trading fees to your wallet |
| `npm run owner` | Every role and authority, and whether you hold it |
| `npm run create` | Plain SPL token instead: mint, metadata, initial supply |
| `npm run mint -- --amount 1000 --to <wallet>` | Mint more supply (`create` path only) |
| `npm run transfer -- --amount 50 --to <wallet>` | Send tokens |
| `npm run update-metadata` | Push config name/symbol/uri onto the mint |
| `npm run revoke -- --mint-authority --yes` | Permanently fix supply |
| `npm run info` | Mint state, metadata, balances |

npm needs `--` before flags: `npm run buy -- --amount 0.5`.

Common options: `--cluster devnet|testnet|mainnet-beta|localnet`, `--keypair <path>`,
`--mint <address>`, `--pool <address>`, `--slippage-bps <n>` (default 100 = 1%),
`--dry-run`, `--confirm-mainnet`.

Environment: `UNEMP_RPC_URL` (custom RPC — worth setting off devnet, the public
endpoints are heavily rate limited), `UNEMP_SECRET_KEY` (base58 or JSON byte array,
for CI), `UNEMP_CLUSTER`.

## Authorities (plain-token path only)

A curve launch always drops the mint authority, so none of this applies to it —
see "What you own" above. A mint from `create` keeps two authorities, both held
by the payer:

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
export UNEMP_RPC_URL="https://your-endpoint"                            # public RPC will rate limit
npm run preflight -- --cluster mainnet-beta                             # config, logo, funds, RPC
npm run launch -- --cluster mainnet-beta --confirm-mainnet --dry-run    # review the terms
npm run launch -- --cluster mainnet-beta --confirm-mainnet              # send
```

`preflight` fetches your `metadataUri` and the `image` inside it, so a broken
logo URL fails there instead of on chain.

Budget roughly 0.1 SOL for the config, pool, mint, metadata, and vault accounts,
plus whatever `firstBuySol` is set to.

Rehearse the whole thing on devnet or localnet first. A mainnet launch cannot be
undone, edited, or relaunched at the same address: supply, name, symbol, logo,
and curve shape are all fixed the moment the transaction confirms.

A token being tradeable is not the same as it being traded. The curve gives
anyone the *ability* to buy; whether anyone does is a separate matter, and if
nobody does, the SOL you put into `firstBuySol` is simply spent.

## Security

- `.keys/` is gitignored and written mode 0600. It is the wallet; anything with
  the secret key can move every token the wallet holds.
- Use a keypair created for this and nothing else, not your personal wallet.
- `deployments/*.json` holds only public addresses and is safe to commit.

## Tests

```bash
npm test
```

Covers base-unit conversion, both config validators, the Q64.64 price decoding,
argument parsing, and the mainnet guard. Chain operations are not unit tested —
exercise those against a local validator or devnet.
