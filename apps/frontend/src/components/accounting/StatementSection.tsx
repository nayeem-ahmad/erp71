'use client';

import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

export interface StatementRow {
    id: string;
    name: string;
    code?: string | null;
    subgroup?: { name: string } | null;
    is_unassigned?: boolean;
    balance: number;
}

export interface StatementGroup {
    group: { id: string; name: string; code?: string | null };
    /** Rows at the requested detail level — empty when the level is `group`. */
    rows: StatementRow[];
    total: number;
}

/** Below this a balance is a rounding artefact, not a number worth a row. */
const ZERO_EPSILON = 0.005;

function isZero(amount: number) {
    return Math.abs(amount) < ZERO_EPSILON;
}

/**
 * Drop empty rows, then groups left with nothing to show.
 *
 * A group whose rows all net to zero but whose total does not is kept with its
 * header alone — the total is the server's and must stay reachable, even when no
 * individual row survives.
 */
export function hideZeroGroups(groups: StatementGroup[], hideZero: boolean): StatementGroup[] {
    if (!hideZero) return groups;

    return groups
        .map((entry) => ({ ...entry, rows: entry.rows.filter((row) => !isZero(row.balance)) }))
        .filter((entry) => entry.rows.length > 0 || !isZero(entry.total));
}

/** `110101  Cash in Hand` — the code leads, the way it does in the chart of accounts. */
export function CodedLabel({
    code,
    name,
    bold = false,
}: Readonly<{ code?: string | null; name: string; bold?: boolean }>) {
    return (
        <span className="flex min-w-0 items-baseline gap-2">
            <span className="w-14 flex-shrink-0 font-mono text-xs text-gray-400">{code || ''}</span>
            <span className={`truncate ${bold ? 'font-semibold' : ''}`}>{name}</span>
        </span>
    );
}

/**
 * One statement block (Assets, Revenue, …): a coloured heading, then each group
 * with its rows nested beneath it.
 */
export default function StatementSection({
    groups,
    label,
    colorClass,
}: Readonly<{ groups: StatementGroup[]; label: string; colorClass: string }>) {
    const { locale } = useI18n();

    return (
        <div>
            <div className={`px-3 py-1.5 rounded-lg text-xs font-medium ${colorClass} mb-2`}>
                {label}
            </div>
            {groups.map((entry) => (
                <div key={entry.group.id} className="mb-3">
                    <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-gray-50 rounded-lg text-sm text-gray-700">
                        <CodedLabel code={entry.group.code} name={entry.group.name} bold />
                        <span className="font-semibold tabular-nums">
                            {formatBDT(entry.total, { locale })}
                        </span>
                    </div>
                    {entry.rows.map((row) => (
                        <div
                            key={row.id}
                            className="flex items-center justify-between gap-2 px-5 py-1 text-sm text-gray-600"
                        >
                            <CodedLabel code={row.code} name={row.name} />
                            <span className="tabular-nums">{formatBDT(row.balance, { locale })}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
    );
}
