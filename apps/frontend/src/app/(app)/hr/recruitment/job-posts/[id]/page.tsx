'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, FileText, Plus, UserCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDate } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { buildBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, CompactStat, PageHeader, PageShell, StatusBadge } from '@/components/ui';
import ApplicationModal from '../../ApplicationModal';
import HireModal from '../../HireModal';
import StageModal from '../../StageModal';
import {
    APPLICATION_STAGES, isOpenStage, jobPostTone, stageTone,
    type JobApplication, type JobPost,
} from '../../types';

/**
 * One vacancy and everybody on it, grouped by stage.
 *
 * Columns rather than a flat table because the question this screen answers is
 * "where is everyone", not "who applied" — and an empty OFFER column next to a
 * full SCREENING one says something a list sorted by date does not.
 */
export default function JobPostDetailPage() {
    const params = useParams<{ id: string }>();
    const id = params?.id as string;
    const { t } = useI18n();
    const copy = t.recruitment.jobPosts;
    const detail = copy.detail;

    const [post, setPost] = useState<JobPost | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [addOpen, setAddOpen] = useState(false);
    const [stageTarget, setStageTarget] = useState<JobApplication | null>(null);
    const [hireTarget, setHireTarget] = useState<JobApplication | null>(null);

    const load = useCallback(async () => {
        if (!id) return;
        setLoading(true);
        setError('');
        try {
            setPost(await api.getJobPost(id));
        } catch (err: any) {
            setError(err?.message || detail.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [id, detail.loadFailed]);

    useEffect(() => { load(); }, [load]);

    const applications = post?.applications ?? [];
    const hiredCount = applications.filter((application) => application.stage === 'HIRED').length;

    const salaryBand = () => {
        if (!post || (post.salary_min == null && post.salary_max == null)) return '—';
        if (post.salary_min != null && post.salary_max != null) {
            return `${formatBDT(Number(post.salary_min))} – ${formatBDT(Number(post.salary_max))}`;
        }
        return formatBDT(Number(post.salary_min ?? post.salary_max));
    };

    if (loading) {
        return <PageShell><p className="py-8 text-center text-sm text-gray-500">…</p></PageShell>;
    }

    if (!post) {
        return (
            <PageShell>
                <Alert tone="danger">{error || detail.notFound}</Alert>
                <Link href={routes.hr.jobPosts} className="text-sm text-blue-600 hover:underline">
                    {detail.backToPosts}
                </Link>
            </PageShell>
        );
    }

    return (
        <PageShell>
            <PageHeader
                title={post.title}
                subtitle={`${post.code}${post.location ? ` · ${post.location}` : ''}`}
                breadcrumbs={buildBreadcrumbs(t.dashboardHome.breadcrumbHome, [
                    { label: t.sidebar.modules.hr, href: routes.hr.root },
                    { label: copy.breadcrumb, href: routes.hr.jobPosts },
                    { label: post.code },
                ])}
                actions={(
                    <>
                        <Link href={routes.hr.jobPosts}>
                            <Button variant="secondary">
                                <ArrowLeft className="h-4 w-4" />
                                {detail.backToPosts}
                            </Button>
                        </Link>
                        {post.status !== 'CLOSED' && (
                            <Button onClick={() => setAddOpen(true)}>
                                <Plus className="h-4 w-4" />
                                {detail.addApplication}
                            </Button>
                        )}
                    </>
                )}
            />

            {error && <Alert tone="danger">{error}</Alert>}

            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <CompactStat
                    label={copy.columns.status}
                    value={<StatusBadge tone={jobPostTone(post.status)}>{copy.status[post.status]}</StatusBadge>}
                />
                <CompactStat label={copy.columns.openings} value={`${hiredCount}/${post.openings}`} />
                <CompactStat label={copy.columns.applications} value={applications.length} />
                <CompactStat label={detail.salaryBand} value={salaryBand()} />
            </div>

            <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <p className="text-xs text-gray-500">{copy.columns.department}</p>
                    <p className="text-gray-900">{post.department?.name ?? '—'}</p>
                    <p className="mt-2 text-xs text-gray-500">{copy.form.designation}</p>
                    <p className="text-gray-900">{post.designation?.name ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <p className="text-xs text-gray-500">{copy.columns.employmentType}</p>
                    <p className="text-gray-900">{copy.employmentType[post.employment_type]}</p>
                    <p className="mt-2 text-xs text-gray-500">{detail.hiringManager}</p>
                    <p className="text-gray-900">{post.hiringManager?.name ?? '—'}</p>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
                    <p className="text-xs text-gray-500">{detail.postedOn}</p>
                    <p className="text-gray-900">{post.opened_at ? formatDate(post.opened_at) : detail.notOpened}</p>
                    <p className="mt-2 text-xs text-gray-500">{copy.columns.closingDate}</p>
                    <p className="text-gray-900">{post.closing_date ? formatDate(post.closing_date) : '—'}</p>
                </div>
            </div>

            {(post.description || post.requirements) && (
                <div className="grid gap-3 md:grid-cols-2">
                    {post.description && (
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <p className="text-xs font-medium text-gray-500">{detail.description}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{post.description}</p>
                        </div>
                    )}
                    {post.requirements && (
                        <div className="rounded-lg border border-gray-200 bg-white p-3">
                            <p className="text-xs font-medium text-gray-500">{detail.requirements}</p>
                            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{post.requirements}</p>
                        </div>
                    )}
                </div>
            )}

            <section className="space-y-2">
                <h2 className="text-sm font-semibold text-gray-900">{detail.pipeline}</h2>

                {applications.length === 0 ? (
                    <p className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500">
                        {detail.noApplications}
                    </p>
                ) : (
                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {APPLICATION_STAGES.map((stage) => {
                            const column = applications.filter((application) => application.stage === stage);
                            if (column.length === 0 && !isOpenStage(stage)) return null;

                            return (
                                <div key={stage} className="rounded-lg border border-gray-200 bg-gray-50 p-2">
                                    <div className="flex items-center justify-between px-1 pb-2">
                                        <StatusBadge tone={stageTone(stage)}>{t.recruitment.stages[stage]}</StatusBadge>
                                        <span className="text-xs text-gray-500">{column.length}</span>
                                    </div>

                                    <div className="space-y-2">
                                        {column.map((application) => (
                                            <div key={application.id} className="rounded-md border border-gray-200 bg-white p-2">
                                                <p className="text-sm font-medium text-gray-900">
                                                    {application.applicant?.name}
                                                </p>
                                                <p className="text-xs text-gray-500">{application.applicant?.phone}</p>
                                                <p className="mt-1 text-xs text-gray-400">
                                                    {t.recruitment.applications.appliedOn}: {formatDate(application.applied_at)}
                                                </p>

                                                {application.hiredEmployee && (
                                                    <p className="mt-1 text-xs text-emerald-700">
                                                        {application.hiredEmployee.employee_code}
                                                    </p>
                                                )}

                                                <div className="mt-2 flex flex-wrap gap-1">
                                                    {application.applicant?.resume_url && (
                                                        <a
                                                            href={application.applicant.resume_url}
                                                            target="_blank"
                                                            rel="noreferrer noopener"
                                                            className="inline-flex min-h-touch items-center gap-1 text-xs text-blue-600 hover:underline"
                                                        >
                                                            <FileText className="h-3.5 w-3.5" />
                                                            {t.recruitment.applicants.resume}
                                                        </a>
                                                    )}
                                                    {application.stage !== 'HIRED' && (
                                                        <Button variant="ghost" onClick={() => setStageTarget(application)}>
                                                            {t.recruitment.applications.actions.move}
                                                        </Button>
                                                    )}
                                                    {isOpenStage(application.stage) && (
                                                        <Button variant="ghost" onClick={() => setHireTarget(application)}>
                                                            <UserCheck className="h-3.5 w-3.5" />
                                                            {t.recruitment.applications.actions.hire}
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {column.length === 0 && (
                                            <p className="px-1 py-3 text-center text-xs text-gray-400">
                                                {formatMessage(copy.applicationCount, { count: 0 })}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </section>

            {addOpen && (
                <ApplicationModal
                    jobPost={post}
                    onClose={() => setAddOpen(false)}
                    onSaved={load}
                />
            )}

            {stageTarget && (
                <StageModal
                    application={stageTarget}
                    onClose={() => setStageTarget(null)}
                    onSaved={load}
                />
            )}

            {hireTarget && (
                <HireModal
                    application={hireTarget}
                    onClose={() => setHireTarget(null)}
                    onHired={load}
                />
            )}
        </PageShell>
    );
}
