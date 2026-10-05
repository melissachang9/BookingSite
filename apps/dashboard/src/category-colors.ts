// Soft marker colors for service categories. Colors follow category sort order
// (Uncategorized takes the slot after the last category), so a category keeps
// the same color on the Services page and on a provider's Services tab.
const CATEGORY_COLORS = [
  "var(--cs-mint)",
  "var(--cs-lilac)",
  "var(--cs-pink)",
  "var(--cs-blue)",
  "var(--cs-peach)",
];

export function categoryColor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length]!;
}
