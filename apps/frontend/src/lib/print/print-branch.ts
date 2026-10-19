/**
 * The branch the page on screen is filtered to, for the prints that cannot be
 * told it — a list's Print button lives in the shared `DataTable`, which knows
 * nothing about the page's branch filter.
 *
 * `useBranchScope` publishes its branch here; a list print reads it so the
 * letterhead is that branch's. "All branches", or a page with no branch filter,
 * leaves it unset, and the print falls back to company paper.
 *
 * Owned by one page at a time: navigating can mount the next page before the
 * last one cleans up, so a withdrawal only clears the branch it published.
 */

let current: { owner: symbol; storeId: string | undefined } | null = null;

export function publishPrintBranch(owner: symbol, storeId: string | undefined): void {
    current = { owner, storeId };
}

export function withdrawPrintBranch(owner: symbol): void {
    if (current?.owner === owner) current = null;
}

/** The page's single branch, or undefined for company paper. */
export function printBranch(): string | undefined {
    return current?.storeId;
}
