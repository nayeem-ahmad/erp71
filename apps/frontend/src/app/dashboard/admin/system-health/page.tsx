'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Loader2,
    RefreshCw,
    ShieldCheck,
    XCircle,
    MinusCircle,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type DependencyState = 'ok' | 'degraded' | 'down' | 'disabled' | 'unknown';

type CheckResult = {
    name: string;
    label: string;
    state: DependencyState;
    latency_ms?: number;
    message?: string;
    critical: boolean;
    details?: Record<string, unknown>;
};

type SystemHealthReport = {
    status: DependencyState;
    generated_at: string;
    uptime_seconds: number;
    duration_ms: number;
    checks: CheckResult[];
};

type JobStatus = {
    name: string;
    label: string;
    schedule: string;
    last_run_at: string | null;
    last_status: string | null;
    last_success_at: string | null;
    last_duration_ms: number | null;
    last_error: string | null;
    overdue: boolean;
};

const REFRESH_MS = 20000;

const STATE_STYLES: Record<DependencyState, { dot: string; chip: string }> = {
    ok: { dot: 'bg-emerald-500', chip: 'bg-emerald-100 text-emerald-700' },
    degraded: { dot: 'bg-amber-500', chip: 'bg-amber-100 text-amber-700' },
    down: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700' },
    disabled: { dot: 'bg-gray-300', chip: 'bg-gray-100 text-gray-500' },
    unknown: { dot: 'bg-slate-400', chip: 'bg-slate-100 text-slate-600' },
};

