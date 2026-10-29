import { ONLINE_BRANCH_NAME } from './party-branch.utils';

export type BranchRef = { id: string; name: string; createdAt: string };

export type DrawerAccount = {
    id: string;
    name: string;
    code: string | null;
    category: string;
    createdAt: string;
    storeId: string | null;
};

export type DrawerLine = {
    detailId: string;
    voucherId: string;
    voucherNumber: string;
    voucherDate: string;
    accountId: string;
    storeId: string | null;
    sourceStoreId: string | null;
    partyStoreId: string | null;
    debit: number;
    credit: number;
};

export type BranchBooksInput = {
    branches: BranchRef[];
    accounts: DrawerAccount[];
    walletAccountIds: string[];
    lines: DrawerLine[];
    rulesAndMethodsPointingAt: { accountId: string }[];
};

export type BranchBooksPlan = {
    aborted: boolean;
    unplaced: { voucherNumber: string; voucherDate: string; accountName: string; debit: number; credit: number }[];
    voucherBranches: { voucherId: string; storeId: string }[];
    drawerAssignments: { accountId: string; storeId: string }[];
    newDrawers: { storeId: string; name: string; cloneFromAccountId: string }[];
    lineMoves: { detailId: string; fromAccountId: string; toAccountId: string }[];
    retargets: { fromAccountId: string; toAccountId: string }[];
    retireAccountIds: string[];
    blockedRetire: { accountId: string; reason: string }[];
};

export type EmployeeBranchInput = {
    branches: BranchRef[];
    userStoreIds: readonly string[];
    punchCounts: readonly { storeId: string; count: number }[];
};

export type CashMethodInput = {
    methods: readonly {
        id: string;
        name: string;
        type: string;
        accountId: string | null;
        allBranches: boolean;
        storeIds: readonly string[];
    }[];
    drawers: readonly { accountId: string; storeId: string }[];
};

export type CashMethodPlan = {
    updates: { methodId: string; accountId: string; storeId: string }[];
    creates: { name: string; storeId: string; accountId: string; copyFromMethodId: string }[];
};

const WALLET_NAMES = new Set(['bKash Account', 'Nagad Account']);

const EMPTY_PLAN: BranchBooksPlan = {
    aborted: false,
    unplaced: [],
    voucherBranches: [],
    drawerAssignments: [],
    newDrawers: [],
    lineMoves: [],
    retargets: [],
    retireAccountIds: [],
    blockedRetire: [],
};

export function isCashDrawer(
    account: { id: string; name: string; category: string },
    walletAccountIds: ReadonlySet<string>,
): boolean {
    if (account.category !== 'cash') return false;
    if (walletAccountIds.has(account.id)) return false;
    if (WALLET_NAMES.has(account.name)) return false;
    return true;
}

function physicalBranches(branches: readonly BranchRef[]): BranchRef[] {
    const online = ONLINE_BRANCH_NAME.toLowerCase();
    return branches.filter((branch) => branch.name.trim().toLowerCase() !== online);
}

export function mainBranch(branches: readonly BranchRef[]): BranchRef | null {
    const physical = physicalBranches(branches).slice();
    physical.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    return physical[0] ?? null;
}

function older(a: BranchRef, b: BranchRef): BranchRef {
    const byDate = a.createdAt.localeCompare(b.createdAt);
    if (byDate !== 0) return byDate < 0 ? a : b;
    return a.id.localeCompare(b.id) <= 0 ? a : b;
}

