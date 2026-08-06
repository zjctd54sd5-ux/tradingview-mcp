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
 * Translate curve.config.json into the SDK's curve parameters.
 *
 * The shape is deliberately opinionated:
 *  - Supply is fixed at creation and the mint authority is dropped, so nobody
 *    (including us) can inflate it later.
 *  - Creator LP is 100% permanently locked at migration, so liquidity cannot be
 *    pulled out from under holders once the curve graduates.
 *  - Fees are collected in SOL rather than the token, so fee income does not
 *    sell pressure the token.
 */
export function buildLaunchCurve(curve, tokenDecimals) {
  return buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: tokenDecimals,
      tokenQuoteDecimal: TokenDecimal.NINE,
      tokenAuthorityOption: TOKEN_AUTHORITY_IMMUTABLE,
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
      partnerPermanentLockedLiquidityPercentage: 0,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 100,
      creatorLiquidityPercentage: 0,
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

/** TokenAuthorityOption.Immutable — no mint authority, no metadata updates. */
const TOKEN_AUTHORITY_IMMUTABLE = 1;

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
