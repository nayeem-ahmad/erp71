/** Same rule as sync-branch-books.utils isCashDrawer. A wallet stays shared. */
const WALLET_NAMES = new Set(['bKash Account', 'Nagad Account']);

export function isCashDrawer(
    account: { id: string; name: string; category: string },
    walletAccountIds: ReadonlySet<string>,
): boolean {
    if (account.category !== 'cash') return false;
    if (walletAccountIds.has(account.id)) return false;
    if (WALLET_NAMES.has(account.name)) return false;
    return true;
}