export function planBranchBooks(input: BranchBooksInput): BranchBooksPlan {
    const accountsById = new Map(input.accounts.map((account) => [account.id, account]));
    const branchById = new Map(physicalBranches(input.branches).map((branch) => [branch.id, branch]));
    const physical = physicalBranches(input.branches);
    const walletIds = new Set(input.walletAccountIds);

    const placed: DrawerLine[] = [];
    const voucherBranches: BranchBooksPlan['voucherBranches'] = [];
    const unplaced: BranchBooksPlan['unplaced'] = [];

    for (const raw of input.lines) {
        if (raw.storeId) {
            placed.push(raw);
            continue;
        }
        const storeId = raw.sourceStoreId ?? raw.partyStoreId ?? (physical.length === 1 ? physical[0].id : null);
        if (!storeId) {
            unplaced.push({
                voucherNumber: raw.voucherNumber,
                voucherDate: raw.voucherDate,
                accountName: accountsById.get(raw.accountId)?.name ?? raw.accountId,
                debit: raw.debit,
                credit: raw.credit,
            });
            continue;
        }
        placed.push({ ...raw, storeId });
        voucherBranches.push({ voucherId: raw.voucherId, storeId });
    }

    if (unplaced.length > 0) {
        return { ...EMPTY_PLAN, aborted: true, unplaced };
    }

    const counts = new Map<string, Map<string, number>>();
    for (const row of placed) {
        if (!row.storeId) continue;
        const byStore = counts.get(row.accountId) ?? new Map<string, number>();
        byStore.set(row.storeId, (byStore.get(row.storeId) ?? 0) + 1);
        counts.set(row.accountId, byStore);
    }

    const assignment = new Map<string, string>();
    for (const account of input.accounts) {
        if (!isCashDrawer(account, walletIds)) continue;
        if (account.storeId && branchById.has(account.storeId)) {
            assignment.set(account.id, account.storeId);
            continue;
        }
        const byStore = counts.get(account.id);
        if (!byStore) continue;
        let bestStore: string | null = null;
        let bestCount = -1;
        for (const [storeId, count] of byStore) {
            const branch = branchById.get(storeId);
            if (!branch) continue;
            if (bestStore === null || count > bestCount) {
                bestStore = storeId;
                bestCount = count;
                continue;
            }
            if (count === bestCount && older(branch, branchById.get(bestStore)!) === branch) {
                bestStore = storeId;
            }
        }
        if (bestStore) assignment.set(account.id, bestStore);
    }

    const branchesWithLines: string[] = [];
    const seenBranches = new Set<string>();
    for (const row of placed) {
        if (!row.storeId || seenBranches.has(row.storeId)) continue;
        seenBranches.add(row.storeId);
        branchesWithLines.push(row.storeId);
    }

    const drawerOfBranch = new Map<string, string>();
    const newDrawers: BranchBooksPlan['newDrawers'] = [];
    const drawerAssignments: BranchBooksPlan['drawerAssignments'] = [];

    const share = (accountId: string, storeId: string) => {
        const byStore = counts.get(accountId);
        if (!byStore) return 0;
        let total = 0;
        for (const count of byStore.values()) total += count;
        return total === 0 ? 0 : (byStore.get(storeId) ?? 0) / total;
    };

    for (const storeId of branchesWithLines) {
        const candidates = [...assignment.entries()].filter(([, assigned]) => assigned === storeId).map(([id]) => id);
        if (candidates.length === 0) {
            const leaving = new Map<string, number>();
            for (const row of placed) {
                if (row.storeId !== storeId) continue;
                leaving.set(row.accountId, (leaving.get(row.accountId) ?? 0) + 1);
            }
            let cloneFrom = '';
            let best = -1;
            for (const [accountId, count] of leaving) {
                if (count > best) {
                    cloneFrom = accountId;
                    best = count;
                }
            }
            newDrawers.push({
                storeId,
                name: accountsById.get(cloneFrom)?.name ?? 'Cash in Hand',
                cloneFromAccountId: cloneFrom,
            });
            drawerOfBranch.set(storeId, `new:${storeId}`);
            continue;
        }

        candidates.sort((a, b) => {
            const countDiff = (counts.get(b)?.get(storeId) ?? 0) - (counts.get(a)?.get(storeId) ?? 0);
            if (countDiff !== 0) return countDiff;
            const shareDiff = share(b, storeId) - share(a, storeId);
            if (shareDiff !== 0) return shareDiff;
            const created = (accountsById.get(a)?.createdAt ?? '').localeCompare(accountsById.get(b)?.createdAt ?? '');
            if (created !== 0) return created;
            return a.localeCompare(b);
        });

        drawerOfBranch.set(storeId, candidates[0]);
        drawerAssignments.push({ accountId: candidates[0], storeId });
    }

    const chosen = new Set(drawerAssignments.map((row) => row.accountId));
    const lineMoves: BranchBooksPlan['lineMoves'] = [];
    for (const row of placed) {
        if (!row.storeId) continue;
        const target = drawerOfBranch.get(row.storeId);
        if (!target || target === row.accountId) continue;
        lineMoves.push({ detailId: row.detailId, fromAccountId: row.accountId, toAccountId: target });
    }

    const destinations = new Map<string, Set<string>>();
    for (const move of lineMoves) {
        const set = destinations.get(move.fromAccountId) ?? new Set<string>();
        set.add(move.toAccountId);
        destinations.set(move.fromAccountId, set);
    }
    const staying = new Set<string>();
    for (const row of placed) {
        if (!row.storeId) continue;
        if (drawerOfBranch.get(row.storeId) === row.accountId) staying.add(row.accountId);
    }

    const pointed = new Set(input.rulesAndMethodsPointingAt.map((row) => row.accountId));
    const retireAccountIds: string[] = [];
    const blockedRetire: BranchBooksPlan['blockedRetire'] = [];
    const retargets: BranchBooksPlan['retargets'] = [];

    for (const account of input.accounts) {
        if (!isCashDrawer(account, walletIds)) continue;
        if (chosen.has(account.id)) continue;
        if (!counts.has(account.id)) continue;
        if (staying.has(account.id)) continue;
        const movedTo = destinations.get(account.id);
        if (!movedTo || movedTo.size === 0) continue;
        if (movedTo.size > 1) {
            blockedRetire.push({ accountId: account.id, reason: 'lines moved to more than one drawer' });
            continue;
        }
        const toAccountId = [...movedTo][0];
        retireAccountIds.push(account.id);
        if (pointed.has(account.id)) retargets.push({ fromAccountId: account.id, toAccountId });
    }

    return {
        aborted: false,
        unplaced: [],
        voucherBranches,
        drawerAssignments,
        newDrawers,
        lineMoves,
        retargets,
        retireAccountIds,
        blockedRetire,
    };
}

