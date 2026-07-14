'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles, CheckCircle2, XCircle, RotateCcw, ExternalLink, AlertTriangle, GitMerge } from 'lucide-react';
import { api } from '@/lib/api';
import ModalShell, { ModalHeader } from '@/components/ModalShell';

type PrReadiness = {
    state: string;
    mergeable: boolean | null;
    headSha: string;
    merged: boolean;
    mergeCommitSha: string | null;
    checks: { total: number; passed: number; failed: number; pending: number; allPassed: boolean };
    green: boolean;
};

/** Human-readable CI + mergeability summary shown next to the PR while awaiting merge. */
function ciLabel(r: PrReadiness): string {
    if (r.merged) return 'Merged';
    if (r.checks.total === 0) return 'No CI checks yet';
    if (r.checks.failed > 0) return `CI failed (${r.checks.failed} failing)`;
    if (r.checks.pending > 0) return `CI running… (${r.checks.passed}/${r.checks.total})`;
    if (r.mergeable === false) return 'CI passed · merge conflict';
    if (r.mergeable === null) return 'CI passed · checking mergeability…';
    return `CI passed (${r.checks.passed}/${r.checks.total}) · mergeable`;
}

type FeedbackPlan = {
    id: string;
    version: number;
    planText: string;
    hasMigration: boolean;
    status: 'PROPOSED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'SUPERSEDED';
    adminComment: string | null;
    createdAt: string;
};

type FeedbackDetail = {
    id: string;
    type: string;
    message: string;
    page: string | null;
    status: string;
    adminInstruction: string | null;
    prNumber: number | null;
    prUrl: string | null;
    mergeCommitSha: string | null;
    rollbackPrNumber: number | null;
    rollbackPrUrl: string | null;
    lastError: string | null;
    plans: FeedbackPlan[];
};

const WORKING_STATUSES = new Set(['PLAN_REQUESTED', 'IN_PROGRESS']);

const STATUS_LABELS: Record<string, string> = {
    NEW: 'New',
    ADMIN_REVIEWING: 'Admin reviewing',
    PLAN_REQUESTED: 'Proposing plan…',
    PLAN_PROPOSED: 'Plan proposed — awaiting review',
    PLAN_APPROVED: 'Plan approved — implementing…',
    CHANGES_REQUESTED: 'Revising plan…',
    IN_PROGRESS: 'Implementing…',
    PR_OPENED: 'PR opened — awaiting merge',
    MERGED: 'Merged',
    RESOLVED: 'Resolved',
    ROLLED_BACK: 'Rollback PR opened',
};

function StatusBadge({ status }: { status: string }) {
    const isWorking = WORKING_STATUSES.has(status);
    return (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-700">
            {isWorking && <Loader2 className="w-3 h-3 animate-spin" />}
            {STATUS_LABELS[status] ?? status}
        </span>
    );
}

