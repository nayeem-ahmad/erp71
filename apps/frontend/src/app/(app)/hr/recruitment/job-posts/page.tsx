'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    Alert, Button, CompactStat, Field, FormFooter, FormGrid, Input, PageHeader, PageShell,
    Select, StatusBadge, Textarea,
} from '@/components/ui';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import {
    EMPLOYMENT_TYPES, JOB_POST_STATUSES, jobPostTone,
    type EmploymentType, type JobPost, type JobPostStatus, type RecruitmentSummary,
} from '../types';

interface NamedRecord { id: string; name: string }

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
});

/**
 * HR > Recruitment > Job posts.
 *
 * The list leads with how many candidates are still live on each post rather
 * than how many ever applied: forty applicants and nobody in the pipeline is a
 * post that has stalled, and the total alone hides that.
 */
export default function JobPostsPage() {
    const { t } = useI18n();
    const copy = t.recruitment.jobPosts;
    const toast = useToastStore((state) => state.show);

    const [posts, setPosts] = useState<JobPost[]>([]);
    const [summary, setSummary] = useState<RecruitmentSummary | null>(null);
    const [departments, setDepartments] = useState<NamedRecord[]>([]);
    const [designations, setDesignations] = useState<NamedRecord[]>([]);
    const [employees, setEmployees] = useState<NamedRecord[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
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
                api.getJobPosts({ search: search || undefined, status: statusFilter || undefined }),
                api.getRecruitmentSummary(),
            ]);
            setPosts(postList ?? []);
            setSummary(summaryData ?? null);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [search, statusFilter, copy.loadFailed]);

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

    const remove = async (post: JobPost) => {
        if (!window.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteJobPost(post.id);
            toast('success', copy.deleted);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    const salaryBand = (post: JobPost) => {
        if (post.salary_min == null && post.salary_max == null) return '—';
        if (post.salary_min != null && post.salary_max != null) {
            return `${formatBDT(Number(post.salary_min))} – ${formatBDT(Number(post.salary_max))}`;
        }
        return formatBDT(Number(post.salary_min ?? post.salary_max));
    };

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

            {summary && (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <CompactStat label={t.recruitment.summary.openPosts} value={summary.open_posts} />
                    <CompactStat label={t.recruitment.summary.openings} value={summary.open_openings} />
                    <CompactStat label={t.recruitment.summary.inPipeline} value={summary.in_pipeline} />
                    <CompactStat label={t.recruitment.summary.hiredThisMonth} value={summary.hired_this_month} tone="positive" />
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="w-full sm:w-72"
                    aria-label={copy.searchPlaceholder}
                />
                <Select
                    value={statusFilter}
                    onChange={(event) => setStatusFilter(event.target.value)}
                    className="w-40"
                    aria-label={copy.columns.status}
                >
                    <option value="">{copy.allStatuses}</option>
                    {JOB_POST_STATUSES.map((status) => (
                        <option key={status} value={status}>{copy.status[status]}</option>
                    ))}
                </Select>
            </div>

            {loading ? (
                <p className="py-8 text-center text-sm text-gray-500">…</p>
            ) : posts.length === 0 ? (
                <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                    {search || statusFilter ? copy.emptyFiltered : copy.empty}
                </p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                            <tr>
                                <th className="p-2 text-left font-medium">{copy.columns.title}</th>
                                <th className="hidden p-2 text-left font-medium md:table-cell">{copy.columns.department}</th>
                                <th className="hidden p-2 text-left font-medium md:table-cell">{copy.columns.employmentType}</th>
                                <th className="p-2 text-right font-medium">{copy.columns.openings}</th>
                                <th className="p-2 text-left font-medium">{copy.columns.applications}</th>
                                <th className="p-2 text-left font-medium">{copy.columns.status}</th>
                                <th className="hidden p-2 text-left font-medium lg:table-cell">{copy.columns.closingDate}</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {posts.map((post) => (
                                <tr key={post.id} className="border-b border-gray-100 last:border-0">
                                    <td className="p-2">
                                        <Link
                                            href={routes.hr.jobPostDetail(post.id)}
                                            className="font-medium text-blue-600 hover:underline"
                                        >
                                            {post.title}
                                        </Link>
                                        <p className="text-xs text-gray-500">
                                            {post.code}
                                            {post.location ? ` · ${post.location}` : ''}
                                        </p>
                                        <p className="text-xs text-gray-400 md:hidden">{salaryBand(post)}</p>
                                    </td>
                                    <td className="hidden p-2 text-gray-600 md:table-cell">{post.department?.name ?? '—'}</td>
                                    <td className="hidden p-2 text-gray-600 md:table-cell">
                                        {copy.employmentType[post.employment_type]}
                                    </td>
                                    <td className="p-2 text-right text-gray-600">{post.openings}</td>
                                    <td className="p-2">
                                        <span className="text-gray-900">{post.application_count ?? 0}</span>
                                        <p className="text-xs text-gray-500">
                                            {formatMessage(copy.inPipeline, { count: post.open_application_count ?? 0 })}
                                        </p>
                                    </td>
                                    <td className="p-2">
                                        <StatusBadge tone={jobPostTone(post.status)}>{copy.status[post.status]}</StatusBadge>
                                    </td>
                                    <td className="hidden p-2 text-gray-600 lg:table-cell">
                                        {post.closing_date ? formatDate(post.closing_date) : '—'}
                                    </td>
                                    <td className="p-2 text-right">
                                        <div className="flex justify-end gap-1">
                                            <Button variant="ghost" onClick={() => openModal(post)} aria-label={copy.editTitle}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                            <Button variant="ghost" onClick={() => remove(post)} aria-label={copy.deleteConfirm}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

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
                                    {departments.map((dept) => (
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
                                    {designations.map((desig) => (
                                        <option key={desig.id} value={desig.id}>{desig.name}</option>
                                    ))}
                                </Select>
                            </Field>

                            <Field label={copy.form.hiringManager} htmlFor="post-manager">
                                <Select
                                    id="post-manager"
                                    value={form.hiring_manager_id}
                                    onChange={(event) => setForm((prev) => ({ ...prev, hiring_manager_id: event.target.value }))}
                                >
                                    <option value="">{copy.form.none}</option>
                                    {employees.map((employee) => (
                                        <option key={employee.id} value={employee.id}>{employee.name}</option>
                                    ))}
                                </Select>
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
