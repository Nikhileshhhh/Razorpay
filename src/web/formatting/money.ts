import type { Money } from '../../contracts/index.js';

const MINOR_UNITS = /^-?\d+$/;

function groupIndianDigits(value: string): string {
  if (value.length <= 3) return value;
  const lastThree = value.slice(-3);
  const leading = value.slice(0, -3);
  const groups: string[] = [];
  for (let end = leading.length; end > 0; end -= 2) {
    groups.unshift(leading.slice(Math.max(0, end - 2), end));
  }
  return `${groups.join(',')},${lastThree}`;
}

/** Formats API decimal-string minor units without any floating-point conversion. */
export function formatMoney(money: Money): string {
  if (money.currency !== 'INR' || !MINOR_UNITS.test(money.amount_minor)) {
    throw new Error('Unsupported money value');
  }
  const minor = BigInt(money.amount_minor);
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const rupees = absolute / 100n;
  const paise = (absolute % 100n).toString().padStart(2, '0');
  return `${negative ? '-' : ''}₹${groupIndianDigits(rupees.toString())}.${paise} INR`;
}