export function planEmployeeBranch(input: EmployeeBranchInput): { storeId: string; fallbackToMain: boolean } {
    const physical = physicalBranches(input.branches);
    if (physical.length === 1) return { storeId: physical[0].id, fallbackToMain: false };
    if (input.userStoreIds.length === 1) return { storeId: input.userStoreIds[0], fallbackToMain: false };

    let best: { storeId: string; count: number } | null = null;
    let tied = false;
    for (const punch of input.punchCounts) {
        if (!best || punch.count > best.count) {
            best = { storeId: punch.storeId, count: punch.count };
            tied = false;
        } else if (punch.count === best.count) {
            tied = true;
        }
    }
    if (best && !tied) return { storeId: best.storeId, fallbackToMain: false };

    return { storeId: mainBranch(input.branches)?.id ?? '', fallbackToMain: true };
}

export function planPayrollStore(employeeStoreIds: readonly (string | null)[]): string | null {
    if (employeeStoreIds.length === 0) return null;
    if (employeeStoreIds.some((storeId) => storeId == null)) return null;
    const distinct = new Set(employeeStoreIds);
    return distinct.size === 1 ? [...distinct][0]! : null;
}

export function planCashMethods(input: CashMethodInput): CashMethodPlan {
    const drawerByAccount = new Map(input.drawers.map((drawer) => [drawer.accountId, drawer]));
    const cashMethods = input.methods.filter((method) => method.type === 'Cash');
    const covered = new Set<string>();
    const updates: CashMethodPlan['updates'] = [];
    let copyFromMethodId = cashMethods[0]?.id ?? '';

    for (const method of cashMethods) {
        if (!method.accountId) continue;
        const drawer = drawerByAccount.get(method.accountId);
        if (!drawer) continue;
        const already =
            !method.allBranches &&
            method.storeIds.length === 1 &&
            method.storeIds[0] === drawer.storeId;
        if (already) {
            covered.add(drawer.storeId);
            continue;
        }
        updates.push({ methodId: method.id, accountId: drawer.accountId, storeId: drawer.storeId });
        covered.add(drawer.storeId);
        copyFromMethodId = method.id;
    }

    const creates: CashMethodPlan['creates'] = [];
    for (const drawer of input.drawers) {
        if (covered.has(drawer.storeId)) continue;
        creates.push({
            name: 'Cash',
            storeId: drawer.storeId,
            accountId: drawer.accountId,
            copyFromMethodId,
        });
    }

    return { updates, creates };
}
