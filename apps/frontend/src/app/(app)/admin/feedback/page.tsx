'use client';

import { useI18n, formatMessage } from '@/lib/i18n';
import { useEffect, useState } from 'react';
import { Search, Bug, Sparkles, MessageSquare, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '@/lib/api';

type FeedbackItem = {
    id: string;
    type: 'bug' | 'feature' | 'general';
    message: string;
    page: string | null;
    createdAt: string;
    tenant: string;
    userEmail: string;
    userName: string | null;
};

const TYPE_STYLES: Record<string, { bg: string; text: string; icon: React.ReactNode }> = {
    bug: {
        bg: 'bg-red-100',
        text: 'text-red-700',
        icon: <Bug className="w-3 h-3" />,
    },
    feature: {
        bg: 'bg-purple-100',
        text: 'text-purple-700',
        icon: <Sparkles className="w-3 h-3" />,
    },
    general: {
        bg: 'bg-blue-100',
        text: 'text-blue-700',
        icon: <MessageSquare className="w-3 h-3" />,
    },
};

export default function AdminFeedbackPage() {
    const { t } = useI18n();
    const m = t.admin.feedback;

    const [items, setItems] = useState<FeedbackItem[]>([]);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = async (opts?: { search?: string; type?: string }) => {
        setIsLoading(true);
        setError('');
        try {
            const res: any = await api.getAdminFeedback({
                search: (opts?.search ?? search) || undefined,
                type: (opts?.type ?? typeFilter) || undefined,
                limit: 50,
            });
            setItems(res.data ?? []);
            setTotal(res.total ?? 0);
        } catch (err: any) {
            setError(err.message || m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => { void load(); }, []);

    const handleSearch = (value: string) => {
        setSearch(value);
        void load({ search: value, type: typeFilter });
    };

    const handleTypeFilter = (value: string) => {
        setTypeFilter(value);
        void load({ search, type: value });
    };

    const toggleExpand = (id: string) => {
        setExpandedId((prev) => (prev === id ? null : id));
    };

    const typeLabel = (type: string) => {
        if (type === 'bug') return m.types.bug;
        if (type === 'feature') return m.types.feature;
        return m.types.general;
    };

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                <div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950">{m.title}</h1>
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-1">
                        {formatMessage(m.subtitle, { total })}
                    </p>
                </div>

                {error && (
                    <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {error}
                    </div>
                )}

                <div className="rounded-3xl border border-gray-100 bg-white overflow-hidden">
                    <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3">
                        <label className="flex-1 rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center gap-3">
                            <Search className="w-4 h-4 text-gray-400 shrink-0" />
                            <input
                                value={search}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder={m.searchPlaceholder}
                                className="w-full bg-transparent outline-none text-sm"
                            />
                        </label>
                        <select
                            value={typeFilter}
                            onChange={(e) => handleTypeFilter(e.target.value)}
                            className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-2.5 text-sm font-semibold text-gray-700 outline-none cursor-pointer"
                        >
                            <option value="">{m.allTypes}</option>
                            <option value="bug">{m.types.bug}</option>
                            <option value="feature">{m.types.feature}</option>
                            <option value="general">{m.types.general}</option>
                        </select>
                    </div>

                    {isLoading ? (
                        <div className="p-10 flex items-center justify-center text-sm text-gray-500">
                            <Loader2 className="w-4 h-4 animate-spin mr-2" /> {m.loading}
                        </div>
                    ) : items.length === 0 ? (
                        <div className="p-10 text-center text-sm text-gray-500">{m.noFeedback}</div>
                    ) : (
                        <div className="divide-y divide-gray-100">
                            {items.map((item) => {
                                const style = TYPE_STYLES[item.type] ?? TYPE_STYLES.general;
                                const isExpanded = expandedId === item.id;
                                const isLong = item.message.length > 120;
                                const preview = isLong && !isExpanded
                                    ? item.message.slice(0, 120) + '…'
                                    : item.message;

                                return (
                                    <div key={item.id} className="px-5 py-4 space-y-2">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <span
                                                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-widest shrink-0 ${style.bg} ${style.text}`}
                                                >
                                                    {style.icon}
                                                    {typeLabel(item.type)}
                                                </span>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-black text-gray-900 truncate">
                                                        {item.userName || item.userEmail}
                                                    </p>
                                                    <p className="text-xs text-gray-500 truncate">{item.userEmail}</p>
                                                </div>
                                            </div>
                                            <div className="text-right shrink-0">
                                                <p className="text-xs font-semibold text-gray-700">{item.tenant}</p>
                                                <p className="text-[10px] text-gray-400 mt-0.5">
                                                    {new Date(item.createdAt).toLocaleDateString(undefined, {
                                                        year: 'numeric',
                                                        month: 'short',
                                                        day: 'numeric',
                                                    })}
                                                </p>
                                                {item.page && (
                                                    <p className="text-[10px] text-gray-400 truncate max-w-[160px]">
                                                        {item.page}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        <div className="pl-0">
                                            <p className="text-sm text-gray-700 whitespace-pre-wrap">{preview}</p>
                                            {isLong && (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleExpand(item.id)}
                                                    className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                                                >
                                                    {isExpanded ? (
                                                        <><ChevronUp className="w-3 h-3" /> Show less</>
                                                    ) : (
                                                        <><ChevronDown className="w-3 h-3" /> Show more</>
                                                    )}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
