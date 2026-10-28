import { isCashDrawer } from './cash-drawer';

type DrawerLookup = {
    paymentMethod: { findMany: (args: unknown) => Promise<Array<{ account_id: string | null }>> };
    account: {
        findMany: (args: unknown) => Promise<Array<{ id: string; name: string; category: string; store_id: string | null }>>;
    };
};

/** The cash account a branch payment should credit, once the branch is known. */
export async function resolveBranchCashAccount(
    db: DrawerLookup,
    tenantId: string,
    storeId: string,
): Promise<MoneyAccountResult> {
    const methods = await db.paymentMethod.findMany({
        where: { tenant_id: tenantId, type: { equals: 'Mobile Wallet', mode: 'insensitive' } },
        select: { account_id: true },
    });
    const walletAccountIds = new Set(
        methods.map((method) => method.account_id).filter((id): id is string => Boolean(id)),
    );
    const accounts = await db.account.findMany({
        where: { tenant_id: tenantId, store_id: storeId, category: 'cash' },
        select: { id: true, name: true, category: true, store_id: true },
    });
    const drawer = accounts.find((account) => account.store_id && isCashDrawer(account, walletAccountIds));
    return resolveMoneyAccount({
        mode: 'cash',
        storeId,
        tenderAccount: null,
        branchDrawer: drawer?.store_id ? { id: drawer.id, storeId: drawer.store_id } : null,
        sharedAccountId: null,
        walletAccountIds,
    });
}

export function cashPostErrorMessage(error: MoneyAccountError): string {
    if (error === 'NO_DRAWER') return 'This branch has no cash drawer.';
    if (error === 'DRAWER_BRANCH_MISMATCH') return 'This cash drawer belongs to another branch.';
    return 'A cash payment needs a branch.';
}

export type MoneyAccountError = 'NO_BRANCH' | 'DRAWER_BRANCH_MISMATCH' | 'NO_DRAWER';

export type MoneyAccountResult = { accountId: string } | { error: MoneyAccountError };

export interface TenderAccount {
    id: string;
    storeId: string | null;
    category: string;
    name: string;
}

/**
 * Which account a cash, bank, or wallet leg posts to.
 * A drawer is only legal at its own branch. A bank or wallet tender is shared.
 */
export function resolveMoneyAccount(input: {
    mode: 'cash' | 'bank' | 'wallet';
    storeId: string | null;
    tenderAccount: TenderAccount | null;
    branchDrawer: { id: string; storeId: string } | null;
    sharedAccountId: string | null;
    walletAccountIds?: ReadonlySet<string>;
}): MoneyAccountResult {
    const wallets = input.walletAccountIds ?? new Set<string>();
    const tender = input.tenderAccount;

    if (tender && isCashDrawer(tender, wallets)) {
        if (!input.storeId) return { error: 'NO_BRANCH' };
        if (tender.storeId !== input.storeId) return { error: 'DRAWER_BRANCH_MISMATCH' };
        return { accountId: tender.id };
    }

    if (tender) return { accountId: tender.id };

    if (input.mode === 'bank' || input.mode === 'wallet') {
        return input.sharedAccountId
            ? { accountId: input.sharedAccountId }
            : { error: 'NO_DRAWER' };
    }

    if (!input.storeId) return { error: 'NO_BRANCH' };
    if (!input.branchDrawer || input.branchDrawer.storeId !== input.storeId) return { error: 'NO_DRAWER' };
    return { accountId: input.branchDrawer.id };
}

/**
 * A stamped drawer line must be the voucher's branch. An unstamped cash account
 * (no store_id yet) is left alone so posting still works before the sync.
 * A bank or wallet line is allowed on any branch.
 */
export function manualDrawerProblem(
    voucherStoreId: string | null | undefined,
    account: { id: string; name: string; category: string; store_id: string | null },
    walletAccountIds: ReadonlySet<string> = new Set(),
): 'NO_BRANCH' | 'DRAWER_BRANCH_MISMATCH' | null {
    if (!account.store_id || !isCashDrawer(account, walletAccountIds)) return null;
    if (!voucherStoreId) return 'NO_BRANCH';
    if (account.store_id !== voucherStoreId) return 'DRAWER_BRANCH_MISMATCH';
    return null;
}
