export type CurrencyCode = string;

export interface Money {
  readonly currency: CurrencyCode;
  readonly minor: bigint;
}

export const USD_ZERO: Money = Object.freeze({ currency: "USD", minor: 0n });

export function usdFromCents(minor: bigint | number): Money {
  return { currency: "USD", minor: BigInt(minor) };
}

export function usdFromDecimal(input: string): Money {
  if (!/^-?\d+(\.\d{1,4})?$/.test(input)) {
    throw new Error(`Invalid USD decimal amount: ${input}`);
  }

  const negative = input.startsWith("-");
  const normalized = negative ? input.slice(1) : input;
  const parts = normalized.split(".");
  const wholePart = parts[0] ?? "0";
  const fractionalPart = parts[1] ?? "";
  const paddedFraction = `${fractionalPart}0000`.slice(0, 4);
  const tenThousandths = BigInt(wholePart) * 10000n + BigInt(paddedFraction);
  const roundedCents = (tenThousandths + 50n) / 100n;
  return { currency: "USD", minor: negative ? -roundedCents : roundedCents };
}

export function moneyToDecimalString(value: Money): string {
  const negative = value.minor < 0n;
  const absolute = negative ? -value.minor : value.minor;
  const dollars = absolute / 100n;
  const cents = absolute % 100n;
  return `${negative ? "-" : ""}${dollars.toString()}.${cents.toString().padStart(2, "0")}`;
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { currency: left.currency, minor: left.minor + right.minor };
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { currency: left.currency, minor: left.minor - right.minor };
}

export function multiplyMoneyByBasisPoints(value: Money, basisPoints: number): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new Error("Basis points must be an integer.");
  }
  return {
    currency: value.currency,
    minor: roundDiv(value.minor * BigInt(basisPoints), 10000n)
  };
}

export function allocateByWeight(value: Money, weight: AllocationWeight): Money {
  return {
    currency: value.currency,
    minor: roundDiv(value.minor * BigInt(weight.partsPerMillion), 1_000_000n)
  };
}

export interface AllocationWeight {
  readonly partsPerMillion: number;
}

export function weightFromDecimal(input: number): AllocationWeight {
  if (!Number.isFinite(input) || input < 0 || input > 1) {
    throw new Error(`Allocation weight must be between 0 and 1: ${String(input)}`);
  }

  return { partsPerMillion: Math.round(input * 1_000_000) };
}

export function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: ${left.currency} vs ${right.currency}`);
  }
}

export function compareMoney(left: Money, right: Money): number {
  assertSameCurrency(left, right);
  if (left.minor < right.minor) {
    return -1;
  }
  if (left.minor > right.minor) {
    return 1;
  }
  return 0;
}

function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new Error("Denominator must be positive.");
  }

  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute + denominator / 2n) / denominator;
  return negative ? -rounded : rounded;
}
