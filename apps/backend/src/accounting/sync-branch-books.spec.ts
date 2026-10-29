import {
    isCashDrawer,
    mainBranch,
    planBranchBooks,
    planCashMethods,
    planEmployeeBranch,
    planPayrollStore,
    type BranchBooksInput,
    type BranchRef,
} from '@erp71/database/prisma/sync-branch-books.utils';

const BB = '5998f11f-70ff-4eec-a1c8-c42418cd461b';
const PC = '501fed1b-9732-44fa-98b1-271fae2bc135';
const CF = 'f5a45408-79b0-4b70-b3af-bc2fe806085d';
const LT = '9df1d62c-b797-4111-9ffc-17a22862c4f0';
const HAND = 'cash-in-hand-110113';
const PREMIER = 'premier-110102';
const BKASH = 'bkash-110103';
const UPAY = 'upay-wallet';

const branches: BranchRef[] = [
    { id: BB, name: 'Babu Bazar', createdAt: '2020-01-01T00:00:00.000Z' },
    { id: PC, name: 'Press Club', createdAt: '2020-06-01T00:00:00.000Z' },
    { id: 'online', name: 'Online Store', createdAt: '2019-01-01T00:00:00.000Z' },
];

const drawer = (
    id: string,
    name: string,
    code: string,
    createdAt: string,
    storeId: string | null = null,
) => ({ id, name, code, category: 'cash', createdAt, storeId });

function line(partial: Partial<BranchBooksInput['lines'][number]> & Pick<BranchBooksInput['lines'][number], 'detailId' | 'accountId'>): BranchBooksInput['lines'][number] {
    return {
        voucherId: partial.detailId,
        voucherNumber: partial.detailId,
        voucherDate: '2026-01-01',
        storeId: null,
        sourceStoreId: null,
        partyStoreId: null,
        debit: 1,
        credit: 0,
        ...partial,
    };
}

function repeat(
    count: number,
    accountId: string,
    storeId: string | null,
    prefix: string,
): BranchBooksInput['lines'] {
    return Array.from({ length: count }, (_, i) =>
        line({ detailId: `${prefix}-${i}`, accountId, storeId, voucherId: `${prefix}-v-${i}` }),
    );
}

const khAccounts = [
    drawer(CF, 'Main Cash (CF)', '110101', '2020-01-02T00:00:00.000Z'),
    drawer(LT, 'Main Cash (LT)', '110112', '2020-06-02T00:00:00.000Z'),
    drawer(HAND, 'Cash in Hand', '110113', '2020-01-03T00:00:00.000Z'),
    { id: PREMIER, name: 'Premier Bank 186', code: '110102', category: 'bank', createdAt: '2020-01-02T00:00:00.000Z', storeId: null },
    drawer(BKASH, 'bKash Account', '110103', '2020-01-02T00:00:00.000Z'),
];

describe('isCashDrawer', () => {
    const wallets = new Set([UPAY]);

    it('rejects a bank, the named wallets, and a mobile-wallet link', () => {
        expect(isCashDrawer({ id: PREMIER, name: 'Premier Bank 186', category: 'bank' }, wallets)).toBe(false);
        expect(isCashDrawer({ id: BKASH, name: 'bKash Account', category: 'cash' }, wallets)).toBe(false);
        expect(isCashDrawer({ id: 'nagad', name: 'Nagad Account', category: 'cash' }, wallets)).toBe(false);
        expect(isCashDrawer({ id: UPAY, name: 'Upay', category: 'cash' }, wallets)).toBe(false);
    });

    it('accepts a physical cash account', () => {
        expect(isCashDrawer({ id: CF, name: 'Main Cash (CF)', category: 'cash' }, wallets)).toBe(true);
        expect(isCashDrawer({ id: HAND, name: 'Cash in Hand', category: 'cash' }, wallets)).toBe(true);
    });
});

describe('mainBranch', () => {
    it('skips Online Store and keeps the oldest physical branch', () => {
        expect(mainBranch(branches)?.id).toBe(BB);
    });
});

