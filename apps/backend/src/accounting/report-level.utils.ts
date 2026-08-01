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

export type LevelledRef = { id: string; name: string; code?: string | null };

export type LevelledAccount = {
    id: string;
    name: string;
    code?: string | null;
    type: string;
    group: LevelledRef;
    subgroup?: LevelledRef | null;
};

export type LevelBucket = {
    /** Stable identity used for de-duplication while rolling up. */
    key: string;
    /** Account id, subgroup id, or group id depending on level. */
    id: string;
    name: string;
    code: string | null;
    type: string;
    group: { id: string; name: string; code: string | null };
    subgroup: { id: string; name: string; code: string | null } | null;
    is_unassigned: boolean;
};

/**
 * Hierarchical order: codes are fixed-width and prefix-nested, so a plain string
 * sort over them *is* the chart-of-accounts order. Rows without a code (a
 * synthetic bucket, or a tenant mid-backfill) fall back to the name so the
 * ordering never collapses.
 */
export function compareByCodeThenName(
    a: { name: string; code?: string | null },
    b: { name: string; code?: string | null },
) {
    if (a.code && b.code && a.code !== b.code) {
        return a.code < b.code ? -1 : 1;
    }
    if (Boolean(a.code) !== Boolean(b.code)) {
        return a.code ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
}

/**
 * The bucket an account rolls into at the requested level.
 *
 * The bucket key is always prefixed with the account type: a group may legally
 * hold accounts of mixed type, and netting an asset against an expense would be
 * meaningless. Mixed groups therefore split into one row per type.
 */
export function bucketForAccount(account: LevelledAccount, level: ReportLevel): LevelBucket {
    const group = {
        id: account.group.id,
        name: account.group.name,
        code: account.group.code ?? null,
    };
    const subgroup = account.subgroup
        ? {
            id: account.subgroup.id,
            name: account.subgroup.name,
            code: account.subgroup.code ?? null,
          }
        : null;

    if (level === ReportLevel.GROUP) {
        return {
            key: `${account.type}:grp:${group.id}`,
            id: group.id,
            name: group.name,
            code: group.code,
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
            // The unassigned bucket sits directly under the group, which is exactly
            // what the reserved `00` account slot means.
            code: subgroup?.code ?? (group.code ? `${group.code}00` : null),
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
 * Fold account-grained rows into level buckets. Every level comes back in
 * chart-of-accounts order — account rows included, since a report that lists
 * accounts by whatever order the query returned reads as unsorted next to the
 * codes it now prints.
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

    return sortLevelEntries(Array.from(buckets.values()));
}

/** Group order, then real subgroups before the synthetic unassigned bucket, then row order. */
export function sortLevelEntries<T>(entries: Array<LevelBucketEntry<T>>) {
    return [...entries].sort((a, b) => {
        const groupCompare = compareByCodeThenName(a.bucket.group, b.bucket.group);
        if (groupCompare !== 0) {
            return groupCompare;
        }
        if (a.bucket.is_unassigned !== b.bucket.is_unassigned) {
            return a.bucket.is_unassigned ? 1 : -1;
        }
        return compareByCodeThenName(a.bucket, b.bucket);
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
