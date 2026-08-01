/**
 * Fills in hierarchical chart-of-accounts codes for a tenant that predates them.
 *
 * Why this is TypeScript and not SQL in the migration
 * ---------------------------------------------------
 * Production does not run migrations. The backend container reconciles the
 * schema with `prisma db push --accept-data-loss` on every boot (see
 * apps/backend/Dockerfile), so a backfill living in a migration would never
 * execute there. Running it from the boot chain instead means the ONE
 * implementation covers both paths, and it reuses account-code.ts rather than
 * restating the codec in PL/pgSQL where the two could drift.
 *
 * Ordering matters: this runs before bootstrapDefaultAccountingForTenant, which
 * needs its groups to already have codes to hang new subgroups off.
 *
 * Idempotent and cheap on the happy path — it runs on every deploy forever, so
 * a tenant whose codes are already correct costs three indexed reads and no
 * writes.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import {
    ACCOUNT_CODE_LENGTH,
    ACCOUNT_SERIAL_WIDTH,
    GROUP_CODE_LENGTH,
    NO_SUBGROUP_SLOT,
    SUBGROUP_CODE_LENGTH,
    accountCodePrefix,
    nextChildCode,
    nextGroupCode,
    nextSubgroupCode,
} from './account-code.js';

type BackfillClient = PrismaClient | Prisma.TransactionClient;

/**
 * Codes pinned by name, so a tenant that predates this lands on exactly what a
 * freshly bootstrapped one gets. "110101 is Cash in Hand" has to be true on
 * every tenant for support to be able to lean on it.
 *
 * Only applied when the row still sits where the template put it — a group or
 * subgroup the tenant has since renamed or re-parented gets an allocated code
 * instead, so the prefix invariant holds rather than a pinned code lying about
 * where it sits.
 */
const PINNED_GROUP_CODES: Record<string, string> = {
    'Current Assets': '11',
    'Non-Current Assets': '12',
    'Current Liabilities': '21',
    'Owner Equity': '31',
    'Operating Revenue': '41',
    'Operating Expenses': '51',
};

/** Keyed `<group name>/<subgroup name>` — "Inter-Branch Clearing" exists twice. */
const PINNED_SUBGROUP_CODES: Record<string, string> = {
    'Current Assets/Cash and Bank': '1101',
    'Current Assets/Receivables': '1102',
    'Current Assets/Loans Receivable': '1103',
    'Current Assets/Inter-Branch Clearing': '1104',
    'Non-Current Assets/Fixed Assets': '1201',
    'Current Liabilities/Trade Payables': '2101',
    'Current Liabilities/Loans Payable': '2102',
    'Current Liabilities/Payroll': '2103',
    'Current Liabilities/Inter-Branch Clearing': '2104',
    'Owner Equity/Capital': '3101',
    'Operating Revenue/Sales': '4101',
    'Operating Expenses/Cost of Sales': '5101',
    'Operating Expenses/General Expenses': '5102',
};

/** Keyed `<subgroup code>/<account name>`, so a moved account is never pinned. */
const PINNED_ACCOUNT_CODES: Record<string, string> = {
    '1101/Cash in Hand': '110101',
    '1101/Main Bank Account': '110102',
    '1101/bKash Account': '110103',
    '1101/Nagad Account': '110104',
    '1102/Accounts Receivable': '110201',
    '1102/Staff Advances': '110202',
    '1103/Loans Receivable': '110301',
    '1104/Due from Branches': '110401',
    '1201/Fixed Assets': '120101',
    '1201/Accumulated Depreciation': '120102',
    '2101/Purchase Payable': '210101',
    '2102/Loans Payable': '210201',
    '2103/Salary Payable': '210301',
    '2104/Due to Branches': '210401',
    '3101/Owner\'s Equity': '310101',
    '4101/Sales Revenue': '410101',
    '5101/Purchases': '510101',
    '5102/General Operating Expense': '510201',
    '5102/Salary & Wages': '510202',
    '5102/Depreciation Expense': '510203',
};

export interface AccountCodeBackfillResult {
    groups: number;
    subgroups: number;
    accounts: number;
}

const isBlank = (code: string | null | undefined) => !code || code.trim() === '';

/**
 * Assign codes to `rows`, pinned slots first.
 *
 * The two passes are the whole point. Interleaving them lets a tenant-made row
 * that happens to sort earlier take a pinned slot -- a subgroup called "Petty
 * Cash Floats" grabs 1102 and pushes "Receivables" to 1103 -- which quietly
 * breaks the property the pinning exists for: that 1102 is Receivables on every
 * tenant. Reserving every pinned code before allocating anything keeps template
 * rows on their canonical codes and pushes the tenant's own rows after them.
 */
function assignCodes<T extends { id: string }>(
    rows: T[],
    taken: Set<string>,
    pinnedFor: (row: T) => string | undefined,
    parentFor: (row: T) => string | null,
    allocate: (row: T, taken: Set<string>) => string,
): Map<string, string> {
    const assigned = new Map<string, string>();

    for (const row of rows) {
        const pinned = pinnedFor(row);
        if (!pinned || taken.has(pinned)) continue;

        const parent = parentFor(row);
        if (parent !== null && !pinned.startsWith(parent)) continue;

        assigned.set(row.id, pinned);
        taken.add(pinned);
    }

    for (const row of rows) {
        if (assigned.has(row.id)) continue;
        const code = allocate(row, taken);
        assigned.set(row.id, code);
        taken.add(code);
    }

    return assigned;
}

