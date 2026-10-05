/** "$180" for whole dollars, "$180.50" otherwise. */
export function formatMoneyShort(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}
