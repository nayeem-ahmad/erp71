'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ArrowLeft, Building2, CheckCircle2, MapPin } from 'lucide-react';
import {
    CAREERS_EMPLOYMENT_TYPE_LABELS,
    type CareersJobDetail,
} from '@erp71/shared-types';
import { careersApi, getCareersToken } from '@/lib/careers-api';
import { formatBDT, formatDate } from '@/lib/format';
import { routes } from '@/lib/routes';

export default function CareersJobDetailPage() {
    const params = useParams();
    const router = useRouter();
    const jobId = params?.id as string;

    const [job, setJob] = useState<CareersJobDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [signedIn, setSignedIn] = useState(false);
    const [showForm, setShowForm] = useState(false);
    const [coverLetter, setCoverLetter] = useState('');
    const [expectedSalary, setExpectedSalary] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    const [applied, setApplied] = useState(false);

    useEffect(() => {
        setSignedIn(Boolean(getCareersToken()));
    }, []);

    useEffect(() => {
        if (!jobId) return;
        careersApi
            .getJob(jobId)
            .then((result) => {
                setJob(result);
                setApplied(Boolean(result.already_applied));
            })
            .catch((err) => setError(err?.message || 'This job could not be loaded.'))
            .finally(() => setLoading(false));
    }, [jobId]);

    const startApply = () => {
        if (!signedIn) {
            // Come back here after signing in rather than dumping them on the board.
            router.push(
                `${routes.careers.login}?redirect=${encodeURIComponent(routes.careers.jobDetail(jobId))}`,
            );
            return;
        }
        setShowForm(true);
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitError('');
        setSubmitting(true);
        try {
            await careersApi.apply(jobId, {
                cover_letter: coverLetter || undefined,
                ...(expectedSalary ? { expected_salary: Number(expectedSalary) } : {}),
            });
            setApplied(true);
            setShowForm(false);
        } catch (err: any) {
            setSubmitError(err?.message || 'Could not submit your application.');
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <p className="p-6 text-center text-sm text-gray-500">Loading…</p>;

    if (error || !job) {
        return (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                <p className="text-sm font-semibold text-gray-700">
                    {error || 'This job is no longer available.'}
                </p>
                <Link
                    href={routes.careers.root}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
                >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Back to all jobs
                </Link>
            </div>
        );
    }

    const salary =
        job.salary_min !== null || job.salary_max !== null
            ? job.salary_min !== null && job.salary_max !== null
                ? `${formatBDT(job.salary_min)} – ${formatBDT(job.salary_max)} / month`
                : `From ${formatBDT(job.salary_min ?? job.salary_max)} / month`
            : null;

    return (
        <div className="space-y-4">
            <Link
                href={routes.careers.root}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-gray-600 hover:text-gray-900"
            >
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                All jobs
            </Link>

            <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                <h1 className="text-lg font-bold tracking-tight text-gray-950">{job.title}</h1>
                <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-gray-600">
                    <Building2 className="h-4 w-4 text-gray-400" aria-hidden="true" />
                    {job.company.name}
                    {job.department ? ` · ${job.department}` : ''}
                </p>

                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-gray-600">
                    <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                        {job.location || 'Location not stated'}
                    </span>
                    <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                        {CAREERS_EMPLOYMENT_TYPE_LABELS[job.employment_type]}
                    </span>
                    {salary ? <span>{salary}</span> : null}
                    {job.openings > 1 ? <span>{job.openings} openings</span> : null}
                    {job.closing_date ? <span>Closes {formatDate(job.closing_date)}</span> : null}
                    <span className="text-gray-400">Ref {job.code}</span>
                </div>

                <div className="mt-4">
                    {applied ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50 p-3">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
                            <span className="text-sm font-semibold text-emerald-800">
                                You have applied to this role.
                            </span>
                            <Link
                                href={routes.careers.portal}
                                className="text-xs font-semibold text-blue-600 hover:underline"
                            >
                                Track it in your portal
                            </Link>
                        </div>
                    ) : showForm ? null : (
                        <button
                            type="button"
                            onClick={startApply}
                            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 max-md:min-h-touch"
                        >
                            {signedIn ? 'Apply now' : 'Sign in to apply'}
                        </button>
                    )}
                </div>
            </div>

            {showForm ? (
                <form
                    onSubmit={submit}
                    className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
                >
                    <h2 className="text-base font-bold tracking-tight text-gray-950">
                        Apply for {job.title}
                    </h2>
                    <p className="text-xs text-gray-500">
                        Your saved profile and CV are sent with this application.{' '}
                        <Link href={routes.careers.profile} className="font-semibold text-blue-600 hover:underline">
                            Review your profile
                        </Link>
                    </p>

                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-gray-500">
                            Note to the employer <span className="text-gray-400">(optional)</span>
                        </span>
                        <textarea
                            value={coverLetter}
                            onChange={(e) => setCoverLetter(e.target.value)}
                            rows={6}
                            maxLength={5000}
                            placeholder="Why you are a good fit for this role"
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                        />
                    </label>

                    <label className="block max-w-xs">
                        <span className="mb-1 block text-xs font-medium text-gray-500">
                            Expected monthly salary (BDT) <span className="text-gray-400">(optional)</span>
                        </span>
                        <input
                            type="number"
                            min={0}
                            value={expectedSalary}
                            onChange={(e) => setExpectedSalary(e.target.value)}
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                        />
                    </label>

                    {submitError ? (
                        <p className="rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-700">
                            {submitError}
                        </p>
                    ) : null}

                    <div className="flex flex-wrap gap-2">
                        <button
                            type="submit"
                            disabled={submitting}
                            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60 max-md:min-h-touch"
                        >
                            {submitting ? 'Submitting…' : 'Submit application'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setShowForm(false)}
                            className="inline-flex items-center rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 max-md:min-h-touch"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            ) : null}

            <section className="space-y-4 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
                {job.description ? (
                    <div>
                        <h2 className="text-sm font-bold text-gray-950">About the role</h2>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                            {job.description}
                        </p>
                    </div>
                ) : null}

                {job.requirements ? (
                    <div>
                        <h2 className="text-sm font-bold text-gray-950">Requirements</h2>
                        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                            {job.requirements}
                        </p>
                    </div>
                ) : null}

                {!job.description && !job.requirements ? (
                    <p className="text-sm text-gray-500">
                        This company has not added a description yet. Apply and ask them directly.
                    </p>
                ) : null}
            </section>
        </div>
    );
}