export async function backfillAccountCodesForTenant(
    db: BackfillClient,
    tenantId: string,
): Promise<AccountCodeBackfillResult> {
    const [groups, subgroups, accounts] = await Promise.all([
        db.accountGroup.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, code: true, type: true },
            orderBy: [{ created_at: 'asc' }, { name: 'asc' }],
        }),
        db.accountSubgroup.findMany({
            where: { tenant_id: tenantId },
            select: { id: true, name: true, code: true, group_id: true },
            orderBy: [{ created_at: 'asc' }, { name: 'asc' }],
        }),
        db.account.findMany({
            where: { tenant_id: tenantId },
            select: {
                id: true,
                name: true,
                code: true,
                legacy_code: true,
                group_id: true,
                subgroup_id: true,
            },
            // Old flat codes first, so a tenant's own intended ordering inside a
            // subgroup (1010 before 1020) survives into the new serials.
            orderBy: [{ code: 'asc' }, { created_at: 'asc' }, { name: 'asc' }],
        }),
    ]);

    const result: AccountCodeBackfillResult = { groups: 0, subgroups: 0, accounts: 0 };

    // ── Groups ──────────────────────────────────────────────────────────────
    const groupCodes = new Map<string, string>();
    const takenGroupCodes = new Set<string>();
    const groupsNeedingCode: typeof groups = [];

    for (const group of groups) {
        if (group.code.length === GROUP_CODE_LENGTH) {
            groupCodes.set(group.id, group.code);
            takenGroupCodes.add(group.code);
        } else {
            groupsNeedingCode.push(group);
        }
    }

    for (const [id, code] of assignCodes<(typeof groups)[number]>(
        groupsNeedingCode,
        takenGroupCodes,
        (group) => PINNED_GROUP_CODES[group.name],
        () => null,
        (group, taken) => nextGroupCode(group.type, [...taken]),
    )) {
        groupCodes.set(id, code);
        await db.accountGroup.update({ where: { id }, data: { code } });
        result.groups += 1;
    }

    // ── Subgroups ───────────────────────────────────────────────────────────
    const groupNames = new Map(groups.map((group) => [group.id, group.name]));
    const subgroupCodes = new Map<string, string>();
    const takenSubgroupCodes = new Set<string>();
    const subgroupsNeedingCode: typeof subgroups = [];

    for (const subgroup of subgroups) {
        const groupCode = groupCodes.get(subgroup.group_id);
        if (!groupCode) continue;

        // A subgroup also needs re-coding when its code no longer sits under its
        // group, which re-coding the group above can leave behind.
        if (subgroup.code.length === SUBGROUP_CODE_LENGTH && subgroup.code.startsWith(groupCode)) {
            subgroupCodes.set(subgroup.id, subgroup.code);
            takenSubgroupCodes.add(subgroup.code);
        } else {
            subgroupsNeedingCode.push(subgroup);
        }
    }

    const subgroupParent = (subgroup: { group_id: string }) =>
        groupCodes.get(subgroup.group_id) ?? null;

    for (const [id, code] of assignCodes<(typeof subgroups)[number]>(
        subgroupsNeedingCode,
        takenSubgroupCodes,
        (subgroup) =>
            PINNED_SUBGROUP_CODES[`${groupNames.get(subgroup.group_id) ?? ''}/${subgroup.name}`],
        subgroupParent,
        (subgroup, taken) => nextSubgroupCode(subgroupParent(subgroup) ?? '', [...taken]),
    )) {
        subgroupCodes.set(id, code);
        await db.accountSubgroup.update({ where: { id }, data: { code } });
        result.subgroups += 1;
    }

    // ── Accounts ────────────────────────────────────────────────────────────
    const takenAccountCodes = new Set<string>();
    const accountsNeedingCode: typeof accounts = [];
    const prefixes = new Map<string, string>();

    for (const account of accounts) {
        const groupCode = groupCodes.get(account.group_id);
        if (!groupCode) continue;

        const subgroupCode = account.subgroup_id
            ? subgroupCodes.get(account.subgroup_id) ?? null
            : null;
        const prefix = accountCodePrefix(groupCode, subgroupCode);
        prefixes.set(account.id, prefix);

        if (account.code?.length === ACCOUNT_CODE_LENGTH && account.code.startsWith(prefix)) {
            takenAccountCodes.add(account.code);
        } else {
            accountsNeedingCode.push(account);
        }
    }

    const accountsById = new Map(accounts.map((account) => [account.id, account]));

    for (const [id, code] of assignCodes<(typeof accounts)[number]>(
        accountsNeedingCode,
        takenAccountCodes,
        (account) => {
            const prefix = prefixes.get(account.id) ?? '';
            // Keyed on the subgroup code, so an account the tenant moved out of
            // its template subgroup is never pinned -- it is allocated under the
            // parent it actually has, and the prefix invariant holds.
            const subgroupCode = prefix.endsWith(NO_SUBGROUP_SLOT) ? '' : prefix;
            return PINNED_ACCOUNT_CODES[`${subgroupCode}/${account.name}`];
        },
        (account) => prefixes.get(account.id) ?? null,
        (account, taken) => {
            const prefix = prefixes.get(account.id) ?? '';
            return nextChildCode(prefix, [...taken], ACCOUNT_SERIAL_WIDTH);
        },
    )) {
        const account = accountsById.get(id);
        // Keep the old flat number: it is on the tenant's printed paperwork, and
        // it is the only way they can find an account by the code they know.
        const legacyCode =
            isBlank(account?.legacy_code) && !isBlank(account?.code)
                ? account?.code
                : account?.legacy_code;

        await db.account.update({ where: { id }, data: { code, legacy_code: legacyCode } });
        result.accounts += 1;
    }

    return result;
}

/** True when nothing on this tenant needs re-coding. */
export function isBackfillEmpty(result: AccountCodeBackfillResult): boolean {
    return result.groups === 0 && result.subgroups === 0 && result.accounts === 0;
}
