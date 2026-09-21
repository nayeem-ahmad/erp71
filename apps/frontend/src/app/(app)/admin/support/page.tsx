'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n, formatMessage } from '@/lib/i18n';
import { ArrowLeft, MessageSquare, Search, Send, CheckCircle, RotateCcw, Loader2, Sparkles, SlidersHorizontal } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Select, StatusBadge } from '@/components/ui';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import FeedbackAutomationPanel from '@/components/admin/FeedbackAutomationPanel';
import { formatDate } from '@/lib/format';

type ThreadUser = { id: string; name: string; email: string };

type Thread = {
    id: string;
    ticketNumber: number;
    subject: string;
    status: string;
    category: string;
    page: string | null;
    feedbackId: string | null;
    tenantId: string;
    tenant: string;
    createdBy: ThreadUser | null;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    lastMessage: { body: string; senderRole: string; createdAt: string } | null;
};

type TenantOption = { id: string; name: string; threadCount: number };
type UserOption = { id: string; name: string; email: string; threadCount: number };

type Message = {
    id: string;
    senderRole: string;
    senderName: string;
    body: string;
    createdAt: string;
};

export default function AdminSupportPage() {
    const { t } = useI18n();
    const m = t.admin.support;
    const isMdUp = useIsMdUp();

    const [threads, setThreads] = useState<Thread[]>([]);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    const [tenantFilter, setTenantFilter] = useState('');
    const [userFilter, setUserFilter] = useState('');
    const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
    const [userOptions, setUserOptions] = useState<UserOption[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');
    /** Phone-only disclosure — the four dropdowns cost a third of the screen above the inbox. */
    const [filtersOpen, setFiltersOpen] = useState(false);

    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [threadInfo, setThreadInfo] = useState<{
        ticketNumber?: number;
        subject: string;
        status: string;
        tenant: string;
        tenantId?: string;
        createdBy?: ThreadUser | null;
        category?: string;
        page?: string | null;
        feedbackId?: string | null;
    } | null>(null);
    const [automationId, setAutomationId] = useState<string | null>(null);
    const [replyBody, setReplyBody] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [resolving, setResolving] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    /** Latest filters, so the poll interval never reads a stale closure. */
    const filtersRef = useRef({ search, statusFilter, categoryFilter, tenantFilter, userFilter });
    filtersRef.current = { search, statusFilter, categoryFilter, tenantFilter, userFilter };
    /** Last message we scrolled to, so a poll that changes nothing does not re-scroll. */
    const scrolledForRef = useRef<string | null>(null);

    /** Cheap identity of a payload — lets a poll keep the existing state object when nothing moved. */
    const threadsSignature = (list: Thread[]) =>
        list.map((th) => `${th.id}:${th.status}:${th.updatedAt}:${th.messageCount}`).join('|');
    const messagesSignature = (list: Message[]) =>
        list.map((msg) => `${msg.id}:${msg.body}`).join('|');

    const categoryLabel = (category: string) => {
        if (category === 'support') return m.types.support;
        if (category === 'bug') return m.types.bug;
        if (category === 'feature') return m.types.feature;
        return m.types.general;
    };

    /** `silent` is for the background poll: no spinner, no error banner, no state churn. */
    const loadThreads = async (opts?: {
        search?: string;
        status?: string;
        category?: string;
        tenantId?: string;
        userId?: string;
        silent?: boolean;
    }) => {
        const silent = opts?.silent ?? false;
        if (!silent) setIsLoading(true);
        try {
            const filters = filtersRef.current;
            const nextCategory = opts?.category ?? filters.categoryFilter;
            const res: any = await api.getAdminSupportThreads({
                search: (opts?.search ?? filters.search) || undefined,
                status: (opts?.status ?? filters.statusFilter) || undefined,
                category: nextCategory && nextCategory !== 'feedback' ? nextCategory : undefined,
                kind: nextCategory === 'feedback' ? 'feedback' : undefined,
                tenantId: (opts?.tenantId ?? filters.tenantFilter) || undefined,
                userId: (opts?.userId ?? filters.userFilter) || undefined,
                limit: 50,
            });
            const next: Thread[] = res.data ?? [];
            setThreads((prev) =>
                threadsSignature(prev) === threadsSignature(next) ? prev : next,
            );
            setTotal(res.total ?? 0);
        } catch (err: any) {
            if (!silent) setError(err.message || m.loadFailed);
        } finally {
            if (!silent) setIsLoading(false);
        }
    };

    const loadMessages = async (threadId: string, opts?: { silent?: boolean }) => {
        const silent = opts?.silent ?? false;
        if (!silent) setLoadingMessages(true);
        try {
            const res: any = await api.getAdminSupportMessages(threadId);
            const next: Message[] = res.messages ?? [];
            setMessages((prev) =>
                messagesSignature(prev) === messagesSignature(next) ? prev : next,
            );
            setThreadInfo((prev) => {
                const incoming = res.thread ?? null;
                return JSON.stringify(prev) === JSON.stringify(incoming) ? prev : incoming;
            });
        } catch (err: any) {
            if (!silent) setError(err.message || m.loadFailed);
        } finally {
            if (!silent) setLoadingMessages(false);
        }
    };

    /**
     * Dropdown options come from the threads themselves, so the lists only ever
     * show tenants and people who have actually written in. Narrowing by tenant
     * re-fetches so the user list holds just that tenant's people.
     */
    const loadFilterOptions = async (tenantId?: string) => {
        try {
            const res: any = await api.getAdminSupportFilters(tenantId || undefined);
            setTenantOptions(res.tenants ?? []);
            setUserOptions(res.users ?? []);
        } catch {
            // Filters are an affordance, not the page — a failure here leaves the
            // dropdowns empty rather than blocking the inbox.
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const kind = params.get('kind') || params.get('category') || '';
        if (kind) setCategoryFilter(kind);
        void loadThreads({ category: kind || undefined });
        void loadFilterOptions();
    }, []);

    useEffect(() => {
        if (!activeThreadId) return;
        void loadMessages(activeThreadId);

        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
            void loadMessages(activeThreadId, { silent: true });
            void loadThreads({ silent: true });
        }, 10000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeThreadId]);

    useEffect(() => {
        const lastId = messages[messages.length - 1]?.id ?? null;
        if (!lastId || scrolledForRef.current === lastId) return;
        // Jump straight to the bottom when a thread opens; animate only for genuinely new messages.
        const behavior = scrolledForRef.current === null ? 'auto' : 'smooth';
        scrolledForRef.current = lastId;
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, [messages]);

    const handleSearch = (value: string) => {
        setSearch(value);
        void loadThreads({ search: value, status: statusFilter, category: categoryFilter });
    };

    const handleStatusFilter = (value: string) => {
        setStatusFilter(value);
        void loadThreads({ search, status: value, category: categoryFilter });
    };

    const handleCategoryFilter = (value: string) => {
        setCategoryFilter(value);
        void loadThreads({ search, status: statusFilter, category: value });
    };

    const handleTenantFilter = (value: string) => {
        setTenantFilter(value);
        // A user picked under the previous tenant no longer belongs to this list.
        setUserFilter('');
        void loadThreads({ search, status: statusFilter, category: categoryFilter, tenantId: value, userId: '' });
        void loadFilterOptions(value);
    };

    const handleUserFilter = (value: string) => {
        setUserFilter(value);
        void loadThreads({ search, status: statusFilter, category: categoryFilter, userId: value });
    };

    const selectThread = (id: string) => {
        if (id === activeThreadId) return;
        setActiveThreadId(id);
        setMessages([]);
        setThreadInfo(null);
        scrolledForRef.current = null;
        setError('');
    };

    /**
     * Phone-only: the conversation is the whole screen there, so leaving it has
     * to put the inbox back. On `md` and up both panes are on screen at once and
     * the control that calls this is hidden.
     */
    const closeThread = () => {
        setActiveThreadId(null);
        setMessages([]);
        setThreadInfo(null);
        setReplyBody('');
        scrolledForRef.current = null;
    };

    const sendReply = async () => {
        if (!activeThreadId || !replyBody.trim()) return;
        setSending(true);
        try {
            await api.sendAdminSupportMessage(activeThreadId, replyBody.trim());
            setReplyBody('');
            await loadMessages(activeThreadId);
            await loadThreads();
        } catch (err: any) {
            setError(err.message || 'Failed to send reply');
        } finally {
            setSending(false);
        }
    };

    const toggleResolve = async () => {
        if (!activeThreadId || !threadInfo) return;
        setResolving(true);
        try {
            if (threadInfo.status === 'resolved') {
                await api.reopenThread(activeThreadId);
            } else {
                await api.resolveThread(activeThreadId);
            }
            await loadMessages(activeThreadId);
            await loadThreads();
        } catch (err: any) {
            setError(err.message || 'Failed to update thread');
        } finally {
            setResolving(false);
        }
    };

    /**
     * One pane at a time on a phone: the inbox until a thread is picked, the
     * conversation after. The two-up layout below `md` used to give the fixed
     * 20rem list every pixel of a 360px viewport and leave the conversation
     * nothing to render into.
     */
    const viewingThread = Boolean(activeThreadId);
    const activeFilterCount = [statusFilter, categoryFilter, tenantFilter, userFilter].filter(Boolean).length;

    return (
        <div className="h-full flex flex-col overflow-hidden bg-canvas">
            <PageHeader
                title={m.title}
                subtitle={formatMessage(m.subtitle, { total })}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.admin,
                    m.title,
                    'admin',
                )}
                /* An open conversation owns the phone screen — the thread header
                   below carries the title and the way back, so the page header
                   would only be pushing the messages down. */
                className={`shrink-0 px-3 md:px-4 pt-3 md:pt-4 ${viewingThread ? 'max-md:hidden' : ''}`}
            />

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-3 md:p-4 gap-3 md:gap-4 min-h-0">
                {/* Thread list */}
                <div
                    data-testid="thread-list-pane"
                    className={`min-h-0 w-full flex-col gap-3 overflow-hidden md:w-80 md:shrink-0 ${
                        viewingThread ? 'hidden md:flex' : 'flex'
                    }`}
                >
                    {error && (
                        <div className="rounded-md border border-danger bg-danger-light px-3 py-2 text-xs font-semibold text-danger-text">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            {/* Hand-rolled rather than the `Input` primitive because of the
                                leading icon, so it copies the primitive's box to sit level
                                with the `Select`s below it. */}
                            <label className="flex flex-1 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 focus-within:border-primary/40 focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/20 max-md:py-0">
                                <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                <input
                                    value={search}
                                    onChange={(e) => handleSearch(e.target.value)}
                                    placeholder={m.searchPlaceholder}
                                    className="w-full min-w-0 self-stretch bg-transparent outline-none text-sm placeholder:text-gray-400 max-md:min-h-touch"
                                />
                            </label>
                            <button
                                type="button"
                                onClick={() => setFiltersOpen((open) => !open)}
                                aria-expanded={filtersOpen}
                                aria-label={t.common.dataTable.filters}
                                className={`md:hidden shrink-0 inline-flex items-center justify-center gap-1 rounded-md border px-3 text-xs font-semibold min-h-touch min-w-touch ${
                                    activeFilterCount > 0
                                        ? 'border-primary-border bg-primary-light text-primary'
                                        : 'border-gray-200 bg-gray-50 text-gray-500'
                                }`}
                            >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                {activeFilterCount > 0 ? activeFilterCount : null}
                            </button>
                        </div>
                        {/* Collapsed by default on a phone; always on from `md` up. A
                            narrowed inbox is easy to mistake for an empty one, so the
                            toggle above counts what is hiding behind it. */}
                        <div
                            data-testid="thread-filters"
                            className={`grid grid-cols-2 gap-2 ${filtersOpen ? '' : 'max-md:hidden'}`}
                        >
                            <Select value={statusFilter} onChange={(e) => handleStatusFilter(e.target.value)}>
                                <option value="">{m.allStatuses}</option>
                                <option value="open">{m.statusOpen}</option>
                                <option value="resolved">{m.statusResolved}</option>
                            </Select>
                            <Select value={categoryFilter} onChange={(e) => handleCategoryFilter(e.target.value)}>
                                <option value="">{m.allTypes}</option>
                                <option value="support">{m.types.support}</option>
                                <option value="feedback">{m.kindFeedback}</option>
                                <option value="bug">{m.types.bug}</option>
                                <option value="feature">{m.types.feature}</option>
                                <option value="general">{m.types.general}</option>
                            </Select>
                            <Select value={tenantFilter} onChange={(e) => handleTenantFilter(e.target.value)}>
                                <option value="">{m.allTenants}</option>
                                {tenantOptions.map((tenantOption) => (
                                    <option key={tenantOption.id} value={tenantOption.id}>
                                        {tenantOption.name} ({tenantOption.threadCount})
                                    </option>
                                ))}
                            </Select>
                            <Select value={userFilter} onChange={(e) => handleUserFilter(e.target.value)}>
                                <option value="">{m.allUsers}</option>
                                {userOptions.map((userOption) => (
                                    <option key={userOption.id} value={userOption.id}>
                                        {userOption.name} ({userOption.threadCount})
                                    </option>
                                ))}
                            </Select>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto rounded-lg border border-gray-100 bg-white divide-y divide-gray-100">
                        {isLoading && threads.length === 0 ? (
                            <div className="p-6 flex justify-center text-sm text-gray-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                            </div>
                        ) : threads.length === 0 ? (
                            <div className="p-6 text-center text-sm text-gray-400">{m.noThreads}</div>
                        ) : (
                            threads.map((thread) => (
                                <button
                                    key={thread.id}
                                    type="button"
                                    onClick={() => selectThread(thread.id)}
                                    className={`w-full text-start px-3 md:px-4 py-3 hover:bg-gray-50 transition-colors ${activeThreadId === thread.id ? 'bg-primary-light border-s-2 border-primary' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <p className="flex min-w-0 items-baseline gap-1.5">
                                            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-gray-500">
                                                #{thread.ticketNumber}
                                            </span>
                                            <span className="truncate text-sm font-bold text-gray-900">{thread.subject}</span>
                                        </p>
                                        <StatusBadge tone={thread.status === 'resolved' ? 'success' : 'warning'} className="shrink-0 text-[9px]">
                                            {thread.status}
                                        </StatusBadge>
                                    </div>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <p className="text-xs text-gray-500 font-semibold truncate">{thread.tenant}</p>
                                        <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
                                            {categoryLabel(thread.category)}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-gray-400 truncate">
                                        {thread.createdBy?.name ?? m.unknownUser}
                                    </p>
                                    {thread.lastMessage && (
                                        <p className="text-xs text-gray-400 truncate mt-0.5">{thread.lastMessage.body}</p>
                                    )}
                                    <p className="text-[10px] text-gray-300 mt-1">
                                        {formatDate(thread.updatedAt)}
                                    </p>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Message area */}
                <div
                    data-testid="conversation-pane"
                    className={`flex-1 flex-col overflow-hidden rounded-lg border border-gray-100 bg-white min-w-0 min-h-0 ${
                        viewingThread ? 'flex' : 'hidden md:flex'
                    }`}
                >
                    {!activeThreadId ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-gray-400">
                            <MessageSquare className="w-8 h-8 text-gray-200" />
                            <p>{m.selectThread}</p>
                        </div>
                    ) : (
                        <>
                            {/* Thread header */}
                            <div className="px-3 md:px-5 py-2.5 md:py-3 border-b border-gray-100 flex flex-col gap-2 md:flex-row md:items-center md:justify-between md:gap-4">
                                <div className="flex items-start gap-1.5 min-w-0">
                                    <button
                                        type="button"
                                        onClick={closeThread}
                                        aria-label={t.common.back}
                                        className="md:hidden shrink-0 -ms-2 inline-flex items-center justify-center rounded-md text-gray-500 hover:bg-gray-50 min-h-touch min-w-touch"
                                    >
                                        <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                                    </button>
                                    <div className="min-w-0">
                                        <p className="font-bold text-sm text-gray-900 truncate">{threadInfo?.subject}</p>
                                        {threadInfo?.ticketNumber && (
                                            <p className="text-[11px] font-semibold tabular-nums text-gray-500">
                                                {formatMessage(m.ticketLabel, { number: threadInfo.ticketNumber })}
                                            </p>
                                        )}
                                        {threadInfo?.tenant && (
                                            <p className="text-xs text-gray-500 font-semibold truncate">{threadInfo.tenant}</p>
                                        )}
                                        <p className="text-[11px] text-gray-500 truncate">
                                            {formatMessage(m.startedBy, {
                                                user: threadInfo?.createdBy
                                                    ? `${threadInfo.createdBy.name} (${threadInfo.createdBy.email})`
                                                    : m.unknownUser,
                                            })}
                                        </p>
                                        {threadInfo?.page && (
                                            <p className="text-[10px] text-gray-400 truncate">{threadInfo.page}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 max-md:ms-9">
                                {threadInfo?.feedbackId && (
                                    <button
                                        type="button"
                                        onClick={() => setAutomationId(threadInfo.feedbackId!)}
                                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-blue-50 text-blue-700 hover:bg-blue-100 min-h-touch"
                                    >
                                        <Sparkles className="w-3 h-3" />
                                        {m.automate}
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={toggleResolve}
                                    disabled={resolving}
                                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors min-h-touch ${
                                        threadInfo?.status === 'resolved'
                                            ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                            : 'bg-green-50 text-green-700 hover:bg-green-100'
                                    }`}
                                >
                                    {resolving ? (
                                        <Loader2 className="w-3 h-3 animate-spin" />
                                    ) : threadInfo?.status === 'resolved' ? (
                                        <><RotateCcw className="w-3 h-3" />{m.reopen}</>
                                    ) : (
                                        <><CheckCircle className="w-3 h-3" />{m.resolve}</>
                                    )}
                                </button>
                                </div>
                            </div>

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3">
                                {loadingMessages ? (
                                    <div className="flex justify-center pt-8">
                                        <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                                    </div>
                                ) : messages.length === 0 ? (
                                    <p className="text-center text-sm text-gray-400 pt-8">{m.noMessages}</p>
                                ) : (
                                    messages.map((msg) => {
                                        const isAdmin = msg.senderRole === 'admin';
                                        return (
                                            <div key={msg.id} className={`flex ${isAdmin ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] md:max-w-[75%] rounded-lg px-3 md:px-4 py-2.5 ${isAdmin ? 'bg-primary text-white' : 'bg-gray-100 text-gray-900'}`}>
                                                    <p className={`text-[10px] font-bold mb-1 ${isAdmin ? 'text-blue-100' : 'text-gray-500'}`}>
                                                        {isAdmin ? m.you : m.owner}
                                                    </p>
                                                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                                                    <p className={`text-[10px] mt-1 ${isAdmin ? 'text-blue-200' : 'text-gray-400'}`}>
                                                        {new Date(msg.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {/* Reply input */}
                            <div className="px-3 md:px-4 py-3 border-t border-gray-100">
                                <div className="flex items-end gap-2">
                                    <textarea
                                        value={replyBody}
                                        onChange={(e) => setReplyBody(e.target.value)}
                                        onKeyDown={(e) => {
                                            /* Enter sends at a keyboard, where Shift+Enter is
                                               the newline. On a phone the soft keyboard's Enter
                                               is the only newline there is, so it stays one and
                                               the Send button does the sending. */
                                            if (isMdUp && e.key === 'Enter' && !e.shiftKey) {
                                                e.preventDefault();
                                                void sendReply();
                                            }
                                        }}
                                        placeholder={m.replyPlaceholder}
                                        rows={2}
                                        className="flex-1 min-w-0 resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:bg-white"
                                    />
                                    <button
                                        type="button"
                                        onClick={sendReply}
                                        disabled={sending || !replyBody.trim()}
                                        aria-label={m.reply}
                                        className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-40 max-md:min-h-touch max-md:min-w-touch"
                                    >
                                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>

            {automationId && (
                <FeedbackAutomationPanel feedbackId={automationId} onClose={() => setAutomationId(null)} />
            )}
        </div>
    );
}
