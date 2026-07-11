'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, CheckCircle, XCircle, Rocket, RefreshCw } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { routes } from '@/lib/routes';
import { fetchWithAuth } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type DeployRun = {
    id: number;
    status: string;
    conclusion: string | null;
    url: string;
    createdAt: string;
    title: string;
};

type DeployStatus = {
    liveSha: string | null;
    productionBranch: string;
    mainSha: string | null;
    aheadBy: number | null;
    lastRun: DeployRun | null;
};

type Toast = { type: 'success' | 'error'; message: string } | null;

/** A deploy run that is still in flight (no terminal conclusion yet). */
function isRunActive(run: DeployRun | null): boolean {
    return !!run && run.status !== 'completed';
}

function ToastBanner({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
    useEffect(() => {
        if (!toast) return;
        const t = setTimeout(onDismiss, 4000);
        return () => clearTimeout(t);
    }, [toast, onDismiss]);

    if (!toast) return null;
    const isOk = toast.type === 'success';
    return (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-xl px-4 py-3 shadow-lg border text-sm font-semibold ${isOk ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
            {isOk ? <CheckCircle className="w-4 h-4 text-green-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
            {toast.message}
        </div>
    );
}

function sha(short: string | null): string {
    return short ? short.slice(0, 7) : '—';
}

function runBadge(run: DeployRun | null): { label: string; cls: string } {
    if (!run) return { label: 'never run', cls: 'bg-gray-100 text-gray-500' };
    if (run.status !== 'completed') return { label: run.status.replace('_', ' '), cls: 'bg-blue-50 text-blue-700' };
    if (run.conclusion === 'success') return { label: 'success', cls: 'bg-green-50 text-green-700' };
    return { label: run.conclusion ?? 'failed', cls: 'bg-red-50 text-red-700' };
}

export default function ProductionDeployPage() {
    const { t } = useI18n();
    const [status, setStatus] = useState<DeployStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [deploying, setDeploying] = useState(false);
    const [toast, setToast] = useState<Toast>(null);

    const load = useCallback(async () => {
        try {
            const d = (await fetchWithAuth('/admin/deploy/status')) as DeployStatus;
            setStatus(d);
        } catch {
            setToast({ type: 'error', message: 'Failed to load deploy status.' });
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    // Poll while a deploy run is in flight so the card reflects the live outcome.
    useEffect(() => {
        if (!isRunActive(status?.lastRun ?? null)) return;
        const id = setInterval(load, 8000);
        return () => clearInterval(id);
    }, [status?.lastRun, load]);

    async function handleDeploy() {
        const ahead = status?.aheadBy;
        const confirmMsg = ahead && ahead > 0
            ? `Deploy ${ahead} commit(s) from ${status?.productionBranch} to production?`
            : 'Trigger a production deploy?';
        if (!window.confirm(confirmMsg)) return;
        setDeploying(true);
        try {
            await fetchWithAuth('/admin/deploy', { method: 'POST' });
            setToast({ type: 'success', message: 'Production deploy triggered.' });
            // Give GitHub a moment to register the run, then refresh.
            setTimeout(load, 2500);
        } catch (e: any) {
            setToast({ type: 'error', message: e.message ?? 'Failed to trigger deploy.' });
        } finally {
            setDeploying(false);
        }
    }

    const badge = runBadge(status?.lastRun ?? null);
    const active = isRunActive(status?.lastRun ?? null);
    const ahead = status?.aheadBy ?? null;
    const upToDate = ahead === 0;

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="max-w-2xl mx-auto space-y-6">
                <PageHeader
                    title="Production Deploy"
                    breadcrumbs={nestedPageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.admin,
                        'admin',
                        [{ label: t.admin.platformSettings.index.title, href: routes.admin.platformSettings.root }],
                        'Production Deploy',
                    )}
                />

                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    <strong>Ships to real users.</strong> This rebuilds and restarts the production stack on the VPS from the
                    latest <code>{status?.productionBranch ?? 'main'}</code>. Feedback Automation auto-promotes green work to{' '}
                    <code>{status?.productionBranch ?? 'main'}</code>, but it never deploys — that is this button.
                </div>

                {loading ? (
                    <div className="flex items-center gap-2 text-gray-400 text-sm py-8 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Live in production</p>
                                <p className="mt-1 font-mono text-sm text-gray-800">{sha(status?.liveSha ?? null)}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                                    {status?.productionBranch ?? 'main'} tip
                                </p>
                                <p className="mt-1 font-mono text-sm text-gray-800">{sha(status?.mainSha ?? null)}</p>
                            </div>
                        </div>

                        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-sm">
                            {ahead === null ? (
                                <span className="text-gray-500">Cannot determine how many commits are pending (unknown live version).</span>
                            ) : upToDate ? (
                                <span className="flex items-center gap-2 text-green-700 font-semibold">
                                    <CheckCircle className="w-4 h-4" /> Production is up to date — nothing to deploy.
                                </span>
                            ) : (
                                <span className="text-gray-700">
                                    <span className="font-bold text-amber-600">{ahead} commit{ahead === 1 ? '' : 's'}</span> on{' '}
                                    <code>{status?.productionBranch}</code> not yet live.
                                </span>
                            )}
                        </div>

                        <div className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
                            <div className="min-w-0">
                                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Last deploy</p>
                                {status?.lastRun ? (
                                    <a href={status.lastRun.url} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline truncate block">
                                        {new Date(status.lastRun.createdAt).toLocaleString()} · {status.lastRun.title || `run #${status.lastRun.id}`}
                                    </a>
                                ) : (
                                    <p className="text-sm text-gray-400">No deploys yet.</p>
                                )}
                            </div>
                            <span className={`ml-3 flex-shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
                                {active && <Loader2 className="w-3 h-3 animate-spin" />}
                                {badge.label}
                            </span>
                        </div>

                        <div className="flex items-center gap-3 pt-1">
                            <button
                                onClick={handleDeploy}
                                disabled={deploying || active}
                                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shadow-sm"
                            >
                                {deploying || active ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                                {active ? 'Deploy running…' : deploying ? 'Triggering…' : 'Deploy to Production'}
                            </button>
                            <button
                                onClick={load}
                                className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-600 hover:border-gray-300 transition-colors"
                            >
                                <RefreshCw className="w-4 h-4" /> Refresh
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
        </div>
    );
}
