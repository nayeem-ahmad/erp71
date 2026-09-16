'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MessageSquare, Plus, Search, Send, CheckCircle, Loader2, SlidersHorizontal } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Select } from '@/components/ui';
import { useIsMdUp } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import SupportComposer from '@/components/SupportComposer';
import { formatDate } from '@/lib/format';

type KnockCategory = 'support' | 'bug' | 'feature' | 'general';

type Thread = {
    id: string;
    subject: string;
    status: string;
    category: KnockCategory;
    page: string | null;
    feedbackId: string | null;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
    lastMessage: { body: string; senderRole: string; createdAt: string } | null;
};

type Message = {
    id: string;
    senderRole: string;
    senderName: string;
    body: string;
    createdAt: string;
};

function CategoryBadge({ category, label }: { category: string; label: string }) {
    const tone =
        category === 'bug'
            ? 'bg-red-50 text-red-700'
            : category === 'feature'
                ? 'bg-blue-50 text-blue-700'
                : category === 'general'
                    ? 'bg-gray-100 text-gray-600'
                    : 'bg-amber-50 text-amber-800';
    return (
        <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${tone}`}>
            {label}
        </span>
    );
}

export default function SupportPage() {
    const { t, fmt } = useI18n();
    const page = t.components.supportPage;
    const types = t.components.feedbackWidget.types;
    const { support, feedback } = usePlatformFeatures();
    const isMdUp = useIsMdUp();

    const [threads, setThreads] = useState<Thread[]>([]);
    const [search, setSearch] = useState('');
    /** The value the list is actually fetched with — see the debounce below. */
    const [appliedSearch, setAppliedSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');
    /** Phone-only disclosure — two dropdowns cost a quarter of the screen above the list. */
    const [filtersOpen, setFiltersOpen] = useState(false);

    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [threadInfo, setThreadInfo] = useState<{
        subject: string;
        status: string;
        category?: string;
        page?: string | null;
    } | null>(null);
    const [replyBody, setReplyBody] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingThreads, setLoadingThreads] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [error, setError] = useState('');
    const [showNewForm, setShowNewForm] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    /** Latest filters, so the poll interval never refetches through a stale closure. */
    const filtersRef = useRef({ appliedSearch, statusFilter, categoryFilter });
    filtersRef.current = { appliedSearch, statusFilter, categoryFilter };
    /** Last message we scrolled to, so a poll that changes nothing does not re-scroll. */
    const scrolledForRef = useRef<string | null>(null);

    /** Cheap identity of a payload — lets a poll keep the existing state object when nothing moved. */
    const threadsSignature = (list: Thread[]) =>
        list.map((th) => `${th.id}:${th.status}:${th.updatedAt}:${th.messageCount}`).join('|');
    const messagesSignature = (list: Message[]) =>
        list.map((msg) => `${msg.id}:${msg.body}`).join('|');

    const categoryLabel = (category: string) => {
        if (category === 'support') return types.support;
        if (category === 'bug') return types.bug;
        if (category === 'feature') return types.feature;
        return types.general;
    };

    /**
     * `silent` is for the background poll: no spinner, no error banner, no state
     * churn. The filter overrides are for a caller that has just reset state and
     * cannot wait for the re-render to reach `filtersRef`.
     */
    const loadThreads = async (opts?: {
        search?: string;
        status?: string;
        category?: string;
        silent?: boolean;
    }) => {
        const silent = opts?.silent ?? false;
        if (!silent) setLoadingThreads(true);
        try {
            const filters = filtersRef.current;
            const next = (await api.getSupportThreads({
                search: (opts?.search ?? filters.appliedSearch) || undefined,
                status: (opts?.status ?? filters.statusFilter) || undefined,
                category: (opts?.category ?? filters.categoryFilter) || undefined,
            })) as Thread[];
            setThreads((prev) => (threadsSignature(prev) === threadsSignature(next) ? prev : next));
        } catch (err: any) {
            if (!silent) setError(err.message || 'Failed to load threads');
        } finally {
            if (!silent) setLoadingThreads(false);
        }
    };

    const loadMessages = async (threadId: string, opts?: { silent?: boolean }) => {
        const silent = opts?.silent ?? false;
        if (!silent) setLoadingMessages(true);
        try {
            const res: any = await api.getSupportMessages(threadId);
            const next: Message[] = res.messages ?? [];
            setMessages((prev) => (messagesSignature(prev) === messagesSignature(next) ? prev : next));
            setThreadInfo((prev) => {
                const incoming = res.thread ?? null;
                return JSON.stringify(prev) === JSON.stringify(incoming) ? prev : incoming;
            });
        } catch (err: any) {
            if (!silent) setError(err.message || 'Failed to load messages');
        } finally {
            if (!silent) setLoadingMessages(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const thread = params.get('thread');
        if (thread) setActiveThreadId(thread);
    }, []);

    /**
     * Typing a word should not send a request per keystroke. The dropdowns are
     * one deliberate click each, so they skip the wait and fetch immediately.
     */
    useEffect(() => {
        if (search === appliedSearch) return;
        const timer = setTimeout(() => setAppliedSearch(search), 300);
        return () => clearTimeout(timer);
    }, [search, appliedSearch]);

    useEffect(() => {
        void loadThreads();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [appliedSearch, statusFilter, categoryFilter]);

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeThreadId]);

    useEffect(() => {
        const lastId = messages[messages.length - 1]?.id ?? null;
        if (!lastId || scrolledForRef.current === lastId) return;
        // Jump straight to the bottom when a thread opens; animate only for genuinely new messages.
        const behavior = scrolledForRef.current === null ? 'auto' : 'smooth';
        scrolledForRef.current = lastId;
        messagesEndRef.current?.scrollIntoView({ behavior });
    }, [messages]);

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
     * to put the list back. On `md` and up both panes are on screen at once and
     * the control that calls this is hidden.
     */
    const closeThread = () => {
        setActiveThreadId(null);
        setMessages([]);
        setThreadInfo(null);
        setReplyBody('');
        scrolledForRef.current = null;
    };

    const clearFilters = () => {
        setSearch('');
        setAppliedSearch('');
        setStatusFilter('');
        setCategoryFilter('');
    };

    const sendReply = async () => {
        if (!activeThreadId || !replyBody.trim()) return;
        setSending(true);
        try {
            await api.sendSupportMessage(activeThreadId, replyBody.trim());
            setReplyBody('');
            await loadMessages(activeThreadId);
            await loadThreads();
        } catch (err: any) {
            setError(err.message || 'Failed to send message');
        } finally {
            setSending(false);
        }
    };

    const activeFilterCount = [statusFilter, categoryFilter].filter(Boolean).length;
    const isFiltered = activeFilterCount > 0 || appliedSearch.trim().length > 0;
    /**
     * One pane at a time on a phone: the list until a thread is picked, the
     * conversation after. Both are on screen together from `md` up.
     */
    const viewingThread = Boolean(activeThreadId);
    /* Held back until the first load lands, so the header never reads "0 conversations" on the way in. */
    const subtitle = loadingThreads && threads.length === 0 ? undefined : fmt(page.count, { count: threads.length });

    return (
        <div className="h-full flex flex-col bg-canvas overflow-hidden">
            <PageHeader
                title={page.title}
                subtitle={subtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    page.title,
                    page.title,
                    'support',
                )}
                actions={(
                    <button
                        type="button"
                        onClick={() => setShowNewForm(true)}
                        className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-primary-hover min-h-touch"
                    >
                        <Plus className="w-3 h-3" /> {page.new}
                    </button>
                )}
                /* An open conversation owns the phone screen — the thread header
                   below carries the title and the way back, so the page header
                   would only be pushing the messages down. */
                className={`shrink-0 px-3 md:px-4 pt-3 md:pt-4 ${viewingThread ? 'max-md:hidden' : ''}`}
            />

            <div className="flex-1 flex flex-col md:flex-row overflow-hidden p-3 md:p-4 gap-3 md:gap-4 min-h-0">
                <div
                    data-testid="thread-list-pane"
                    className={`min-h-0 w-full flex-col gap-3 overflow-hidden md:w-72 md:shrink-0 ${
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
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder={page.searchPlaceholder}
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
                            narrowed list is easy to mistake for an empty one, so the
                            toggle above counts what is hiding behind it. */}
                        <div
                            data-testid="thread-filters"
                            className={`grid grid-cols-2 gap-2 ${filtersOpen ? '' : 'max-md:hidden'}`}
                        >
                            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                                <option value="">{page.allStatuses}</option>
                                <option value="open">{page.statusOpen}</option>
                                <option value="resolved">{page.statusResolved}</option>
                            </Select>
                            <Select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                                <option value="">{page.allTypes}</option>
                                <option value="support">{types.support}</option>
                                <option value="bug">{types.bug}</option>
                                <option value="feature">{types.feature}</option>
                                <option value="general">{types.general}</option>
                            </Select>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto rounded-lg border border-gray-100 bg-white divide-y divide-gray-100">
                        {loadingThreads && threads.length === 0 ? (
                            <div className="p-6 flex justify-center text-sm text-gray-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                            </div>
                        ) : threads.length === 0 ? (
                            /* An empty list after filtering means "nothing matched",
                               not "you have never written in" — and the way out of it
                               is one tap rather than undoing each control. */
                            <div className="p-6 text-center text-sm text-gray-400">
                                {isFiltered ? (
                                    <>
                                        <p>{page.noMatches}</p>
                                        <button
                                            type="button"
                                            onClick={clearFilters}
                                            className="mt-2 text-xs font-semibold text-primary hover:underline min-h-touch"
                                        >
                                            {page.clearFilters}
                                        </button>
                                    </>
                                ) : (
                                    page.empty
                                )}
                            </div>
                        ) : (
                            threads.map((thread) => (
                                <button
                                    key={thread.id}
                                    type="button"
                                    onClick={() => selectThread(thread.id)}
                                    className={`w-full text-start px-3 md:px-4 py-3 hover:bg-gray-50 transition-colors ${activeThreadId === thread.id ? 'bg-primary-light border-s-2 border-primary' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <p className="text-sm font-bold text-gray-900 truncate">{thread.subject}</p>
                                        <span className={`shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${thread.status === 'resolved' ? 'bg-success-light text-success-text' : 'bg-warning-light text-warning-text'}`}>
                                            {thread.status}
                                        </span>
                                    </div>
                                    <CategoryBadge category={thread.category} label={categoryLabel(thread.category)} />
                                    {thread.lastMessage && (
                                        <p className="text-xs text-gray-400 truncate mt-1">{thread.lastMessage.body}</p>
                                    )}
                                    <p className="text-[10px] text-gray-300 mt-1">
                                        {formatDate(thread.updatedAt)}
                                    </p>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                <div
                    data-testid="conversation-pane"
                    className={`flex-1 flex-col overflow-hidden rounded-lg border border-gray-100 bg-white min-w-0 min-h-0 ${
                        viewingThread ? 'flex' : 'hidden md:flex'
                    }`}
                >
                    {!activeThreadId ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-400 gap-2">
                            <MessageSquare className="w-8 h-8 text-gray-200" />
                            <p>{page.select}</p>
                        </div>
                    ) : (
                        <>
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
                                        <p className="font-semibold text-sm text-gray-900 truncate">{threadInfo?.subject}</p>
                                        {threadInfo?.page && (
                                            <p className="text-[10px] text-gray-400 truncate">{threadInfo.page}</p>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 max-md:ms-9">
                                    {threadInfo?.category && (
                                        <CategoryBadge category={threadInfo.category} label={categoryLabel(threadInfo.category)} />
                                    )}
                                    {threadInfo?.status === 'resolved' && (
                                        <span className="inline-flex items-center gap-1 text-xs font-bold text-success-text bg-success-light px-2 py-1 rounded-full">
                                            <CheckCircle className="w-3 h-3" /> {page.resolved}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-3">
                                {loadingMessages ? (
                                    <div className="flex justify-center pt-8">
                                        <Loader2 className="w-4 h-4 animate-spin text-gray-300" />
                                    </div>
                                ) : messages.length === 0 ? (
                                    <p className="text-center text-sm text-gray-400 pt-8">{t.admin.support.noMessages}</p>
                                ) : (
                                    messages.map((msg) => {
                                        const isOwner = msg.senderRole === 'owner';
                                        return (
                                            <div key={msg.id} className={`flex ${isOwner ? 'justify-end' : 'justify-start'}`}>
                                                <div className={`max-w-[85%] md:max-w-[75%] rounded-lg px-3 md:px-4 py-2.5 ${isOwner ? 'bg-primary text-white' : 'bg-gray-100 text-gray-900'}`}>
                                                    <p className={`text-[10px] font-bold mb-1 ${isOwner ? 'text-blue-100' : 'text-gray-500'}`}>
                                                        {isOwner ? page.you : page.admin}
                                                    </p>
                                                    <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                                                    <p className={`text-[10px] mt-1 ${isOwner ? 'text-blue-200' : 'text-gray-400'}`}>
                                                        {new Date(msg.createdAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                                <div ref={messagesEndRef} />
                            </div>

                            {threadInfo?.status !== 'resolved' && (
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
                                            placeholder={isMdUp ? page.replyPlaceholder : page.replyPlaceholderMobile}
                                            rows={2}
                                            className="flex-1 min-w-0 resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:bg-white"
                                        />
                                        <button
                                            type="button"
                                            onClick={sendReply}
                                            disabled={sending || !replyBody.trim()}
                                            aria-label={t.components.feedbackWidget.submit}
                                            className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-md bg-primary text-white hover:bg-primary-hover disabled:opacity-40 min-h-touch min-w-touch"
                                        >
                                            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {showNewForm && (
                <ModalShell size="sm" onBackdropClick={() => setShowNewForm(false)}>
                    <ModalHeader title={page.createTitle} onClose={() => setShowNewForm(false)} />
                    <div className="p-4">
                        <SupportComposer
                            supportEnabled={support}
                            feedbackEnabled={feedback}
                            capturePage
                            onCancel={() => setShowNewForm(false)}
                            onCreated={(threadId) => {
                                setShowNewForm(false);
                                selectThread(threadId);
                                /* A live filter that excludes the new conversation would
                                   make it vanish from the list the moment it was created,
                                   so creating one clears them. */
                                clearFilters();
                                void loadThreads({ search: '', status: '', category: '' });
                            }}
                        />
                    </div>
                </ModalShell>
            )}
        </div>
    );
}
