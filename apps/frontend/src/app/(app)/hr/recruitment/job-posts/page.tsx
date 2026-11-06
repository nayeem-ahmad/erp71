'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Briefcase, DoorOpen, Pencil, Plus, Trash2, UserCheck, Users } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable, type ListFilter, type ListStat } from '@/components/data-table';
import { RowActions, RowActionButton } from '@/components/table';
import type { CreatedRange } from '@/lib/created-range';
import type { NumberCondition } from '@/lib/number-condition';
import { inDateRange, matchesAnyOf, matchesNumberCondition, matchesSearch } from '@/lib/list-filter';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    Alert, Button, Checkbox, ConfirmDialog, Field, FormFooter, FormGrid, Input, PageHeader, PageShell,
    Select, StatusBadge, Textarea,
} from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import {
    EMPLOYMENT_TYPES, JOB_POST_STATUSES, jobPostTone,
    type EmploymentType, type JobPost, type JobPostStatus, type RecruitmentSummary,
} from '../types';

interface NamedRecord { id: string; name: string; code?: string | null; is_active?: boolean }

const columnHelper = createColumnHelper<JobPost>();
/** The department chip's value for a post without one. */
const NONE = '__none__';

const blankForm = () => ({
    title: '',
    department_id: '',
    designation_id: '',
    hiring_manager_id: '',
    employment_type: 'FULL_TIME' as EmploymentType,
    location: '',
    openings: '1',
    salary_min: '',
    salary_max: '',
    description: '',
    requirements: '',
    status: 'DRAFT' as JobPostStatus,
    closing_date: '',
    publish_to_board: false,
});

/**
 * HR > Recruitment > Job posts.
 *
 * The list leads with how many candidates are still live on each post rather
 * than how many ever applied: forty applicants and nobody in the pipeline is a
 * post that has stalled, and the total alone hides that.
 */
