export type MatchEconomics = {
  stakePerPlayerKes: bigint;
  prizePoolKes: bigint;
  feeBps: number;
  platformFeeKes: bigint;
  winnerPayoutKes: bigint;
};

export function parseKes(value: unknown, options: { min?: bigint; max?: bigint } = {}): bigint {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") {
    throw new Error("Amount must be a whole number of Kenyan shillings.");
  }
  const text = String(value);
  if (!/^(0|[1-9]\d*)$/.test(text)) throw new Error("Amount must be a whole number of Kenyan shillings.");
  const amount = BigInt(text);
  const min = options.min ?? 0n;
  const max = options.max ?? 10_000_000n;
  if (amount < min || amount > max) throw new Error(`Amount must be between KSh ${min} and KSh ${max}.`);
  return amount;
}

export function feeForPool(poolKes: bigint, feeBps: number): bigint {
  if (poolKes < 0n) throw new Error("Prize pool cannot be negative.");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) throw new Error("Fee rate must be an integer from 0 to 10,000 basis points.");
  // Whole-KSh policy: fractional shillings are rounded down; no floating-point math is used.
  return (poolKes * BigInt(feeBps)) / 10_000n;
}

export function calculateMatchEconomics(stakePerPlayerKes: bigint, feeBps = 1_000): MatchEconomics {
  if (stakePerPlayerKes < 0n) throw new Error("Stake cannot be negative.");
  const prizePoolKes = stakePerPlayerKes * 2n;
  const platformFeeKes = feeForPool(prizePoolKes, feeBps);
  return {
    stakePerPlayerKes,
    prizePoolKes,
    feeBps,
    platformFeeKes,
    winnerPayoutKes: prizePoolKes - platformFeeKes,
  };
}

export function serializeKes(amount: bigint): string {
  if (amount < 0n) throw new Error("Cannot serialize a negative wallet amount.");
  return amount.toString();
}
