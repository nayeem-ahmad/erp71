'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Building2, CheckCircle2, MapPin, Search } from 'lucide-react';
import {
    CAREERS_EMPLOYMENT_TYPE_LABELS,
    CAREERS_EMPLOYMENT_TYPE_VALUES,
    type CareersJobSummary,
} from '@erp71/shared-types';
import { careersApi, getCareersToken } from '@/lib/careers-api';
import { formatBDT } from '@/lib/format';
import { routes } from '@/lib/routes';

type Company = { id: string; name: string; open_jobs: number };

/** "৳25,000 – ৳40,000 / month", or nothing when the company did not disclose. */
function salaryLabel(job: CareersJobSummary): string | null {
    if (job.salary_min === null && job.salary_max === null) return null;
    if (job.salary_min !== null && job.salary_max !== null) {
        return `${formatBDT(job.salary_min)} – ${formatBDT(job.salary_max)} / month`;
    }
    return `From ${formatBDT(job.salary_min ?? job.salary_max)} / month`;
}

export default function CareersBoardPage() {
    const [jobs, setJobs] = useState<CareersJobSummary[]>([]);
    const [companies, setCompanies] = useState<Company[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [search, setSearch] = useState('');
    const [companyId, setCompanyId] = useState('');
    const [employmentType, setEmploymentType] = useState('');
    const [location, setLocation] = useState('');
    const [signedIn, setSignedIn] = useState(false);

    useEffect(() => {
        setSignedIn(Boolean(getCareersToken()));
        careersApi.listCompanies().then(setCompanies).catch(() => setCompanies([]));
    }, []);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const result = await careersApi.listJobs({
                search: search || undefined,
                company_id: companyId || undefined,
                employment_type: employmentType || undefined,
                location: location || undefined,
            });
            setJobs(result.jobs);
            setTotal(result.meta.total);
        } catch (err: any) {
            setError(err?.message || 'Could not load jobs right now.');
        } finally {
            setLoading(false);
        }
    }, [search, companyId, employmentType, location]);

    // Debounced so typing does not fire a request per keystroke.
    useEffect(() => {
        const timer = setTimeout(load, 250);
        return () => clearTimeout(timer);
    }, [load]);

    return (
        <div className="space-y-4">
            <div>
                <h1 className="text-lg font-bold tracking-tight text-gray-950">Open roles</h1>
                <p className="mt-0.5 text-xs text-gray-500">
                    {signedIn
                        ? 'Apply with your saved profile and track every application in one place.'
                        : 'Create one account to apply to any company hiring on ERP71.'}
                </p>
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-gray-100 bg-white p-3">
                <label className="min-w-[200px] flex-1">
                    <span className="sr-only">Search jobs</span>
                    <div className="relative">
                        <Search
                            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                            aria-hidden="true"
                        />
                        <input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search by title or keyword"
                            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                        />
                    </div>
                </label>

                <label className="min-w-[160px]">
                    <span className="mb-1 block text-xs font-medium text-gray-500">Company</span>
                    <select
                        value={companyId}
                        onChange={(e) => setCompanyId(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                    >
                        <option value="">All companies</option>
                        {companies.map((company) => (
                            <option key={company.id} value={company.id}>
                                {company.name} ({company.open_jobs})
                            </option>
                        ))}
                    </select>
                </label>

                <label className="min-w-[140px]">
                    <span className="mb-1 block text-xs font-medium text-gray-500">Type</span>
                    <select
                        value={employmentType}
                        onChange={(e) => setEmploymentType(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                    >
                        <option value="">Any type</option>
                        {CAREERS_EMPLOYMENT_TYPE_VALUES.map((value) => (
                            <option key={value} value={value}>
                                {CAREERS_EMPLOYMENT_TYPE_LABELS[value]}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="min-w-[140px]">
                    <span className="mb-1 block text-xs font-medium text-gray-500">Location</span>
                    <input
                        value={location}
                        onChange={(e) => setLocation(e.target.value)}
                        placeholder="Dhaka"
                        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-sm focus:border-blue-400 focus:ring-2 focus:ring-blue-100 max-md:min-h-touch"
                    />
                </label>
            </div>

            {error ? (
                <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                    {error}
                </div>
            ) : null}

            {loading ? (
                <p className="p-6 text-center text-sm text-gray-500">Loading jobs…</p>
            ) : jobs.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
                    <p className="text-sm font-semibold text-gray-700">No open roles match that.</p>
                    <p className="mt-1 text-xs text-gray-500">
                        Try clearing the filters, or check back later.
                    </p>
                </div>
            ) : (
                <>
                    <p className="text-xs text-gray-500">
                        {total} open {total === 1 ? 'role' : 'roles'}
                    </p>

                    <ul className="space-y-2">
                        {jobs.map((job) => {
                            const salary = salaryLabel(job);
                            return (
                                <li key={job.id}>
                                    <Link
                                        href={routes.careers.jobDetail(job.id)}
                                        className="block rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-blue-200 hover:bg-blue-50/40 md:p-4"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold text-gray-950">
                                                    {job.title}
                                                </p>
                                                <p className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-gray-500">
                                                    <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                    {job.company.name}
                                                    {job.department ? ` · ${job.department}` : ''}
                                                </p>
                                            </div>

                                            {job.already_applied ? (
                                                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                                                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                                                    Applied
                                                </span>
                                            ) : null}
                                        </div>

                                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-600">
                                            <span className="inline-flex items-center gap-1">
                                                <MapPin className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
                                                {job.location || 'Location not stated'}
                                            </span>
                                            <span className="rounded bg-gray-100 px-1.5 py-0.5 font-medium text-gray-700">
                                                {CAREERS_EMPLOYMENT_TYPE_LABELS[job.employment_type]}
                                            </span>
                                            {salary ? <span>{salary}</span> : null}
                                            {job.openings > 1 ? <span>{job.openings} openings</span> : null}
                                        </div>
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </>
            )}
        </div>
    );
}