export default function JobPostsPage() {
    const { t, locale } = useI18n();
    const copy = t.recruitment.jobPosts;
    const toast = useToastStore((state) => state.show);

    const [posts, setPosts] = useState<JobPost[]>([]);
    const [summary, setSummary] = useState<RecruitmentSummary | null>(null);
    const [departments, setDepartments] = useState<NamedRecord[]>([]);
    const [designations, setDesignations] = useState<NamedRecord[]>([]);
    const [employees, setEmployees] = useState<NamedRecord[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<string[]>([]);
    const [statusExclude, setStatusExclude] = useState(false);
    const [departmentIds, setDepartmentIds] = useState<string[]>([]);
    const [employmentTypes, setEmploymentTypes] = useState<string[]>([]);
    const [closingRange, setClosingRange] = useState<CreatedRange | null>(null);
    const [openingsFilter, setOpeningsFilter] = useState<NumberCondition | null>(null);
    const [onBoard, setOnBoard] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<JobPost | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [modal, setModal] = useState<{ open: boolean; editing: JobPost | null }>({ open: false, editing: null });
    const [form, setForm] = useState(blankForm());
    const [saving, setSaving] = useState(false);
    const [formError, setFormError] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [postList, summaryData] = await Promise.all([
                // A shop's vacancies are a short list: every post loads once and
                // the toolbar narrows it here, so the strip counts the same rows.
                api.getJobPosts(),
                api.getRecruitmentSummary(),
            ]);
            setPosts(postList ?? []);
            setSummary(summaryData ?? null);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        // The pickers only matter once the form opens, but they are small and
        // shared across every row's edit action, so they load once here.
        Promise.all([api.getDepartments(), api.getDesignations(), api.getEmployees({ status: 'ACTIVE' })])
            .then(([depts, desigs, staff]) => {
                setDepartments(depts ?? []);
                setDesignations(desigs ?? []);
                setEmployees(staff ?? []);
            })
            .catch(() => undefined);
    }, []);

    const openModal = (editing: JobPost | null) => {
        setFormError('');
        setForm(editing
            ? {
                title: editing.title,
                department_id: editing.department_id ?? '',
                designation_id: editing.designation_id ?? '',
                hiring_manager_id: editing.hiring_manager_id ?? '',
                employment_type: editing.employment_type,
                location: editing.location ?? '',
                openings: String(editing.openings ?? 1),
                salary_min: editing.salary_min == null ? '' : String(editing.salary_min),
                salary_max: editing.salary_max == null ? '' : String(editing.salary_max),
                description: editing.description ?? '',
                requirements: editing.requirements ?? '',
                status: editing.status,
                closing_date: editing.closing_date ? editing.closing_date.slice(0, 10) : '',
                publish_to_board: Boolean(editing.publish_to_board),
            }
            : blankForm());
        setModal({ open: true, editing });
    };

    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        setFormError('');

        const min = form.salary_min ? Number(form.salary_min) : null;
        const max = form.salary_max ? Number(form.salary_max) : null;
        if (min != null && max != null && min > max) {
            setFormError(copy.form.salaryBandError);
            return;
        }

        setSaving(true);
        try {
            const payload = {
                title: form.title,
                department_id: form.department_id || null,
                designation_id: form.designation_id || null,
                hiring_manager_id: form.hiring_manager_id || null,
                employment_type: form.employment_type,
                location: form.location || null,
                openings: Number(form.openings) || 1,
                salary_min: min,
                salary_max: max,
                description: form.description || null,
                requirements: form.requirements || null,
                status: form.status,
                closing_date: form.closing_date || null,
                publish_to_board: form.publish_to_board,
            };
            if (modal.editing) {
                await api.updateJobPost(modal.editing.id, payload);
                toast('success', copy.updated);
            } else {
                await api.createJobPost(payload);
                toast('success', copy.created);
            }
            setModal({ open: false, editing: null });
            await load();
        } catch (err: any) {
            setFormError(err?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        const post = pendingDelete;
        if (!post) return;
        try {
            await api.deleteJobPost(post.id);
            toast('success', copy.deleted);
            setPendingDelete(null);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    const salaryBand = (post: JobPost) => {
        if (post.salary_min == null && post.salary_max == null) return '—';
        if (post.salary_min != null && post.salary_max != null) {
            return `${formatBDT(Number(post.salary_min), { locale })} – ${formatBDT(Number(post.salary_max), { locale })}`;
        }
        return formatBDT(Number(post.salary_min ?? post.salary_max), { locale });
    };

    const filtered = useMemo(
        () => posts.filter((post) => {
            if (!matchesAnyOf(statusFilter, post.status, statusExclude)) return false;
            if (!matchesAnyOf(departmentIds, post.department_id ?? post.department?.id ?? NONE)) return false;
            if (!matchesAnyOf(employmentTypes, post.employment_type)) return false;
            if (!inDateRange(post.closing_date, closingRange)) return false;
            if (!matchesNumberCondition(post.openings ?? 0, openingsFilter)) return false;
            if (onBoard && !post.publish_to_board) return false;
            return matchesSearch(search, post.title, post.code, post.location, post.department?.name);
        }),
        [posts, statusFilter, statusExclude, departmentIds, employmentTypes, closingRange, openingsFilter, onBoard, search],
    );

    const departmentOptions = useMemo(() => {
        const seen = new Map<string, string>();
        for (const dept of departments) seen.set(dept.id, dept.name);
        for (const post of posts) if (post.department) seen.set(post.department.id, post.department.name);
        return [...seen].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label));
    }, [departments, posts]);

    const filters = useMemo<ListFilter[]>(() => [
        {
            id: 'status',
            type: 'multi-select',
            label: copy.columns.status,
            value: statusFilter,
            onChange: setStatusFilter,
            exclude: { value: statusExclude, onChange: setStatusExclude },
            options: JOB_POST_STATUSES.map((value) => ({ value, label: copy.status[value] })),
        },
        {
            id: 'department',
            type: 'multi-select',
            label: copy.columns.department,
            value: departmentIds,
            onChange: setDepartmentIds,
            options: [{ value: NONE, label: t.hr.reports.common.unassigned }, ...departmentOptions],
        },
        {
            id: 'employmentType',
            type: 'multi-select',
            label: copy.columns.employmentType,
            value: employmentTypes,
            onChange: setEmploymentTypes,
            options: EMPLOYMENT_TYPES.map((value) => ({ value, label: copy.employmentType[value] })),
        },
        {
            id: 'closing',
            type: 'date-range',
            label: copy.columns.closingDate,
            value: closingRange,
            onChange: setClosingRange,
            operators: true,
        },
        {
            id: 'openings',
            type: 'number',
            label: copy.columns.openings,
            value: openingsFilter,
            onChange: setOpeningsFilter,
            more: true,
        },
        {
            id: 'board',
            type: 'toggle',
            label: copy.form.publishToBoard,
            pressed: onBoard,
            onChange: setOnBoard,
            control: 'button',
            more: true,
        },
    ], [t, copy, statusFilter, statusExclude, departmentIds, departmentOptions, employmentTypes, closingRange, openingsFilter, onBoard]);

    const stats = useMemo(() => {
        const n = (value: number) => value.toLocaleString(locale);
        const open = filtered.filter((post) => post.status === 'OPEN');
        const items: ListStat[] = [
            { id: 'count', icon: <Briefcase aria-hidden />, label: copy.title, value: n(filtered.length) },
            { id: 'open', icon: <DoorOpen aria-hidden />, label: t.recruitment.summary.openPosts, value: n(open.length) },
            {
                id: 'openings',
                icon: <Users aria-hidden />,
                label: t.recruitment.summary.openings,
                value: n(open.reduce((sum, post) => sum + (post.openings ?? 0), 0)),
            },
            {
                id: 'pipeline',
                icon: <Users aria-hidden />,
                label: t.recruitment.summary.inPipeline,
                value: n(filtered.reduce((sum, post) => sum + (post.open_application_count ?? 0), 0)),
            },
            // Workspace-wide, from the summary: hires are dated, posts are not.
            {
                id: 'hired',
                icon: <UserCheck aria-hidden />,
                label: t.recruitment.summary.hiredThisMonth,
                value: summary ? n(summary.hired_this_month) : '—',
            },
        ];
        return { items, loading, label: t.hr.listUi.jobPostsStats };
    }, [filtered, summary, loading, locale, copy, t]);

    const columns: ColumnDef<JobPost, any>[] = useMemo(() => [
        columnHelper.accessor('title', {
            header: copy.columns.title,
            cell: (info) => {
                const post = info.row.original;
                return (
                    <div>
                        <Link href={routes.hr.jobPostDetail(post.id)} className="text-blue-600 hover:underline">
                            {post.title}
                        </Link>
                        <span className="block text-gray-500">
                            {post.code}
                            {post.location ? ` · ${post.location}` : ''}
                        </span>
                    </div>
                );
            },
            size: 240,
        }),
        columnHelper.accessor((row) => row.department?.name ?? '', {
            id: 'department',
            header: copy.columns.department,
            cell: (info) => info.getValue() || '—',
            size: 150,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor('employment_type', {
            header: copy.columns.employmentType,
            cell: (info) => copy.employmentType[info.getValue() as EmploymentType] ?? info.getValue(),
            size: 120,
            meta: { hideOnMobile: true },
        }),
        columnHelper.accessor((row) => Number(row.salary_max ?? row.salary_min ?? 0), {
            id: 'salary',
            header: t.recruitment.jobPosts.detail.salaryBand,
            cell: (info) => salaryBand(info.row.original),
            size: 180,
            meta: { hideOnMobile: true, align: 'end' },
        }),
        columnHelper.accessor('openings', {
            header: copy.columns.openings,
            cell: (info) => info.getValue(),
            size: 90,
            meta: { align: 'end' },
        }),
        columnHelper.accessor((row) => row.application_count ?? 0, {
            id: 'applications',
            header: copy.columns.applications,
            cell: (info) => (
                <div>
                    <span className="block">{info.getValue()}</span>
                    <span className="block text-gray-500">
                        {formatMessage(copy.inPipeline, { count: info.row.original.open_application_count ?? 0 })}
                    </span>
                </div>
            ),
            size: 130,
        }),
        columnHelper.accessor('status', {
            header: copy.columns.status,
            cell: (info) => <StatusBadge tone={jobPostTone(info.getValue())}>{copy.status[info.getValue() as JobPostStatus]}</StatusBadge>,
            size: 110,
        }),
        columnHelper.accessor('closing_date', {
            header: copy.columns.closingDate,
            cell: (info) => (info.getValue() ? formatDate(info.getValue()!, locale) : '—'),
            size: 120,
            meta: { hideOnMobile: true },
        }),
        columnHelper.display({
            id: 'actions',
            header: t.common.actions,
            cell: (info) => (
                <RowActions>
                    <RowActionButton icon={<Pencil />} label={copy.editTitle} onClick={() => openModal(info.row.original)} />
                    <RowActionButton
                        icon={<Trash2 />}
                        label={t.common.delete}
                        intent="danger"
                        onClick={() => setPendingDelete(info.row.original)}
                    />
                </RowActions>
            ),
            enableSorting: false,
            enableColumnFilter: false,
            enableResizing: false,
            size: 90,
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
                    <Button onClick={() => openModal(null)}>
                        <Plus className="h-4 w-4" />
                        {copy.add}
                    </Button>
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <DataTable<JobPost>
                tableId="job-posts"
                columns={columns}
                data={filtered}
                title={copy.title}
                isLoading={loading}
                emptyMessage={posts.length === 0 ? copy.empty : copy.emptyFiltered}
                emptyIcon={<Briefcase className="w-16 h-16 text-gray-200" />}
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
                title={t.common.delete}
                prompt={copy.deleteConfirm}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={() => void remove()}
                onCancel={() => setPendingDelete(null)}
            />

            {modal.open && (
                <ModalShell size="lg" onBackdropClick={() => setModal({ open: false, editing: null })}>
                    <ModalHeader
                        title={modal.editing ? copy.editTitle : copy.addTitle}
                        subtitle={modal.editing?.code}
                        onClose={() => setModal({ open: false, editing: null })}
                    />
                    <form onSubmit={save} className="space-y-3 overflow-y-auto p-4">
                        {formError && <Alert tone="danger">{formError}</Alert>}

                        <FormGrid>
                            <FormGrid.Full>
                                <Field label={copy.form.title} htmlFor="post-title" required>
                                    <Input
                                        id="post-title"
                                        value={form.title}
                                        onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                                        placeholder={copy.form.titlePlaceholder}
                                        required
                                    />
                                </Field>
                            </FormGrid.Full>

                            <Field label={copy.form.department} htmlFor="post-department">
                                <Select
                                    id="post-department"
                                    value={form.department_id}
                                    onChange={(event) => setForm((prev) => ({ ...prev, department_id: event.target.value }))}
                                >
                                    <option value="">{copy.form.none}</option>
                                    {departments.filter((d) => d.is_active !== false || d.id === form.department_id).map((dept) => (
                                        <option key={dept.id} value={dept.id}>{dept.name}</option>
                                    ))}
                                </Select>
                            </Field>

                            <Field label={copy.form.designation} htmlFor="post-designation">
                                <Select
                                    id="post-designation"
                                    value={form.designation_id}
                                    onChange={(event) => setForm((prev) => ({ ...prev, designation_id: event.target.value }))}
                                >
                                    <option value="">{copy.form.none}</option>
                                    {designations.filter((d) => d.is_active !== false || d.id === form.designation_id).map((desig) => (
                                        <option key={desig.id} value={desig.id}>{desig.code ? `${desig.code} · ${desig.name}` : desig.name}</option>
                                    ))}
                                </Select>
                            </Field>

                            <Field label={copy.form.hiringManager} htmlFor="post-manager">
                                <IdSearchSelect
                                    id="post-manager"
                                    items={employees}
                                    value={form.hiring_manager_id}
                                    onChange={(id) => setForm((prev) => ({ ...prev, hiring_manager_id: id }))}
                                    placeholder={copy.form.none}
                                    emptyLabel={copy.form.none}
                                    noMatchLabel={t.common.noData}
                                />
                            </Field>

                            <Field label={copy.form.employmentType} htmlFor="post-type">
                                <Select
                                    id="post-type"
                                    value={form.employment_type}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev, employment_type: event.target.value as EmploymentType,
                                    }))}
                                >
                                    {EMPLOYMENT_TYPES.map((type) => (
                                        <option key={type} value={type}>{copy.employmentType[type]}</option>
                                    ))}
                                </Select>
                            </Field>

                            <Field label={copy.form.location} htmlFor="post-location">
                                <Input
                                    id="post-location"
                                    value={form.location}
                                    onChange={(event) => setForm((prev) => ({ ...prev, location: event.target.value }))}
                                    placeholder={copy.form.locationPlaceholder}
                                />
                            </Field>

                            <Field label={copy.form.openings} htmlFor="post-openings">
                                <Input
                                    id="post-openings"
                                    type="number"
                                    min={1}
                                    value={form.openings}
                                    onChange={(event) => setForm((prev) => ({ ...prev, openings: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.salaryMin} htmlFor="post-salary-min">
                                <Input
                                    id="post-salary-min"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={form.salary_min}
                                    onChange={(event) => setForm((prev) => ({ ...prev, salary_min: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.salaryMax} htmlFor="post-salary-max">
                                <Input
                                    id="post-salary-max"
                                    type="number"
                                    min={0}
                                    step="0.01"
                                    value={form.salary_max}
                                    onChange={(event) => setForm((prev) => ({ ...prev, salary_max: event.target.value }))}
                                />
                            </Field>

                            <Field label={copy.form.status} htmlFor="post-status">
                                <Select
                                    id="post-status"
                                    value={form.status}
                                    onChange={(event) => setForm((prev) => ({
                                        ...prev, status: event.target.value as JobPostStatus,
                                    }))}
                                >
                                    {JOB_POST_STATUSES.map((status) => (
                                        <option key={status} value={status}>{copy.status[status]}</option>
                                    ))}
                                </Select>
                            </Field>

                            <Field label={copy.form.publishToBoard} htmlFor="post-publish">
                                <label className="inline-flex items-start gap-2 text-sm text-gray-700">
                                    <Checkbox
                                        id="post-publish"
                                        checked={form.publish_to_board}
                                        onChange={(event) => setForm((prev) => ({
                                            ...prev, publish_to_board: event.target.checked,
                                        }))}
                                    />
                                    <span>{copy.form.publishToBoardHint}</span>
                                </label>
                            </Field>

                            <Field label={copy.form.closingDate} htmlFor="post-closing">
                                <Input
                                    id="post-closing"
                                    type="date"
                                    value={form.closing_date}
                                    onChange={(event) => setForm((prev) => ({ ...prev, closing_date: event.target.value }))}
                                />
                            </Field>

                            <FormGrid.Full>
                                <Field label={copy.form.description} htmlFor="post-description">
                                    <Textarea
                                        id="post-description"
                                        rows={3}
                                        value={form.description}
                                        onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                                        placeholder={copy.form.descriptionPlaceholder}
                                    />
                                </Field>
                            </FormGrid.Full>

                            <FormGrid.Full>
                                <Field label={copy.form.requirements} htmlFor="post-requirements">
                                    <Textarea
                                        id="post-requirements"
                                        rows={3}
                                        value={form.requirements}
                                        onChange={(event) => setForm((prev) => ({ ...prev, requirements: event.target.value }))}
                                        placeholder={copy.form.requirementsPlaceholder}
                                    />
                                </Field>
                            </FormGrid.Full>
                        </FormGrid>

                        <FormFooter>
                            <Button variant="secondary" onClick={() => setModal({ open: false, editing: null })}>
                                {t.common.cancel}
                            </Button>
                            <Button type="submit" loading={saving} disabled={saving}>{t.common.save}</Button>
                        </FormFooter>
                    </form>
                </ModalShell>
            )}
        </PageShell>
    );
}
