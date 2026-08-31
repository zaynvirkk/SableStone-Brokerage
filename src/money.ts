const DECIMAL_PATTERN = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/;

/** Decimal values cross service boundaries as canonical strings, never JS numbers. */
export type DecimalString = string & { readonly __decimal: unique symbol };

export function decimal(value: string): DecimalString {
  if (!DECIMAL_PATTERN.test(value) || value === "-0") {
    throw new Error(`invalid decimal string: ${value}`);
  }
  const [whole, fraction] = value.split(".");
  const canonicalFraction = fraction?.replace(/0+$/, "");
  const canonical = canonicalFraction ? `${whole}.${canonicalFraction}` : whole;
  return canonical as DecimalString;
}

export function forbidNumericMoney(value: unknown): asserts value is string {
  if (typeof value !== "string") throw new Error("money must be a decimal string");
}

function parts(value: DecimalString): { negative: boolean; digits: bigint; scale: number } {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  return { negative, digits: BigInt(whole + fraction), scale: fraction.length };
}
function fromAtoms(atoms: bigint, scale: number): DecimalString {
  const negative = atoms < 0n;
  const unsigned = (negative ? -atoms : atoms).toString().padStart(scale + 1, "0");
  const rendered = scale ? `${unsigned.slice(0, -scale)}.${unsigned.slice(-scale)}` : unsigned;
  return decimal(`${negative ? "-" : ""}${rendered}`);
}
function align(left: DecimalString, right: DecimalString): [bigint, bigint, number] {
  const l = parts(left), r = parts(right), scale = Math.max(l.scale, r.scale);
  const la = l.digits * 10n ** BigInt(scale - l.scale) * (l.negative ? -1n : 1n);
  const ra = r.digits * 10n ** BigInt(scale - r.scale) * (r.negative ? -1n : 1n);
  return [la, ra, scale];
}
export function addDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const [l, r, scale] = align(left, right); return fromAtoms(l + r, scale);
}
export function subtractDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const [l, r, scale] = align(left, right); return fromAtoms(l - r, scale);
}
export function multiplyDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const l = parts(left), r = parts(right);
  const sign = l.negative !== r.negative ? -1n : 1n;
  return fromAtoms(l.digits * r.digits * sign, l.scale + r.scale);
}
export function divideDecimal(numerator: DecimalString, denominator: DecimalString, resultScale = 6): DecimalString {
  if (!Number.isSafeInteger(resultScale) || resultScale < 0 || resultScale > 18) throw new Error("division scale invalid");
  const n = parts(numerator), d = parts(denominator);
  if (d.digits === 0n) throw new Error("division by zero");
  const scaledNumerator = n.digits * 10n ** BigInt(resultScale + d.scale);
  const scaledDenominator = d.digits * 10n ** BigInt(n.scale);
  let quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  if (remainder * 2n >= scaledDenominator) quotient += 1n;
  if (n.negative !== d.negative) quotient = -quotient;
  return fromAtoms(quotient, resultScale);
}
export function minDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const [l, r] = align(left, right); return l <= r ? left : right;
}
export function maxDecimal(left: DecimalString, right: DecimalString): DecimalString {
  const [l, r] = align(left, right); return l >= r ? left : right;
}
