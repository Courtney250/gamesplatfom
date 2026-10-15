export function formatIntegerAmount(value: string | number | bigint): string {
  try {
    const amount = typeof value === "bigint"
      ? value
      : typeof value === "number"
        ? (Number.isSafeInteger(value) ? BigInt(value) : null)
        : BigInt(value);
    if (amount === null) return "—";
    return new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount);
  } catch {
    return "—";
  }
}

export function formatKes(value: string | number | bigint): string {
  return `KSh ${formatIntegerAmount(value)}`;
}
