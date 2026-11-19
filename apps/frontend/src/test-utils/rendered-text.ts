/**
 * The text a Testing Library query compares against: whitespace collapsed to
 * single spaces. Money is formatted with a non-breaking space after the
 * symbol (see `formatCurrency`), and queries normalize the page side but not
 * the string you search for, so pass a formatted amount through this before
 * using it as a matcher: `getByText(asRendered(formatBDT(50)))`.
 */
export function asRendered(text: string): string {
    return text.replace(/\s+/g, ' ');
}
