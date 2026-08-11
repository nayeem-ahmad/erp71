'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, ExternalLink, UserCog } from 'lucide-react';
import {
    CAREERS_EMPLOYMENT_TYPE_LABELS,
    isCareersTerminalStage,
    type CareersApplication,
} from '@erp71/shared-types';
import { careersApi } from '@/lib/careers-api';
import { formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';
import StageChip from './StageChip';
import { useRequireApplicant } from './useRequireApplicant';

/**
 * The point of the whole portal: every application this person has sent, to
 * every company on the platform, in one list.
 */
export default function CareersPortalPage() {
    const ready = useRequireApplicant();

    const [applications, setApplications] = useState<CareersApplication[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [withdrawing, setWithdrawing] = useState<string | null>(null);
    const [missing, setMissing] = useState<string[]>([]);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [rows, profile] = await Promise.all([
                careersApi.listApplications(),
                careersApi.getProfile(),
            ]);
            setApplications(rows);
            // Applying is refused without both, so say so before they try.
            setMissing([
                ...(profile.resume_url ? [] : ['a CV']),
                ...(profile.phone ? [] : ['a mobile number']),
            ]);
        } catch (err: any) {
            setError(err?.message || 'Could not load your applications.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (ready) void load();
    }, [ready, load]);

    const withdraw = async (id: string) => {
        setWithdrawing(id);
        setError('');
        try {
            const updated = await careersApi.withdraw(id);
            setApplications((rows) => rows.map((row) => (row.id === id ? updated : row)));
        } catch (err: any) {
            setError(err?.message || 'Could not withdraw that application.');
        } finally {
            setWithdrawing(null);
        }
    };

    const active = useMemo(
        () => applications.filter((row) => !isCareersTerminalStage(row.stage)).length,
        [applications],
    );

    if (!ready) return <p className="p-6 text-center text-sm text-gray-500">Loading…</p>;

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">My applications</h1>
                    <p className="mt-0.5 text-xs text-gray-500">
                        {applications.length} total · {active} still in progress
                    </p>
                </div>
                <Link
                    href={routes.careers.profile}
                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-touch"
                >
                    <UserCog className="h-3.5 w-3.5" aria-hidden="true" />
                    My profile
                </Link>
            </div>

            {missing.length ? (
                <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
                    Add {missing.join(' and ')} to your profile before applying — companies cannot
                    review an application without it.{' '}
                    <Link href={routes.careers.profile} className="font-semibold underline">
                        Add it now
                    </Link>
                </div>
            ) : null}

            {error ? (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <p className="p-6 text-center text-sm text-gray-500">Loading…</p>
            ) : applications.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                    <p className="text-sm font-semibold text-gray-700">You have not applied anywhere yet.</p>
                    <Link
                        href={routes.careers.root}
                        className="mt-3 inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 max-md:min-h-touch"
                    >
                        Browse open roles
                    </Link>
                </div>
            ) : (
                <ul className="space-y-2">
                    {applications.map((application) => (
                        <li
                            key={application.id}
                            className="rounded-lg border border-gray-200 bg-white p-3 md:p-4"
                        >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-gray-950">
                                        {application.job.title}
                                    </p>
                                    <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-gray-500">
                                        <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                                        {application.company.name}
                                    </p>
                                </div>
                                <StageChip stage={application.stage} />
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                                    {CAREERS_EMPLOYMENT_TYPE_LABELS[application.job.employment_type]}
                                </span>
                                <span>{application.job.location || 'Location not stated'}</span>
                                <span>Applied {formatDate(application.applied_at)}</span>
                                <span className="hidden sm:inline">
                                    Updated {formatDate(application.stage_changed_at)}
                                </span>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center gap-2">
                                <Link
                                    href={routes.careers.applicationDetail(application.id)}
                                    className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-touch"
                                >
                                    View progress
                                </Link>
                                {application.job.still_listed ? (
                                    <Link
                                        href={routes.careers.jobDetail(application.job.id)}
                                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
                                    >
                                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                                        See the job
                                    </Link>
                                ) : (
                                    <span className="text-xs text-gray-400">Listing closed</span>
                                )}

                                {isCareersTerminalStage(application.stage) ? null : (
                                    <button
                                        type="button"
                                        onClick={() => withdraw(application.id)}
                                        disabled={withdrawing === application.id}
                                        className="ml-auto inline-flex items-center rounded-md px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60 max-md:min-h-touch"
                                    >
                                        {withdrawing === application.id ? 'Withdrawing…' : 'Withdraw'}
                                    </button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
