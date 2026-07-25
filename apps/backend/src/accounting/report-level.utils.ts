import { BadRequestException } from '@nestjs/common';
import {
    CompareAmounts,
    finalizeCompareAmounts,
    roundReportAmount,
} from './report-scope.utils';
import { TOTAL_SCOPE_KEY } from './accounting.constants';

/**
 * Reporting detail level: how coarse the rows of a COA-grained report are.
 * Orthogonal to ReportScope (which vouchers) — the two compose freely.
 */
export const ReportLevel = {
    ACCOUNT: 'account',
    SUBGROUP: 'subgroup',
    GROUP: 'group',
} as const;

export type ReportLevel = (typeof ReportLevel)[keyof typeof ReportLevel];

export const REPORT_LEVELS: string[] = Object.values(ReportLevel);

/** Synthetic bucket for accounts that have no subgroup, rendered under their group. */
export const UNASSIGNED_SUBGROUP_KEY = '__none__';

export function unassignedSubgroupLabel(groupName: string) {
    return `${groupName} — Unassigned`;
}

export function normalizeReportLevel(level?: string): ReportLevel {
    if (!level) {
        return ReportLevel.ACCOUNT;
    }
    if (
        level === ReportLevel.ACCOUNT
        || level === ReportLevel.SUBGROUP
        || level === ReportLevel.GROUP
    ) {
        return level;
    }
    throw new BadRequestException(`Invalid report level: ${level}`);
}

export type LevelledAccount = {
    id: string;
    name: string;
    code?: string | null;
    type: string;
    group: { id: string; name: string };
    subgroup?: { id: string; name: string } | null;
};

export type LevelBucket = {
    /** Stable identity used for de-duplication while rolling up. */
    key: string;
    /** Account id, subgroup id, or group id depending on level. */
    id: string;
    name: string;
    code: string | null;
    type: string;
    group: { id: string; name: string };
    subgroup: { id: string; name: string } | null;
    is_unassigned: boolean;
};

/**
 * The bucket an account rolls into at the requested level.
 *
 * The bucket key is always prefixed with the account type: a group may legally
 * hold accounts of mixed type, and netting an asset against an expense would be
 * meaningless. Mixed groups therefore split into one row per type.
 */
export function bucketForAccount(account: LevelledAccount, level: ReportLevel): LevelBucket {
    const group = { id: account.group.id, name: account.group.name };
    const subgroup = account.subgroup
        ? { id: account.subgroup.id, name: account.subgroup.name }
        : null;

    if (level === ReportLevel.GROUP) {
        return {
            key: `${account.type}:grp:${group.id}`,
            id: group.id,
            name: group.name,
            code: null,
            type: account.type,
            group,
            subgroup: null,
            is_unassigned: false,
        };
    }

    if (level === ReportLevel.SUBGROUP) {
        return {
            key: `${account.type}:sub:${group.id}:${subgroup?.id ?? UNASSIGNED_SUBGROUP_KEY}`,
            id: subgroup?.id ?? `${group.id}:${UNASSIGNED_SUBGROUP_KEY}`,
            name: subgroup?.name ?? unassignedSubgroupLabel(group.name),
            code: null,
            type: account.type,
            group,
            subgroup,
            is_unassigned: !subgroup,
        };
    }

    return {
        key: `${account.type}:acct:${account.id}`,
        id: account.id,
        name: account.name,
        code: account.code ?? null,
        type: account.type,
        group,
        subgroup,
        is_unassigned: false,
    };
}

export type LevelBucketEntry<T> = { bucket: LevelBucket; payload: T };

/**
 * Fold account-grained rows into level buckets. At `account` level every account
 * is its own bucket and the input order is preserved, so callers get byte-identical
 * output to the pre-level behaviour.
 */
export function rollUpByLevel<T>(
    items: Array<{ account: LevelledAccount; payload: T }>,
    level: ReportLevel,
    merge: (existing: T, incoming: T) => T,
): Array<LevelBucketEntry<T>> {
    const buckets = new Map<string, LevelBucketEntry<T>>();

    for (const item of items) {
        const bucket = bucketForAccount(item.account, level);
        const existing = buckets.get(bucket.key);
        if (existing) {
            existing.payload = merge(existing.payload, item.payload);
            continue;
        }
        buckets.set(bucket.key, { bucket, payload: item.payload });
    }

    const entries = Array.from(buckets.values());
    return level === ReportLevel.ACCOUNT ? entries : sortLevelEntries(entries);
}

/** Group name, then real subgroups before the synthetic unassigned bucket, then name. */
export function sortLevelEntries<T>(entries: Array<LevelBucketEntry<T>>) {
    return [...entries].sort((a, b) => {
        const groupCompare = a.bucket.group.name.localeCompare(b.bucket.group.name);
        if (groupCompare !== 0) {
            return groupCompare;
        }
        if (a.bucket.is_unassigned !== b.bucket.is_unassigned) {
            return a.bucket.is_unassigned ? 1 : -1;
        }
        return a.bucket.name.localeCompare(b.bucket.name);
    });
}

/** Per-column addition for compare-scope payloads, recomputing the `total` column. */
export function mergeCompareAmountsByColumn(
    existing: CompareAmounts,
    incoming: CompareAmounts,
    columnKeys: string[],
): CompareAmounts {
    const next = { ...existing };
    for (const key of columnKeys) {
        if (key === TOTAL_SCOPE_KEY) {
            continue;
        }
        next[key] = roundReportAmount((next[key] ?? 0) + (incoming[key] ?? 0));
    }
    return finalizeCompareAmounts(next, columnKeys);
}
