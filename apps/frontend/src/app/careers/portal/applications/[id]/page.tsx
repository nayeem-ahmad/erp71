'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Building2, FileText } from 'lucide-react';
import {
    CAREERS_EMPLOYMENT_TYPE_LABELS,
    CAREERS_STAGE_LABELS,
    isCareersTerminalStage,
    type CareersApplication,
} from '@erp71/shared-types';
import { careersApi } from '@/lib/careers-api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { routes } from '@/lib/routes';
import StageChip from '../../StageChip';
import { useRequireApplicant } from '../../useRequireApplicant';

/** One application, with the progress the hiring company has recorded. */
export default function CareersApplicationDetailPage() {
    const ready = useRequireApplicant();
    const params = useParams();
    const id = params?.id as string;

    const [application, setApplication] = useState<CareersApplication | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [withdrawing, setWithdrawing] = useState(false);

    useEffect(() => {
        if (!ready || !id) return;
        careersApi
            .getApplication(id)
            .then(setApplication)
            .catch((err) => setError(err?.message || 'Could not load this application.'))
            .finally(() => setLoading(false));
    }, [ready, id]);

    const withdraw = async () => {
        setWithdrawing(true);
        setError('');
        try {
            setApplication(await careersApi.withdraw(id));
        } catch (err: any) {
            setError(err?.message || 'Could not withdraw this application.');
        } finally {
            setWithdrawing(false);
        }
    };

    if (!ready || loading) return <p className="p-6 text-center text-sm text-gray-500">Loading…</p>;

    if (!application) {
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                <p className="text-sm font-semibold text-gray-700">
                    {error || 'Application not found.'}
                </p>
                <Link
                    href={routes.careers.portal}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
                >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    My applications
                </Link>
            </div>
        );
    }

    return (
        <div className="mx-auto w-full max-w-2xl space-y-4">
            <Link
                href={routes.careers.portal}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                My applications
            </Link>

            {error ? (
                <p className="rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-700">
                    {error}
                </p>
            ) : null}

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">
                            {application.job.title}
                        </h1>
                        <p className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-gray-600">
                            <Building2 className="h-4 w-4 text-gray-400" aria-hidden="true" />
                            {application.company.name}
                        </p>
                    </div>
                    <StageChip stage={application.stage} />
                </div>

                <dl className="mt-3 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-2">
                    <div className="flex justify-between gap-2 sm:block">
                        <dt className="text-gray-500">Applied</dt>
                        <dd className="font-medium text-gray-800">
                            {formatDateTime(application.applied_at)}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:block">
                        <dt className="text-gray-500">Last update</dt>
                        <dd className="font-medium text-gray-800">
                            {formatDateTime(application.stage_changed_at)}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:block">
                        <dt className="text-gray-500">Employment type</dt>
                        <dd className="font-medium text-gray-800">
                            {CAREERS_EMPLOYMENT_TYPE_LABELS[application.job.employment_type]}
                        </dd>
                    </div>
                    <div className="flex justify-between gap-2 sm:block">
                        <dt className="text-gray-500">Reference</dt>
                        <dd className="font-medium text-gray-800">{application.job.code}</dd>
                    </div>
                    {application.expected_salary !== null ? (
                        <div className="flex justify-between gap-2 sm:block">
                            <dt className="text-gray-500">Expected salary</dt>
                            <dd className="font-medium text-gray-800">
                                {formatBDT(application.expected_salary)}
                            </dd>
                        </div>
                    ) : null}
                </dl>

                <div className="mt-3 flex flex-wrap items-center gap-2">
                    {application.resume_url ? (
                        <a
                            href={application.resume_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-touch"
                        >
                            <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                            CV sent to this company
                        </a>
                    ) : null}

                    {isCareersTerminalStage(application.stage) ? null : (
                        <button
                            type="button"
                            onClick={withdraw}
                            disabled={withdrawing}
                            className="ml-auto inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 max-md:min-h-touch"
                        >
                            {withdrawing ? 'Withdrawing…' : 'Withdraw application'}
                        </button>
                    )}
                </div>
            </div>

            {application.cover_letter ? (
                <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                    <h2 className="text-sm font-bold text-gray-950">Your note to the employer</h2>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                        {application.cover_letter}
                    </p>
                </section>
            ) : null}

            <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h2 className="text-sm font-bold text-gray-950">Progress</h2>
                <p className="mt-0.5 text-xs text-gray-500">
                    The stages this company has moved you through.
                </p>

                {application.timeline?.length ? (
                    <ol className="mt-3 space-y-3">
                        {application.timeline.map((entry) => (
                            <li key={entry.id} className="flex gap-3">
                                <span
                                    className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-blue-600"
                                    aria-hidden="true"
                                />
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-800">
                                        {CAREERS_STAGE_LABELS[entry.to_stage]}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                        {formatDateTime(entry.created_at)}
                                    </p>
                                </div>
                            </li>
                        ))}
                    </ol>
                ) : (
                    <p className="mt-1.5 text-sm text-gray-500">No updates yet.</p>
                )}
            </section>
        </div>
    );
}