function formatTimestamp(value: string | null): string {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function formatUptime(seconds: number): string {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export default function SystemHealthPage() {
    const { t } = useI18n();
    const m = t.admin.systemHealth;

    const [report, setReport] = useState<SystemHealthReport | null>(null);
    const [jobs, setJobs] = useState<JobStatus[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const timer = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = useCallback(async () => {
        setIsRefreshing(true);
        try {
            const [reportData, jobsData] = await Promise.all([
                api.getSystemHealth() as Promise<SystemHealthReport>,
                api.getSystemHealthJobs() as Promise<JobStatus[]>,
            ]);
            setReport(reportData);
            setJobs(jobsData);
            setError('');
        } catch (err: any) {
            setError(err?.message || m.loadFailed);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, [m.loadFailed]);

    useEffect(() => {
        load();
    }, [load]);

    useEffect(() => {
        if (autoRefresh) {
            timer.current = setInterval(load, REFRESH_MS);
        }
        return () => {
            if (timer.current) clearInterval(timer.current);
        };
    }, [autoRefresh, load]);

    const stateLabel = (state: DependencyState) => m.status[state] ?? state;

    const jobStateLabel = (job: JobStatus) => {
        if (!job.last_run_at) return m.jobState.never;
        if (job.last_status === 'FAILED') return m.jobState.failed;
        if (job.overdue) return m.jobState.overdue;
        return m.jobState.healthy;
    };

    const jobState = (job: JobStatus): DependencyState => {
        if (!job.last_run_at) return 'unknown';
        if (job.last_status === 'FAILED' || job.overdue) return 'degraded';
        return 'ok';
    };

    // The cron rollup lives in the report's checks; show the rest separately.
    const dependencyChecks = report?.checks.filter((c) => c.name !== 'cron_jobs') ?? [];

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-8">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <ShieldCheck className="w-5 h-5 text-indigo-600" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-indigo-600">{m.badge}</p>
                        </div>
                        <h1 className="text-3xl font-black tracking-tight">{m.title}</h1>
                        <p className="mt-1 text-sm text-gray-500">{m.description}</p>
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs font-semibold text-gray-500">
                            <input
                                type="checkbox"
                                checked={autoRefresh}
                                onChange={(e) => setAutoRefresh(e.target.checked)}
                                className="rounded border-gray-300"
                            />
                            {m.autoRefresh}
                        </label>
                        <button
                            onClick={load}
                            disabled={isRefreshing}
                            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                            {m.refresh}
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>
                )}

                {isLoading ? (
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" /> {m.loading}
                    </div>
                ) : report && (
                    <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div className="rounded-3xl border border-gray-100 bg-white p-6 sm:col-span-1">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.overallStatus}</p>
                                <div className="mt-3 flex items-center gap-2">
                                    <StatusIcon state={report.status} />
                                    <span className={`rounded-full px-3 py-1 text-sm font-black ${STATE_STYLES[report.status].chip}`}>
                                        {stateLabel(report.status)}
                                    </span>
                                </div>
                            </div>
                            <div className="rounded-3xl border border-gray-100 bg-white p-6">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.uptime}</p>
                                <div className="mt-3 flex items-center gap-2 text-2xl font-black">
                                    <Clock className="w-5 h-5 text-gray-400" /> {formatUptime(report.uptime_seconds)}
                                </div>
                            </div>
                            <div className="rounded-3xl border border-gray-100 bg-white p-6">
                                <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">{m.lastUpdated}</p>
                                <p className="mt-3 text-sm font-semibold text-gray-700">{formatTimestamp(report.generated_at)}</p>
                            </div>
                        </div>

                        {/* Dependencies & checks */}
                        <div className="rounded-3xl border border-gray-100 bg-white p-6">
                            <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-400">
                                <Activity className="w-4 h-4" /> {m.sections.checks}
                            </h2>
                            <div className="divide-y divide-gray-100">
                                {dependencyChecks.map((c) => (
                                    <div key={c.name} className="flex items-center justify-between gap-4 py-3">
                                        <div className="flex items-center gap-3 min-w-0">
                                            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATE_STYLES[c.state].dot}`} />
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-bold text-gray-800">{c.label}</p>
                                                {c.message && <p className="truncate text-xs text-gray-500">{c.message}</p>}
                                            </div>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3">
                                            {typeof c.latency_ms === 'number' && (
                                                <span className="text-xs font-mono text-gray-400">{c.latency_ms}ms</span>
                                            )}
                                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATE_STYLES[c.state].chip}`}>
                                                {stateLabel(c.state)}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Scheduled jobs */}
                        <div className="rounded-3xl border border-gray-100 bg-white p-6">
                            <h2 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-gray-400">
                                <Clock className="w-4 h-4" /> {m.sections.jobs}
                            </h2>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead>
                                        <tr className="text-[10px] font-black uppercase tracking-widest text-gray-400">
                                            <th className="pb-2 pr-4">{m.table.job}</th>
                                            <th className="pb-2 pr-4">{m.table.schedule}</th>
                                            <th className="pb-2 pr-4">{m.table.lastRun}</th>
                                            <th className="pb-2 pr-4">{m.table.duration}</th>
                                            <th className="pb-2">{m.table.state}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {jobs.map((job) => (
                                            <tr key={job.name}>
                                                <td className="py-2 pr-4 font-semibold text-gray-800">{job.label}</td>
                                                <td className="py-2 pr-4 font-mono text-xs text-gray-500">{job.schedule}</td>
                                                <td className="py-2 pr-4 text-xs text-gray-600">{formatTimestamp(job.last_run_at)}</td>
                                                <td className="py-2 pr-4 text-xs text-gray-600">
                                                    {job.last_duration_ms != null ? `${job.last_duration_ms}ms` : '—'}
                                                </td>
                                                <td className="py-2">
                                                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${STATE_STYLES[jobState(job)].chip}`}>
                                                        {jobStateLabel(job)}
                                                    </span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function StatusIcon({ state }: { state: DependencyState }) {
    if (state === 'ok') return <CheckCircle2 className="w-6 h-6 text-emerald-500" />;
    if (state === 'degraded') return <AlertTriangle className="w-6 h-6 text-amber-500" />;
    if (state === 'down') return <XCircle className="w-6 h-6 text-red-500" />;
    return <MinusCircle className="w-6 h-6 text-gray-400" />;
}
