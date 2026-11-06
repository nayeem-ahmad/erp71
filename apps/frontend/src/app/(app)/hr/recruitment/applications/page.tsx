'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, FileText, Gift, Inbox, Mic, Plus, Trash2, UserCheck, UserX } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    Alert, Button, ConfirmDialog, PageHeader, PageShell, StatusBadge,
} from '@/components/ui';
import ApplicationModal from '../ApplicationModal';
import HireModal from '../HireModal';
import StageModal from '../StageModal';
import {
    APPLICATION_STAGES, OPEN_STAGES, isOpenStage, stageTone,
    type ApplicationStage, type JobApplication, type JobPost,
} from '../types';

const columnHelper = createColumnHelper<JobApplication>();
/** The source chip's value for an application with none recorded. */
const NONE = '__none__';

/**
 * Every candidate across every post, in one list.
 *
 * Defaults to the live pipeline rather than everything ever: the rejected pile
 * grows without bound and is the one thing nobody opens this screen to see.
 */
export default function ApplicationsPage() {
    const { t, locale } = useI18n();
    const copy = t.recruitment.applications;
    const toast = useToastStore((state) => state.show);

    const [applications, setApplications] = useState<JobApplication[]>([]);
    const [posts, setPosts] = useState<JobPost[]>([]);
    const [search, setSearch] = useState('');
    const [postIds, setPostIds] = useState<string[]>([]);
    // Opens on the live pipeline; clearing the chip lists every stage.
    const [stages, setStages] = useState<string[]>([...OPEN_STAGES]);
    const [sources, setSources] = useState<string[]>([]);
    const [appliedRange, setAppliedRange] = useState<CreatedRange | null>(null);
    const [salaryFilter, setSalaryFilter] = useState<NumberCondition | null>(null);
    const [pendingDelete, setPendingDelete] = useState<JobApplication | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [addOpen, setAddOpen] = useState(false);
    const [stageTarget, setStageTarget] = useState<JobApplication | null>(null);
    const [hireTarget, setHireTarget] = useState<JobApplication | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            // Stages go to the server: the rejected pile grows without bound and
            // is the one thing nobody opens this screen to see. One post goes
            // too; the rest of the chips narrow what came back.
            setApplications(await api.getJobApplications({
                job_post_id: postIds.length === 1 ? postIds[0] : undefined,
                stages: stages.length ? stages.join(',') : undefined,
            }) ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [postIds, stages, copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        api.getJobPosts().then((list) => setPosts(list ?? [])).catch(() => undefined);
    }, []);

    const remove = async () => {
        const application = pendingDelete;
        if (!application) return;
        try {
            await api.deleteJobApplication(application.id);
            toast('success', copy.deleted);
            setPendingDelete(null);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    const filtered = useMemo(
        () => applications.filter((app) => {
            if (!matchesAnyOf(postIds, app.jobPost?.id)) return false;
            if (!matchesAnyOf(sources, app.source?.trim() || NONE)) return false;
            if (!inDateRange(app.applied_at, appliedRange)) return false;
            if (salaryFilter && (app.expected_salary == null || !matchesNumberCondition(Number(app.expected_salary), salaryFilter))) return false;
            return matchesSearch(
                search,
                app.applicant?.name, app.applicant?.phone, app.applicant?.email, app.jobPost?.title, app.jobPost?.code, app.source,
            );
        }),
        [applications, postIds, sources, appliedRange, salaryFilter, search],
    );

    const sourceOptions = useMemo(
        () => [...new Set(applications.map((app) => app.source?.trim()).filter((v): v is string => Boolean(v)))]
            .sort((a, b) => a.localeCompare(b))
            .map((value) => ({ value, label: value })),
        [applications],
    );

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'stage',
            type: 'multi-select',
            label: copy.columns.stage,
            value: stages,
            onChange: setStages,
            options: APPLICATION_STAGES.map((value) => ({ value, label: t.recruitment.stages[value] })),
        },
        {
            id: 'jobPost',
            type: 'multi-select',
            label: copy.columns.jobPost,
            value: postIds,
            onChange: setPostIds,
            options: posts.map((post) => ({ value: post.id, label: `${post.code} — ${post.title}` })),
        },
        {
            id: 'applied',
            type: 'date-range',
            label: copy.columns.appliedAt,
            value: appliedRange,
            onChange: setAppliedRange,
            operators: true,
        },
        {
            id: 'source',
            type: 'multi-select',
            label: copy.columns.source,
            value: sources,
            onChange: setSources,
            options: [{ value: NONE, label: t.hr.reports.common.unassigned }, ...sourceOptions],
        },
        {
            id: 'expectedSalary',
            type: 'number',
            label: copy.columns.expectedSalary,
            value: salaryFilter,
            onChange: setSalaryFilter,
            money: true,
            more: true,
        },
    ], [t, copy, stages, postIds, posts, appliedRange, sources, sourceOptions, salaryFilter]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const count = (...wanted: ApplicationStage[]) => filtered.filter((app) => wanted.includes(app.stage)).length;
        const items: ListStat[] = [
            { id: 'count', icon: <Inbox aria-hidden />, label: copy.title, value: n(filtered.length) },
            { id: 'interview', icon: <Mic aria-hidden />, label: t.recruitment.stages.INTERVIEW, value: n(count('INTERVIEW')) },
            { id: 'offer', icon: <Gift aria-hidden />, label: t.recruitment.stages.OFFER, value: n(count('OFFER')) },
            { id: 'hired', icon: <UserCheck aria-hidden />, label: t.recruitment.stages.HIRED, value: n(count('HIRED')) },
            {
                id: 'out',
                icon: <UserX aria-hidden />,
                label: `${t.recruitment.stages.REJECTED} / ${t.recruitment.stages.WITHDRAWN}`,
                value: n(count('REJECTED', 'WITHDRAWN')),
            },
        ];
        return { items, loading, label: t.hr.listUi.applicationsStats };
    }, [filtered, loading, locale, copy, t]);

    const columns: ColumnDef<JobApplication, any>[] = useMemo(() => [
        columnHelper.accessor((row) => row.applicant?.name ?? '', {
            id: 'candidate',
            header: copy.columns.candidate,
            cell: (info) => {
                const application = info.row.original;
                return (
                    <div>
                        <span className="block">{application.applicant?.name}</span>
                        <span className="block text-gray-500">{application.applicant?.phone}</span>
                        {application.applicant?.resume_url && (
                            <a
                                href={application.applicant.resume_url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                            >
                                <FileText className="h-3.5 w-3.5" />
                                {t.recruitment.applicants.resume}
                            </a>
                        )}
                    </div>
                );
            },
            size: 200,
        }),
        columnHelper.accessor((row) => row.jobPost?.title ?? '', {
            id: 'jobPost',
            header: copy.columns.jobPost,
            cell: (info) => {
                const post = info.row.original.jobPost;
                return (
                    <div>
                        {post ? (
                            <Link href={routes.hr.jobPostDetail(post.id)} className="text-blue-600 hover:underline">
                                {post.title}
                            </Link>
                        ) : '—'}
                        <span className="block text-gray-500">{post?.code}</span>
                    </div>
                );
            },
            size: 200,
        }),
        columnHelper.accessor('stage', {
            header: copy.columns.stage,
            cell: (info) => {
                const application = info.row.original;
                return (
                    <div>
                        <StatusBadge tone={stageTone(application.stage)}>
                            {t.recruitment.stages[application.stage]}
                        </StatusBadge>
                        {application.hiredEmployee && (
                            <span className="mt-1 block text-emerald-700">{application.hiredEmployee.employee_code}</span>
                        )}
                        {application.stage === 'REJECTED' && application.rejection_reason && (
                            <span className="mt-1 block text-gray-500">{application.rejection_reason}</span>
                        )}
                    </div>
                );
            },
            size: 140,
        }),
        columnHelper.accessor('applied_at', {
            header: copy.columns.appliedAt,
            cell: (info) => (
                <div>
                    <span className="block">{formatDate(info.getValue(), locale)}</span>
                    <span className="block text-gray-500">
                        {copy.lastMoved}: {formatDate(info.row.original.stage_changed_at, locale)}
                    </span>
                </div>
            ),
            size: 150,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => (row.expected_salary == null ? -1 : Number(row.expected_salary)), {
            id: 'expected_salary',
            header: copy.columns.expectedSalary,
            cell: (info) => {
                const value = info.row.original.expected_salary;
                return value == null ? '—' : formatBDT(Number(value), { locale });
            },
            size: 120,
            meta: { hideOnMobile: true, align: 'end' },
        }),
        columnHelper.accessor('source', {
            header: copy.columns.source,
            cell: (info) => info.getValue() || '—',
            size: 120,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => {
                const application = info.row.original;
                return (
                    <RowActions>
                        {application.stage !== 'HIRED' && (
                            <RowActionButton
                                icon={<ArrowRightLeft />}
                                label={copy.actions.move}
                                onClick={() => setStageTarget(application)}
                            />
                        )}
                        {isOpenStage(application.stage as ApplicationStage) && (
                            <RowActionButton
                                icon={<UserCheck />}
                                label={copy.actions.hire}
                                intent="success"
                                onClick={() => setHireTarget(application)}
                            />
                        )}
                        {!application.hired_employee_id && (
                            <RowActionButton
                                icon={<Trash2 />}
                                label={copy.actions.remove}
                                intent="danger"
                                onClick={() => setPendingDelete(application)}
                            />
                        )}
                    </RowActions>
                );
            },
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 110,
        }),
    ], [t, copy, locale]);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.hr,
                    copy.breadcrumb,
                    'hr',
                )}
                actions={(
                    <Button onClick={() => setAddOpen(true)}>
                        <Plus className="h-4 w-4" />
                        {copy.add}
                    </Button>
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <DataTable<JobApplication>
                tableId="job-applications"
                columns={columns}
                data={filtered}
                title={copy.title}
                isLoading={loading}
                emptyMessage={applications.length === 0 && stages.length === 0 ? copy.empty : copy.emptyFiltered}
                emptyIcon={<Inbox className="w-16 h-16 text-gray-200" />}
                searchPlaceholder={copy.searchPlaceholder}
                searchValue={search}
                onSearchChange={setSearch}
                filters={filters}
                filterLayout="row"
                stats={stats}
                enableColumnFilters={false}
                viewOptions
            />

            <ConfirmDialog
                open={pendingDelete !== null}
                title={copy.actions.remove}
                prompt={copy.deleteConfirm}
                confirmLabel={copy.actions.remove}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={() => void remove()}
                onCancel={() => setPendingDelete(null)}
            />

            {addOpen && (
                <ApplicationModal onClose={() => setAddOpen(false)} onSaved={load} />
            )}

            {stageTarget && (
                <StageModal application={stageTarget} onClose={() => setStageTarget(null)} onSaved={load} />
            )}

            {hireTarget && (
                <HireModal application={hireTarget} onClose={() => setHireTarget(null)} onHired={load} />
            )}
        </PageShell>
    );
}