describe('planBranchBooks', () => {
    it('places a null-branch drawer line from the source document', () => {
        const plan = planBranchBooks({
            branches,
            accounts: khAccounts,
            walletAccountIds: [],
            rulesAndMethodsPointingAt: [],
            lines: [line({ detailId: 'pay-1', accountId: CF, sourceStoreId: PC, voucherNumber: 'CP-1' })],
        });

        expect(plan.aborted).toBe(false);
        expect(plan.voucherBranches).toEqual([{ voucherId: 'pay-1', storeId: PC }]);
    });

    it('aborts the tenant when a drawer voucher has no source and no party', () => {
        const plan = planBranchBooks({
            branches,
            accounts: khAccounts,
            walletAccountIds: [],
            rulesAndMethodsPointingAt: [],
            lines: [line({ detailId: 'lost', accountId: CF, voucherNumber: 'JV-9', debit: 50, credit: 0 })],
        });

        expect(plan.aborted).toBe(true);
        expect(plan.unplaced).toEqual([
            { voucherNumber: 'JV-9', voucherDate: '2026-01-01', accountName: 'Main Cash (CF)', debit: 50, credit: 0 },
        ]);
        expect(plan.lineMoves).toEqual([]);
        expect(plan.voucherBranches).toEqual([]);
        expect(plan.drawerAssignments).toEqual([]);
        expect(plan.newDrawers).toEqual([]);
        expect(plan.retireAccountIds).toEqual([]);
    });

    it('uses the only physical branch when nothing else names one', () => {
        const only = [branches[0]];
        const plan = planBranchBooks({
            branches: only,
            accounts: [drawer(CF, 'Main Cash (CF)', '110101', '2020-01-02T00:00:00.000Z')],
            walletAccountIds: [],
            rulesAndMethodsPointingAt: [],
            lines: [line({ detailId: 'solo', accountId: CF, voucherNumber: 'JV-1' })],
        });

        expect(plan.aborted).toBe(false);
        expect(plan.voucherBranches).toEqual([{ voucherId: 'solo', storeId: BB }]);
    });

    it('folds Press Club cash onto Main Cash (LT) and Babu Bazar cash onto Main Cash (CF)', () => {
        const plan = planBranchBooks({
            branches,
            accounts: khAccounts,
            walletAccountIds: [BKASH],
            rulesAndMethodsPointingAt: [{ accountId: HAND }],
            lines: [
                ...repeat(5376, CF, BB, 'bb-cf'),
                ...repeat(801, CF, PC, 'pc-cf'),
                ...repeat(1341, LT, PC, 'pc-lt'),
                ...repeat(3, HAND, BB, 'bb-hand'),
            ],
        });

        expect(plan.aborted).toBe(false);
        expect(plan.drawerAssignments).toEqual(expect.arrayContaining([
            { accountId: CF, storeId: BB },
            { accountId: LT, storeId: PC },
        ]));
        expect(plan.drawerAssignments).not.toEqual(expect.arrayContaining([{ accountId: HAND, storeId: BB }]));
        expect(plan.lineMoves.filter((move) => move.fromAccountId === LT)).toEqual([]);
        expect(plan.lineMoves.filter((move) => move.fromAccountId === CF && move.toAccountId === LT)).toHaveLength(801);
        expect(plan.lineMoves.filter((move) => move.fromAccountId === HAND && move.toAccountId === CF)).toHaveLength(3);
        expect(plan.lineMoves.some((move) => move.detailId.startsWith('bb-cf-'))).toBe(false);
        expect(plan.retireAccountIds).toEqual([HAND]);
        expect(plan.retargets).toEqual([{ fromAccountId: HAND, toAccountId: CF }]);
        expect(plan.newDrawers).toEqual([]);
    });

    it('clones a drawer for the branch that does not own the shared cash account', () => {
        const shared = drawer('shared', 'Cash in Hand', '110101', '2020-01-02T00:00:00.000Z');
        const plan = planBranchBooks({
            branches,
            accounts: [shared],
            walletAccountIds: [],
            rulesAndMethodsPointingAt: [],
            lines: [...repeat(10, 'shared', BB, 'bb'), ...repeat(3, 'shared', PC, 'pc')],
        });

        expect(plan.drawerAssignments).toEqual([{ accountId: 'shared', storeId: BB }]);
        expect(plan.newDrawers).toEqual([
            { storeId: PC, name: 'Cash in Hand', cloneFromAccountId: 'shared' },
        ]);
        expect(plan.lineMoves).toHaveLength(3);
        expect(plan.lineMoves.every((move) => move.toAccountId === `new:${PC}`)).toBe(true);
    });

    it('does not retire a drawer whose lines split across two branches', () => {
        const a = drawer('a', 'Main Cash (CF)', '110101', '2020-01-02T00:00:00.000Z');
        const b = drawer('b', 'Main Cash (LT)', '110112', '2020-06-02T00:00:00.000Z');
        const c = drawer('c', 'Petty Cash', '110114', '2020-03-01T00:00:00.000Z');
        const plan = planBranchBooks({
            branches,
            accounts: [a, b, c],
            walletAccountIds: [],
            rulesAndMethodsPointingAt: [{ accountId: 'c' }],
            lines: [
                ...repeat(5, 'a', BB, 'bb-a'),
                ...repeat(5, 'b', PC, 'pc-b'),
                ...repeat(2, 'c', BB, 'bb-c'),
                ...repeat(2, 'c', PC, 'pc-c'),
            ],
        });

        expect(plan.retireAccountIds).not.toContain('c');
        expect(plan.blockedRetire).toEqual([
            { accountId: 'c', reason: 'lines moved to more than one drawer' },
        ]);
        expect(plan.retargets).toEqual([]);
    });

    it('leaves an already-folded snapshot alone', () => {
        const foldedAccounts = [
            drawer(CF, 'Main Cash (CF)', '110101', '2020-01-02T00:00:00.000Z', BB),
            drawer(LT, 'Main Cash (LT)', '110112', '2020-06-02T00:00:00.000Z', PC),
        ];
        const plan = planBranchBooks({
            branches,
            accounts: foldedAccounts,
            walletAccountIds: [],
            rulesAndMethodsPointingAt: [],
            lines: [...repeat(5376, CF, BB, 'bb'), ...repeat(2142, LT, PC, 'pc')],
        });

        expect(plan.lineMoves).toEqual([]);
        expect(plan.newDrawers).toEqual([]);
        expect(plan.retireAccountIds).toEqual([]);
        expect(plan.blockedRetire).toEqual([]);
    });
});

