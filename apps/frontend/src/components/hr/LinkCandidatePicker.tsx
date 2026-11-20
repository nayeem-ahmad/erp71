'use client';

import { useMemo, useState } from 'react';
import { LinkIcon, Loader2 } from 'lucide-react';
import type { EmployeeLinkMatch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { Button, Input, StatusBadge } from '@/components/ui';

export interface LinkCandidateRow {
    id: string;
    primary: string;
    /** Second line: email, mobile, employee code — whatever tells two Karims apart. */
    secondary?: string | null;
    matches: EmployeeLinkMatch[];
    /** Extra text the search should reach that is not shown, e.g. a raw mobile number. */
    searchText?: string;
}

/**
 * A searchable list of logins or employee cards to link, likeliest first.
 *
 * Used both ways round: on the employee page it lists logins, on the Team page
 * it lists employee cards. The server ranks the rows; this only filters them
 * and labels why each one looks like a match, so the person choosing can tell
 * a matching mobile number from a coincidence of names.
 */
export default function LinkCandidatePicker({
    rows,
    loading,
    error,
    hint,
    searchPlaceholder,
    emptyText,
    busyId,
    onLink,
}: {
    rows: LinkCandidateRow[];
    loading: boolean;
    error?: string | null;
    hint?: string;
    searchPlaceholder: string;
    /** Shown when there is nothing to link at all, as opposed to nothing matching the search. */
    emptyText: string;
    busyId?: string | null;
    onLink: (id: string) => void;
}) {
    const { t } = useI18n();
    const tl = t.employees.detail.linking;
    const [query, setQuery] = useState('');

    const matchLabel: Record<EmployeeLinkMatch, string> = {
        mobile: tl.matchMobile,
        email: tl.matchEmail,
        name: tl.matchName,
    };

    const visible = useMemo(() => {
        const needle = query.trim().toLowerCase();
        if (!needle) return rows;
        return rows.filter((row) =>
            [row.primary, row.secondary, row.searchText]
                .filter(Boolean)
                .some((text) => String(text).toLowerCase().includes(needle)),
        );
    }, [rows, query]);

    if (loading) {
        return (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-500">
                <Loader2 className="h-4 w-4 animate-spin" /> {t.employees.detail.loading}
            </div>
        );
    }
    if (error) return <p className="text-sm text-red-600">{error}</p>;
    if (rows.length === 0) return <p className="text-sm text-gray-500">{emptyText}</p>;

    return (
        <div className="space-y-2">
            {hint && <p className="text-xs text-gray-500">{hint}</p>}
            <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
            />
            {visible.length === 0 ? (
                <p className="text-sm text-gray-500">{tl.noResults}</p>
            ) : (
                <ul className="max-h-72 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-100">
                    {visible.map((row) => (
                        <li key={row.id} className="flex min-h-touch items-center justify-between gap-3 px-3 py-2">
                            <div className="min-w-0 space-y-0.5">
                                <p className="truncate text-sm font-medium text-gray-900">{row.primary}</p>
                                {row.secondary && <p className="truncate text-xs text-gray-500">{row.secondary}</p>}
                                {row.matches.length > 0 && (
                                    <div className="flex flex-wrap gap-1 pt-0.5">
                                        {row.matches.map((match) => (
                                            <StatusBadge key={match} tone={match === 'name' ? 'neutral' : 'success'}>
                                                {matchLabel[match]}
                                            </StatusBadge>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <Button
                                type="button"
                                variant="secondary"
                                loading={busyId === row.id}
                                disabled={Boolean(busyId) && busyId !== row.id}
                                onClick={() => onLink(row.id)}
                                icon={<LinkIcon className="h-4 w-4" />}
                            >
                                {tl.action}
                            </Button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
