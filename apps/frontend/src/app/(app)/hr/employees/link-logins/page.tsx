'use client';

import { useEffect, useMemo, useState } from 'react';
import { LinkIcon, Loader2 } from 'lucide-react';
import { api, type EmployeeLinkMatch, type EmployeeLinkSuggestion } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, Checkbox, PageShell, StatusBadge } from '@/components/ui';

/**
 * Match logins to employee cards in one pass.
 *
 * For a workspace that already has both lists — staff invited to the ERP, and
 * the same people entered in HR — and would otherwise link them one employee
 * page at a time. The server offers only unambiguous pairs: a mobile or email
 * that names exactly one login and exactly one card. Everything starts ticked,
 * because that is what a clean match is, but nothing links until a person says
 * so; anyone left over is linked from their employee page.
 */
export default function LinkLoginsPage() {
    const { t, fmt } = useI18n();
    const tl = t.employees.detail.linking;
    const [pairs, setPairs] = useState<EmployeeLinkSuggestion[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [linking, setLinking] = useState(false);

    const load = async () => {
        setError(null);
        try {
            const rows = (await api.getEmployeeLinkSuggestions()) ?? [];
            setPairs(rows);
            setSelected(new Set(rows.map((row) => row.employee.id)));
        } catch (err: any) {
            setPairs([]);
            setError(err?.message || tl.loadFailed);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { void load(); }, []);

    const matchLabel: Record<EmployeeLinkMatch, string> = {
        mobile: tl.matchMobile,
        email: tl.matchEmail,
        name: tl.matchName,
    };

    const chosen = useMemo(
        () => (pairs ?? []).filter((pair) => selected.has(pair.employee.id)),
        [pairs, selected],
    );
    const allSelected = Boolean(pairs?.length) && chosen.length === pairs!.length;

    const toggle = (employeeId: string) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(employeeId)) next.delete(employeeId);
            else next.add(employeeId);
            return next;
        });
    };

    const linkSelected = async () => {
        if (chosen.length === 0) return;
        setLinking(true);
        try {
            const result = await api.linkEmployeesBulk(
                chosen.map((pair) => ({ employeeId: pair.employee.id, userId: pair.user.id })),
            );
            const failed = result.results.filter((row) => !row.ok).length;
            if (result.linked > 0) toast.success(fmt(tl.bulkLinked, { count: result.linked }));
            if (failed > 0) toast.error(fmt(tl.bulkSomeFailed, { count: failed }));
            await load();
        } catch (err: any) {
            toast.error(err?.message || t.employees.detail.linkFailed);
        } finally {
            setLinking(false);
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={tl.bulkTitle}
                subtitle={tl.bulkSubtitle}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    'hr',
                    [{ label: t.employees.title, href: routes.hr.employees }],
                    tl.bulkTitle,
                )}
                actions={
                    <Button
                        type="button"
                        loading={linking}
                        disabled={chosen.length === 0}
                        onClick={linkSelected}
                        icon={<LinkIcon className="h-4 w-4" />}
                    >
                        {fmt(tl.bulkLinkSelected, { count: chosen.length })}
                    </Button>
                }
            />

            {error && <Alert tone="danger">{error}</Alert>}

            {pairs === null ? (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" /> {t.employees.detail.loading}
                </div>
            ) : pairs.length === 0 ? (
                !error && <p className="rounded-lg border border-gray-100 bg-white p-4 text-sm text-gray-500">{tl.bulkEmpty}</p>
            ) : (
                <div className="overflow-hidden rounded-lg border border-gray-100 bg-white">
                    <div className="grid grid-cols-[auto_1fr] gap-3 border-b border-gray-100 px-3 py-2 text-xs font-medium text-gray-500 md:grid-cols-[auto_1fr_1fr_auto]">
                        <label className="flex min-h-touch items-center">
                            <Checkbox
                                checked={allSelected}
                                onChange={() =>
                                    setSelected(allSelected ? new Set() : new Set(pairs.map((pair) => pair.employee.id)))
                                }
                                aria-label={fmt(tl.bulkLinkSelected, { count: pairs.length })}
                            />
                        </label>
                        <span className="self-center">{tl.columnEmployee}</span>
                        <span className="hidden self-center md:block">{tl.columnLogin}</span>
                        <span className="hidden self-center md:block">{tl.columnMatch}</span>
                    </div>
                    <ul className="divide-y divide-gray-100">
                        {pairs.map((pair) => (
                            <li
                                key={pair.employee.id}
                                className="grid grid-cols-[auto_1fr] gap-3 px-3 py-2 md:grid-cols-[auto_1fr_1fr_auto] md:items-center"
                            >
                                <label className="flex min-h-touch items-center">
                                    <Checkbox
                                        checked={selected.has(pair.employee.id)}
                                        onChange={() => toggle(pair.employee.id)}
                                        aria-label={pair.employee.name}
                                    />
                                </label>
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-medium text-gray-900">{pair.employee.name}</p>
                                    <p className="truncate text-xs text-gray-500">
                                        {[pair.employee.employeeCode, pair.employee.phone, pair.employee.email].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                <div className="col-start-2 min-w-0 md:col-start-auto">
                                    <p className="truncate text-sm text-gray-900">
                                        {pair.user.name || pair.user.email || pair.user.mobile}
                                    </p>
                                    <p className="truncate text-xs text-gray-500">
                                        {[pair.user.email, pair.user.mobile].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                <div className="col-start-2 flex flex-wrap gap-1 md:col-start-auto">
                                    {pair.matches.map((match) => (
                                        <StatusBadge key={match} tone={match === 'name' ? 'neutral' : 'success'}>
                                            {matchLabel[match]}
                                        </StatusBadge>
                                    ))}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </PageShell>
    );
}