export default function FeedbackAutomationPanel({ feedbackId, onClose }: { feedbackId: string; onClose: () => void }) {
    const [detail, setDetail] = useState<FeedbackDetail | null>(null);
    const [instruction, setInstruction] = useState('');
    const [comment, setComment] = useState('');
    const [confirmMigration, setConfirmMigration] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [readiness, setReadiness] = useState<PrReadiness | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const load = async () => {
        try {
            const data = (await api.getAdminFeedbackDetail(feedbackId)) as FeedbackDetail;
            setDetail(data);
            setInstruction((prev) => (prev ? prev : data.adminInstruction ?? ''));
            setError('');
        } catch (err: any) {
            setError(err.message || 'Failed to load feedback.');
        }
    };

    // Polls the PR endpoint for CI/mergeability; also flips the item to MERGED if GitHub already shows it merged.
    const refreshPr = async () => {
        const res = (await api.getFeedbackPrStatus(feedbackId)) as FeedbackDetail & { readiness?: PrReadiness };
        if (res.readiness) setReadiness(res.readiness);
        setDetail((prev) =>
            prev ? { ...prev, status: res.status, mergeCommitSha: res.mergeCommitSha, prNumber: res.prNumber, prUrl: res.prUrl } : prev,
        );
    };

    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [feedbackId]);

    useEffect(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        if (detail && WORKING_STATUSES.has(detail.status)) {
            pollRef.current = setInterval(() => void load(), 4000);
        } else if (detail && detail.status === 'PR_OPENED') {
            // While awaiting merge, keep checking CI so the Merge button lights up as soon as it's green.
            void refreshPr();
            pollRef.current = setInterval(() => void refreshPr(), 8000);
        }
        return () => { if (pollRef.current) clearInterval(pollRef.current); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [detail?.status]);

    async function run(fn: () => Promise<unknown>) {
        setBusy(true);
        setError('');
        try {
            await fn();
            await load();
        } catch (err: any) {
            setError(err.message || 'Action failed.');
        } finally {
            setBusy(false);
        }
    }

    if (!detail) {
        return (
            <ModalShell size="md" onBackdropClick={onClose}>
                <div className="p-8">
                    <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                </div>
            </ModalShell>
        );
    }

    const latestPlan = detail.plans[0];
    const canSaveInstruction = instruction.trim().length >= 3;
    const canProposePlan = !!detail.adminInstruction && ['ADMIN_REVIEWING', 'PLAN_PROPOSED', 'CHANGES_REQUESTED'].includes(detail.status);
    const canReview = latestPlan?.status === 'PROPOSED';
    const canImplementNow = detail.status === 'PLAN_APPROVED';
    const canRollback = !!detail.mergeCommitSha && detail.status !== 'ROLLED_BACK';

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader
                title={
                    <span className="flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-purple-600" />
                        Feedback automation
                    </span>
                }
                onClose={onClose}
            >
                <StatusBadge status={detail.status} />
            </ModalHeader>

            <div className="p-5 space-y-5 overflow-y-auto">
                    <div className="rounded-xl bg-gray-50 border border-gray-100 p-3 text-sm text-gray-700 whitespace-pre-wrap">
                        {detail.message}
                    </div>

                    {error && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                            {error}
                        </div>
                    )}
                    {detail.lastError && (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>Last attempt failed: {detail.lastError}</span>
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wide text-gray-500 mb-1">
                            Admin instruction
                        </label>
                        <textarea
                            value={instruction}
                            onChange={(e) => setInstruction(e.target.value)}
                            rows={3}
                            placeholder="e.g. Agreed — fix this. The discount field isn't saving on edit."
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <div className="mt-2 flex gap-2">
                            <button
                                disabled={busy || !canSaveInstruction}
                                onClick={() => run(() => api.saveFeedbackInstruction(feedbackId, instruction))}
                                className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                            >
                                Save instruction
                            </button>
                            <button
                                disabled={busy || !canProposePlan}
                                onClick={() => run(() => api.proposeFeedbackPlan(feedbackId))}
                                className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                            >
                                <Sparkles className="w-3.5 h-3.5" /> Propose plan
                            </button>
                        </div>
                    </div>

                    {latestPlan && (
                        <div className="rounded-xl border border-gray-200">
                            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
                                <span className="text-xs font-semibold text-gray-700">Plan v{latestPlan.version}</span>
                                <div className="flex items-center gap-2">
                                    {latestPlan.hasMigration && (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                            <AlertTriangle className="w-3 h-3" /> Migration
                                        </span>
                                    )}
                                    <span className="text-[10px] font-bold uppercase text-gray-400">{latestPlan.status}</span>
                                </div>
                            </div>
                            <div className="px-4 py-3 text-xs text-gray-700 whitespace-pre-wrap max-h-64 overflow-y-auto font-mono">
                                {latestPlan.planText}
                            </div>

                            {canReview && (
                                <div className="px-4 py-3 border-t border-gray-100 space-y-2">
                                    {latestPlan.hasMigration && (
                                        <label className="flex items-center gap-2 text-xs text-amber-800">
                                            <input
                                                type="checkbox"
                                                checked={confirmMigration}
                                                onChange={(e) => setConfirmMigration(e.target.checked)}
                                            />
                                            I&apos;ve reviewed this plan&apos;s database migration and approve it.
                                        </label>
                                    )}
                                    <textarea
                                        value={comment}
                                        onChange={(e) => setComment(e.target.value)}
                                        rows={2}
                                        placeholder="Comment (required to request changes; optional on approve)"
                                        className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-xs outline-none focus:ring-2 focus:ring-purple-500"
                                    />
                                    <div className="flex gap-2">
                                        <button
                                            disabled={busy || (latestPlan.hasMigration && !confirmMigration)}
                                            onClick={() =>
                                                run(() =>
                                                    api.reviewFeedbackPlan(latestPlan.id, {
                                                        decision: 'APPROVE',
                                                        comment: comment || undefined,
                                                        confirmMigration,
                                                    }),
                                                )
                                            }
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                                        >
                                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve
                                        </button>
                                        <button
                                            disabled={busy || !comment.trim()}
                                            onClick={() =>
                                                run(() =>
                                                    api.reviewFeedbackPlan(latestPlan.id, { decision: 'REQUEST_CHANGES', comment }),
                                                )
                                            }
                                            className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-bold text-gray-700 disabled:opacity-40"
                                        >
                                            <XCircle className="w-3.5 h-3.5" /> Request changes
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {canImplementNow && (
                        <button
                            disabled={busy}
                            onClick={() => run(() => api.implementFeedbackNow(feedbackId))}
                            className="text-xs font-bold text-purple-700 underline"
                        >
                            Retry implementation
                        </button>
                    )}

                    {detail.prUrl && (
                        <div className="rounded-xl border border-gray-200 p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <a href={detail.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 underline">
                                    <ExternalLink className="w-3.5 h-3.5" /> PR #{detail.prNumber}
                                </a>
                                <button
                                    disabled={busy}
                                    onClick={() => run(refreshPr)}
                                    className="text-xs font-semibold text-gray-500 hover:text-gray-700"
                                >
                                    Refresh status
                                </button>
                            </div>

                            {detail.status === 'PR_OPENED' && (
                                <div className="flex items-center justify-between gap-2 border-t border-gray-100 pt-2">
                                    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                                        !readiness ? 'text-gray-400'
                                            : readiness.green ? 'text-green-700'
                                            : readiness.checks.failed > 0 || readiness.mergeable === false ? 'text-red-600'
                                            : 'text-gray-500'
                                    }`}>
                                        {!readiness ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            : readiness.green ? <CheckCircle2 className="w-3.5 h-3.5" />
                                            : (readiness.checks.failed > 0 || readiness.mergeable === false) ? <XCircle className="w-3.5 h-3.5" />
                                            : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                        {readiness ? ciLabel(readiness) : 'Checking CI…'}
                                    </span>
                                    <button
                                        disabled={busy || !readiness?.green}
                                        onClick={() => run(() => api.mergeFeedback(feedbackId))}
                                        title={readiness?.green ? 'Merge this PR into the base branch' : 'Enabled once CI passes and the PR is conflict-free'}
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
                                    >
                                        <GitMerge className="w-3.5 h-3.5" /> Merge PR
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    {canRollback && (
                        <button
                            disabled={busy}
                            onClick={() => run(() => api.rollbackFeedback(feedbackId))}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700 disabled:opacity-40"
                        >
                            <RotateCcw className="w-3.5 h-3.5" /> Generate rollback PR
                        </button>
                    )}

                    {detail.rollbackPrUrl && (
                        <a href={detail.rollbackPrUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 underline">
                            <ExternalLink className="w-3.5 h-3.5" /> Rollback PR #{detail.rollbackPrNumber}
                        </a>
                    )}

                    {detail.plans.length > 1 && (
                        <details className="text-xs text-gray-500">
                            <summary className="cursor-pointer font-semibold">Plan history ({detail.plans.length - 1} earlier version{detail.plans.length > 2 ? 's' : ''})</summary>
                            <div className="mt-2 space-y-2">
                                {detail.plans.slice(1).map((p) => (
                                    <div key={p.id} className="rounded-lg border border-gray-100 p-2">
                                        <div className="font-bold">v{p.version} — {p.status}</div>
                                        {p.adminComment && <div className="italic mt-1">&quot;{p.adminComment}&quot;</div>}
                                    </div>
                                ))}
                            </div>
                        </details>
                    )}
            </div>
        </ModalShell>
    );
}
