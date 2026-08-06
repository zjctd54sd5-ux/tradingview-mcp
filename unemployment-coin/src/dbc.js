import { LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenDecimal,
  TokenType,
  buildCurveWithMarketCap,
} from '@meteora-ag/dynamic-bonding-curve-sdk';

/** Wrapped SOL — the quote asset the curve is priced in. */
export const WSOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
export const WSOL_DECIMALS = 9;

export function dbcClient(connection) {
  return new DynamicBondingCurveClient(connection, 'confirmed');
}

export function solToLamports(sol) {
  return new BN(Math.round(sol * LAMPORTS_PER_SOL));
}

export function lamportsToSol(lamports) {
  return Number(BigInt(lamports.toString())) / LAMPORTS_PER_SOL;
}

/**
 * TokenAuthorityOption values, named for what they mean to the launcher.
 *
 * The enum also has CreatorUpdateAndMintAuthority (3), which would keep the mint
 * authority — but the program rejects it outside transfer-hook configs
 * ("Mint authority token update options are only supported for transfer-hook
 * configs"), so a DBC launch always ends with supply permanently fixed.
 */
export const TOKEN_AUTHORITY = {
  immutable: 1, // Immutable
  update: 0, // CreatorUpdateAuthority
};

/**
 * How the creator's share of liquidity is held once the curve graduates.
 *
 * The program requires at least 10% locked at day 1, so fully withdrawable
 * liquidity is not an option: `max-claimable` is the most the chain allows.
 */
export const LP_OWNERSHIP = {
  locked: { creatorPermanentLockedLiquidityPercentage: 100, creatorLiquidityPercentage: 0 },
  'max-claimable': { creatorPermanentLockedLiquidityPercentage: 10, creatorLiquidityPercentage: 90 },
};

/**
 * Translate curve.config.json into the SDK's curve parameters.
 *
 * Fees are always collected in SOL rather than the token, so fee income does not
 * create sell pressure. Everything else about ownership — metadata authority,
 * mint authority, and whether post-migration liquidity stays withdrawable — is
 * driven by curve.config.json rather than fixed here.
 */
export function buildLaunchCurve(curve, tokenDecimals) {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: tokenDecimals,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TOKEN_AUTHORITY[curve.tokenAuthority],
      totalTokenSupply: curve.totalSupply,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: {
          // A flat fee: same rate at the start and end, so no decay schedule.
          startingFeeBps: curve.baseFeeBps,
          endingFeeBps: curve.baseFeeBps,
          numberOfPeriod: 0,
          totalDuration: 0,
        },
      },
      dynamicFeeEnabled: curve.dynamicFeeEnabled,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: curve.creatorTradingFeePercentage,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: false,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps100,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      // Partner and creator are both the launching wallet, so nothing is given
      // away by putting the whole creator share on one side.
      partnerPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityPercentage: 0,
      ...LP_OWNERSHIP[curve.lpOwnership],
    },
    lockedVesting: {
      totalLockedVestingAmount: 0,
      numberOfVestingPeriod: 0,
      cliffUnlockAmount: 0,
      totalVestingDuration: 0,
      cliffDurationFromMigrationTime: 0,
    },
    activationType: ActivationType.Timestamp,
    initialMarketCap: curve.initialMarketCapSol,
    migrationMarketCap: curve.migrationMarketCapSol,
  });
}

/**
 * The SDK returns decimals as a plain number on the enum; map ours onto it and
 * reject anything the curve program will not accept.
 */
export function toTokenDecimal(decimals) {
  if (![6, 7, 8, 9].includes(decimals)) {
    throw new Error(
      `A bonding-curve launch requires 6, 7, 8, or 9 decimals, but token.config.json says ${decimals}.`
    );
  }
  return decimals;
}
