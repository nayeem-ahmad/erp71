'use client';

import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Clock, AlertCircle, Plus, Phone, RefreshCw, CheckCheck, Trash2 } from 'lucide-react';
import { api } from '../../../../lib/api';
import { formatDate } from '../../../../lib/format';
import Link from 'next/link';

interface CrmTask {
    id: string;
    customer_id: string;
    type: string;
    title: string;
    due_at: string;
    completed_at: string | null;
    status: string;
    notes: string | null;
    customer: { id: string; name: string; phone: string };
    assignee: { id: string; name: string; email: string } | null;
}

interface TaskSummary {
    dueToday: number;
    overdue: number;
    total: number;
}

const typeColors: Record<string, string> = {
    FOLLOW_UP: 'bg-blue-50 text-blue-700',
    COLLECTION: 'bg-amber-50 text-amber-700',
    BIRTHDAY: 'bg-rose-50 text-rose-700',
    REORDER_REMINDER: 'bg-violet-50 text-violet-700',
};

const typeLabels: Record<string, string> = {
    FOLLOW_UP: 'Follow Up',
    COLLECTION: 'Collection',
    BIRTHDAY: 'Birthday',
    REORDER_REMINDER: 'Reorder',
};

export default function CrmTasksPage() {
    const [tasks, setTasks] = useState<CrmTask[]>([]);
    const [summary, setSummary] = useState<TaskSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState<'PENDING' | 'DONE' | 'all'>('PENDING');
    const [dueTodayOnly, setDueTodayOnly] = useState(false);
    const [completing, setCompleting] = useState<string | null>(null);

    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const [tasksResult, summaryResult] = await Promise.all([
                api.getCrmTasks({
                    status: statusFilter === 'all' ? undefined : statusFilter,
                    dueToday: dueTodayOnly,
                    limit: 50,
                }),
                api.getCrmTaskSummary(),
            ]);
            setTasks(tasksResult?.items ?? tasksResult ?? []);
            setSummary(summaryResult);
        } catch {
            // ignore
        } finally {
            setLoading(false);
        }
    }, [statusFilter, dueTodayOnly]);

    useEffect(() => { void loadData(); }, [loadData]);

    const markDone = async (id: string) => {
        setCompleting(id);
        try {
            await api.updateCrmTask(id, { status: 'DONE' });
            await loadData();
        } finally {
            setCompleting(null);
        }
    };

    const removeTask = async (id: string) => {
        if (!confirm('Delete this task?')) return;
        await api.deleteCrmTask(id);
        await loadData();
    };

    const isOverdue = (dueAt: string) => new Date(dueAt) < new Date();

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">CRM Tasks</h1>
                    <p className="text-gray-500 text-sm mt-1">Follow-ups, collections, and reminders</p>
                </div>
                <button
                    onClick={loadData}
                    className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
                >
                    <RefreshCw className="w-4 h-4" /> Refresh
                </button>
            </div>

            {/* Summary cards */}
            {summary && (
                <div className="grid grid-cols-3 gap-4 mb-6">
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-amber-700">
                            <Clock className="w-5 h-5" />
                            <span className="font-semibold text-lg">{summary.dueToday}</span>
                        </div>
                        <div className="text-amber-600 text-sm mt-1">Due Today</div>
                    </div>
                    <div className="bg-rose-50 border border-rose-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-rose-700">
                            <AlertCircle className="w-5 h-5" />
                            <span className="font-semibold text-lg">{summary.overdue}</span>
                        </div>
                        <div className="text-rose-600 text-sm mt-1">Overdue</div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                        <div className="flex items-center gap-2 text-gray-700">
                            <CheckCircle2 className="w-5 h-5" />
                            <span className="font-semibold text-lg">{summary.total}</span>
                        </div>
                        <div className="text-gray-600 text-sm mt-1">Total Pending</div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex items-center gap-3 mb-4">
                <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                    {(['PENDING', 'DONE', 'all'] as const).map((s) => (
                        <button
                            key={s}
                            onClick={() => setStatusFilter(s)}
                            className={`px-4 py-2 text-sm font-medium transition-colors ${
                                statusFilter === s
                                    ? 'bg-gray-900 text-white'
                                    : 'bg-white text-gray-600 hover:bg-gray-50'
                            }`}
                        >
                            {s === 'all' ? 'All' : s === 'PENDING' ? 'Pending' : 'Done'}
                        </button>
                    ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={dueTodayOnly}
                        onChange={(e) => setDueTodayOnly(e.target.checked)}
                        className="rounded"
                    />
                    Due today only
                </label>
            </div>

            {/* Task list */}
            {loading ? (
                <div className="py-12 text-center text-gray-400 font-medium uppercase tracking-widest text-sm">
                    Loading...
                </div>
            ) : tasks.length === 0 ? (
                <div className="py-16 text-center">
                    <CheckCheck className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                    <p className="text-gray-500">No tasks found</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {tasks.map((task) => (
                        <div
                            key={task.id}
                            className={`bg-white border rounded-xl p-4 flex items-start gap-4 ${
                                task.status === 'DONE' ? 'opacity-60' : ''
                            } ${isOverdue(task.due_at) && task.status === 'PENDING' ? 'border-rose-200' : 'border-gray-200'}`}
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColors[task.type] ?? 'bg-gray-100 text-gray-700'}`}>
                                        {typeLabels[task.type] ?? task.type}
                                    </span>
                                    {isOverdue(task.due_at) && task.status === 'PENDING' && (
                                        <span className="text-xs text-rose-600 font-medium">Overdue</span>
                                    )}
                                </div>
                                <p className={`font-medium text-gray-900 ${task.status === 'DONE' ? 'line-through' : ''}`}>
                                    {task.title}
                                </p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                                    <Link href={`/dashboard/customers/${task.customer.id}`} className="flex items-center gap-1 hover:text-blue-600">
                                        <Phone className="w-3 h-3" />
                                        {task.customer.name} · {task.customer.phone}
                                    </Link>
                                    <span>Due {formatDate(task.due_at)}</span>
                                </div>
                                {task.notes && (
                                    <p className="text-xs text-gray-400 mt-1">{task.notes}</p>
                                )}
                            </div>

                            {task.status === 'PENDING' && (
                                <div className="flex items-center gap-2 flex-shrink-0">
                                    <button
                                        onClick={() => markDone(task.id)}
                                        disabled={completing === task.id}
                                        className="flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                                    >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        Done
                                    </button>
                                    <button
                                        onClick={() => removeTask(task.id)}
                                        className="p-1.5 text-gray-400 hover:text-rose-600 rounded"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