describe('planEmployeeBranch', () => {
    it('uses the only store access', () => {
        expect(planEmployeeBranch({ branches, userStoreIds: [PC], punchCounts: [] })).toEqual({
            storeId: PC,
            fallbackToMain: false,
        });
    });

    it('prints a main-branch fallback when punches tie', () => {
        expect(
            planEmployeeBranch({
                branches,
                userStoreIds: [BB, PC],
                punchCounts: [
                    { storeId: BB, count: 2 },
                    { storeId: PC, count: 2 },
                ],
            }),
        ).toEqual({ storeId: BB, fallbackToMain: true });
    });

    it('uses the only physical branch without calling it a fallback', () => {
        expect(planEmployeeBranch({ branches: [branches[0]], userStoreIds: [], punchCounts: [] })).toEqual({
            storeId: BB,
            fallbackToMain: false,
        });
    });
});

describe('planPayrollStore', () => {
    it('stamps a run only when every employee is that one branch', () => {
        expect(planPayrollStore(['bb', 'bb'])).toBe('bb');
        expect(planPayrollStore(['bb', 'pc'])).toBeNull();
        expect(planPayrollStore(['bb', null])).toBeNull();
        expect(planPayrollStore([])).toBeNull();
    });
});

describe('planCashMethods', () => {
    const drawers = [
        { accountId: CF, storeId: BB },
        { accountId: LT, storeId: PC },
    ];

    it('splits one all-branches Cash method onto each drawer', () => {
        const plan = planCashMethods({
            methods: [
                { id: 'cash', name: 'Cash', type: 'Cash', accountId: CF, allBranches: true, storeIds: [] },
                { id: 'bank', name: 'Bank', type: 'Bank', accountId: PREMIER, allBranches: true, storeIds: [] },
            ],
            drawers,
        });

        expect(plan.updates).toEqual([{ methodId: 'cash', accountId: CF, storeId: BB }]);
        expect(plan.creates).toEqual([
            { name: 'Cash', storeId: PC, accountId: LT, copyFromMethodId: 'cash' },
        ]);
    });

    it('does nothing when each branch already has its Cash method', () => {
        const plan = planCashMethods({
            methods: [
                { id: 'cash-bb', name: 'Cash', type: 'Cash', accountId: CF, allBranches: false, storeIds: [BB] },
                { id: 'cash-pc', name: 'Cash', type: 'Cash', accountId: LT, allBranches: false, storeIds: [PC] },
            ],
            drawers,
        });

        expect(plan.updates).toEqual([]);
        expect(plan.creates).toEqual([]);
    });
});
