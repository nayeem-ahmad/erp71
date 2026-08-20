'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRightLeft, FileText, Plus, Trash2, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { useToastStore } from '@/lib/toast';
import { routes } from '@/lib/routes';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    Alert, Button, Checkbox, Input, PageHeader, PageShell, Select, StatusBadge,
} from '@/components/ui';
import ApplicationModal from '../ApplicationModal';
import HireModal from '../HireModal';
import StageModal from '../StageModal';
import {
    APPLICATION_STAGES, OPEN_STAGES, isOpenStage, stageTone,
    type ApplicationStage, type JobApplication, type JobPost,
} from '../types';

/**
 * Every candidate across every post, in one list.
 *
 * Defaults to the live pipeline rather than everything ever: the rejected pile
 * grows without bound and is the one thing nobody opens this screen to see.
 */
export default function ApplicationsPage() {
    const { t } = useI18n();
    const copy = t.recruitment.applications;
    const toast = useToastStore((state) => state.show);

    const [applications, setApplications] = useState<JobApplication[]>([]);
    const [posts, setPosts] = useState<JobPost[]>([]);
    const [search, setSearch] = useState('');
    const [postFilter, setPostFilter] = useState('');
    const [stageFilter, setStageFilter] = useState('');
    const [pipelineOnly, setPipelineOnly] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [addOpen, setAddOpen] = useState(false);
    const [stageTarget, setStageTarget] = useState<JobApplication | null>(null);
    const [hireTarget, setHireTarget] = useState<JobApplication | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setApplications(await api.getJobApplications({
                search: search || undefined,
                job_post_id: postFilter || undefined,
                stage: stageFilter || undefined,
                // An explicit stage wins over the pipeline shortcut; sending both
                // would filter to the intersection and quietly show nothing.
                stages: !stageFilter && pipelineOnly ? OPEN_STAGES.join(',') : undefined,
            }) ?? []);
        } catch (err: any) {
            setError(err?.message || copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [search, postFilter, stageFilter, pipelineOnly, copy.loadFailed]);

    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        api.getJobPosts().then((list) => setPosts(list ?? [])).catch(() => undefined);
    }, []);

    const remove = async (application: JobApplication) => {
        if (!window.confirm(copy.deleteConfirm)) return;
        try {
            await api.deleteJobApplication(application.id);
            toast('success', copy.deleted);
            await load();
        } catch (err: any) {
            toast('error', err?.message || copy.deleteFailed);
        }
    };

    const isFiltered = Boolean(search || postFilter || stageFilter || pipelineOnly);

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

            <div className="flex flex-wrap items-center gap-2">
                <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={copy.searchPlaceholder}
                    className="w-full sm:w-64"
                    aria-label={copy.searchPlaceholder}
                />
                <Select
                    value={postFilter}
                    onChange={(event) => setPostFilter(event.target.value)}
                    className="w-52"
                    aria-label={copy.columns.jobPost}
                >
                    <option value="">{copy.allPosts}</option>
                    {posts.map((post) => (
                        <option key={post.id} value={post.id}>{post.code} — {post.title}</option>
                    ))}
                </Select>
                <Select
                    value={stageFilter}
                    onChange={(event) => setStageFilter(event.target.value)}
                    className="w-40"
                    aria-label={copy.columns.stage}
                >
                    <option value="">{copy.allStages}</option>
                    {APPLICATION_STAGES.map((stage) => (
                        <option key={stage} value={stage}>{t.recruitment.stages[stage]}</option>
                    ))}
                </Select>
                <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                    <Checkbox
                        checked={pipelineOnly}
                        onChange={(event) => setPipelineOnly(event.target.checked)}
                        disabled={Boolean(stageFilter)}
                    />
                    {copy.pipelineOnly}
                </label>
            </div>

            {loading ? (
                <p className="py-8 text-center text-sm text-gray-500">…</p>
            ) : applications.length === 0 ? (
                <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                    {isFiltered ? copy.emptyFiltered : copy.empty}
                </p>
            ) : (
                <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                    <table className="w-full text-sm">
                        <thead className="border-b border-gray-200 bg-gray-50 text-xs text-gray-500">
                            <tr>
                                <th className="p-2 text-start font-medium">{copy.columns.candidate}</th>
                                <th className="p-2 text-start font-medium">{copy.columns.jobPost}</th>
                                <th className="p-2 text-start font-medium">{copy.columns.stage}</th>
                                <th className="hidden p-2 text-start font-medium md:table-cell">{copy.columns.appliedAt}</th>
                                <th className="hidden p-2 text-end font-medium lg:table-cell">{copy.columns.expectedSalary}</th>
                                <th className="hidden p-2 text-start font-medium lg:table-cell">{copy.columns.source}</th>
                                <th className="p-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {applications.map((application) => (
                                <tr key={application.id} className="border-b border-gray-100 last:border-0">
                                    <td className="p-2">
                                        <p className="font-medium text-gray-900">{application.applicant?.name}</p>
                                        <p className="text-xs text-gray-500">{application.applicant?.phone}</p>
                                        {application.applicant?.resume_url && (
                                            <a
                                                href={application.applicant.resume_url}
                                                target="_blank"
                                                rel="noreferrer noopener"
                                                className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                                            >
                                                <FileText className="h-3.5 w-3.5" />
                                                {t.recruitment.applicants.resume}
                                            </a>
                                        )}
                                    </td>
                                    <td className="p-2">
                                        {application.jobPost ? (
                                            <Link
                                                href={routes.hr.jobPostDetail(application.jobPost.id)}
                                                className="text-blue-600 hover:underline"
                                            >
                                                {application.jobPost.title}
                                            </Link>
                                        ) : '—'}
                                        <p className="text-xs text-gray-500">{application.jobPost?.code}</p>
                                    </td>
                                    <td className="p-2">
                                        <StatusBadge tone={stageTone(application.stage)}>
                                            {t.recruitment.stages[application.stage]}
                                        </StatusBadge>
                                        {application.hiredEmployee && (
                                            <p className="mt-1 text-xs text-emerald-700">
                                                {application.hiredEmployee.employee_code}
                                            </p>
                                        )}
                                        {application.stage === 'REJECTED' && application.rejection_reason && (
                                            <p className="mt-1 text-xs text-gray-500">{application.rejection_reason}</p>
                                        )}
                                    </td>
                                    <td className="hidden p-2 text-gray-600 md:table-cell">
                                        <p>{formatDate(application.applied_at)}</p>
                                        <p className="text-xs text-gray-400">
                                            {copy.lastMoved}: {formatDate(application.stage_changed_at)}
                                        </p>
                                    </td>
                                    <td className="hidden p-2 text-end text-gray-600 lg:table-cell">
                                        {application.expected_salary == null
                                            ? '—'
                                            : formatBDT(Number(application.expected_salary))}
                                    </td>
                                    <td className="hidden p-2 text-gray-600 lg:table-cell">{application.source || '—'}</td>
                                    <td className="p-2 text-end">
                                        <div className="flex justify-end gap-1">
                                            {application.stage !== 'HIRED' && (
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => setStageTarget(application)}
                                                    aria-label={copy.actions.move}
                                                >
                                                    <ArrowRightLeft className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {isOpenStage(application.stage as ApplicationStage) && (
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => setHireTarget(application)}
                                                    aria-label={copy.actions.hire}
                                                >
                                                    <UserCheck className="h-4 w-4" />
                                                </Button>
                                            )}
                                            {!application.hired_employee_id && (
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => remove(application)}
                                                    aria-label={copy.actions.remove}
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

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
