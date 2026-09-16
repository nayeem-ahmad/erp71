'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, Send, CheckCircle, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import SupportComposer from '@/components/SupportComposer';
import { useSupportStream, type SupportStreamEvent } from '@/hooks/useSupportStream';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';

/**
 * How often the screen re-reads itself when the live stream is *not* carrying
 * events — a browser that refused it, or a proxy that ate it. Matches the chat
 * page's message poll, which is the cadence this screen is held to.
 */
const FALLBACK_POLL_MS = 5_000;

/**
 * And how often it re-reads while the stream *is* live. Not zero: an event
 * dropped between the publisher and this tab would otherwise never be noticed,
 * and one request a minute is a cheap floor under the whole mechanism.
 */
const SAFETY_POLL_MS = 60_000;

type KnockCategory = 'support' | 'bug' | 'feature' | 'general';

type Thread = {
    id: string;
    ticketNumber: number;
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

type ThreadInfo = {
    id?: string;
    ticketNumber?: number;
    subject: string;
    status: string;
    category?: string;
    page?: string | null;
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

/**
 * The ticket's number, the one thing on this screen a shop owner reads out over
 * the phone. `tabular-nums` so a column of them lines up.
 */
function TicketNumber({ value, className = '' }: { value: number | undefined; className?: string }) {
    if (!value) return null;
    return <span className={`shrink-0 font-semibold tabular-nums text-gray-500 ${className}`}>#{value}</span>;
}

/** Cheap identity of a payload, so a poll that changes nothing changes no state. */
const threadsSignature = (list: Thread[]) =>
    list.map((th) => `${th.id}:${th.status}:${th.updatedAt}:${th.messageCount}`).join('|');
const messagesSignature = (list: Message[]) => list.map((msg) => `${msg.id}:${msg.body}`).join('|');

export default function SupportPage() {
    const { t } = useI18n();
    const page = t.components.supportPage;
    const types = t.components.feedbackWidget.types;
    const { support, feedback } = usePlatformFeatures();

    const [threads, setThreads] = useState<Thread[]>([]);
    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [threadInfo, setThreadInfo] = useState<ThreadInfo | null>(null);
    const [replyBody, setReplyBody] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingThreads, setLoadingThreads] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [error, setError] = useState('');
    const [showNewForm, setShowNewForm] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    /** Which thread is open, for the stream callback and the poll. */
    const activeThreadIdRef = useRef<string | null>(null);
    activeThreadIdRef.current = activeThreadId;
    /** Last message we scrolled to, so a refetch that changes nothing does not re-scroll. */
    const scrolledForRef = useRef<string | null>(null);

    const categoryLabel = (category: string) => {
        if (category === 'support') return types.support;
        if (category === 'bug') return types.bug;
        if (category === 'feature') return types.feature;
        return types.general;
    };

    /** `silent` is for the background refresh: no spinner, no error banner, no state churn. */
    const loadThreads = useCallback(async (opts?: { silent?: boolean }) => {
        const silent = opts?.silent ?? false;
        try {
            const next = await api.getSupportThreads() as Thread[];
            setThreads((prev) => (threadsSignature(prev) === threadsSignature(next) ? prev : next));
        } catch (err: any) {
            if (!silent) setError(err.message || 'Failed to load threads');
        } finally {
            if (!silent) setLoadingThreads(false);
        }
    }, []);

    const loadMessages = useCallback(async (threadId: string, opts?: { silent?: boolean }) => {
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
    }, []);

    /**
     * A thread moved on the admin side. The event is only a nudge — what is on
     * screen is re-read from the API — so a duplicate costs a request and a
     * missed one is picked up by the poll below.
     */
    const handleStreamEvent = (event: SupportStreamEvent) => {
        const isOpenThread = event.threadId === activeThreadIdRef.current;
        if (isOpenThread) void loadMessages(event.threadId, { silent: true });
        void loadThreads({ silent: true });

        if (event.kind === 'status') {
            const template = event.status === 'resolved' ? page.resolvedNotice : page.reopenedNotice;
            toast.info(formatMessage(template, { number: event.ticketNumber }));
            return;
        }
        // A reply into the open thread needs no announcement — it appears in the
        // conversation, the way a chat message does. One into any other ticket
        // would otherwise go unnoticed until the list is next looked at.
        if (event.actor === 'admin' && !isOpenThread) {
            toast.info(formatMessage(page.replyNotice, { number: event.ticketNumber }));
        }
    };

    const { connected } = useSupportStream(handleStreamEvent);

    useEffect(() => {
        void loadThreads();
        const params = new URLSearchParams(window.location.search);
        const thread = params.get('thread');
        if (thread) setActiveThreadId(thread);
    }, [loadThreads]);

    useEffect(() => {
        if (!activeThreadId) return;
        void loadMessages(activeThreadId);
    }, [activeThreadId, loadMessages]);

    /**
     * The safety net under the stream. Runs whether or not a thread is open —
     * the list's statuses go stale too, and it used to stand still until
     * something was selected.
     */
    useEffect(() => {
        const timer = setInterval(() => {
            void loadThreads({ silent: true });
            const open = activeThreadIdRef.current;
            if (open) void loadMessages(open, { silent: true });
        }, connected ? SAFETY_POLL_MS : FALLBACK_POLL_MS);

        return () => clearInterval(timer);
    }, [connected, loadThreads, loadMessages]);

    useEffect(() => {
        const lastId = messages[messages.length - 1]?.id ?? null;
        if (!lastId || scrolledForRef.current === lastId) return;
        // Jump straight to the bottom when a thread opens; animate only for new messages.
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

    return (
        <div className="h-full flex flex-col bg-canvas overflow-hidden">
            <div className="flex-1 flex overflow-hidden p-4 gap-4 min-h-0">
                <div className="w-72 shrink-0 flex flex-col gap-3 overflow-hidden">
                    <PageHeader
                        title={page.title}
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
                    />

                    {error && (
                        <div className="rounded-md border border-danger bg-danger-light px-3 py-2 text-xs font-semibold text-danger-text">
                            {error}
                        </div>
                    )}

                    <div className="flex-1 overflow-y-auto rounded-lg border border-gray-100 bg-white divide-y divide-gray-100">
                        {loadingThreads ? (
                            <div className="p-6 flex justify-center text-sm text-gray-400">
                                <Loader2 className="w-4 h-4 animate-spin" />
                            </div>
                        ) : threads.length === 0 ? (
                            <div className="p-6 text-center text-sm text-gray-400">{page.empty}</div>
                        ) : (
                            threads.map((thread) => (
                                <button
                                    key={thread.id}
                                    type="button"
                                    onClick={() => selectThread(thread.id)}
                                    className={`w-full text-start px-4 py-3 hover:bg-gray-50 transition-colors ${activeThreadId === thread.id ? 'bg-primary-light border-s-2 border-primary' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <p className="flex min-w-0 items-baseline gap-1.5">
                                            <TicketNumber value={thread.ticketNumber} className="text-[11px]" />
                                            <span className="truncate text-sm font-bold text-gray-900">{thread.subject}</span>
                                        </p>
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

                <div className="flex-1 flex flex-col overflow-hidden rounded-lg border border-gray-100 bg-white min-w-0">
                    {!activeThreadId ? (
                        <div className="flex-1 flex flex-col items-center justify-center text-sm text-gray-400 gap-2">
                            <MessageSquare className="w-8 h-8 text-gray-200" />
                            <p>{page.select}</p>
                        </div>
                    ) : (
                        <>
                            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="font-semibold text-sm text-gray-900 truncate">{threadInfo?.subject}</p>
                                    {threadInfo?.ticketNumber && (
                                        <p className="text-[11px] text-gray-500">
                                            {formatMessage(page.ticketLabel, { number: threadInfo.ticketNumber })}
                                        </p>
                                    )}
                                    {threadInfo?.page && (
                                        <p className="text-[10px] text-gray-400 truncate">{threadInfo.page}</p>
                                    )}
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
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

                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                                                <div className={`max-w-[75%] rounded-lg px-4 py-2.5 ${isOwner ? 'bg-primary text-white' : 'bg-gray-100 text-gray-900'}`}>
                                                    <p className={`text-[10px] font-bold mb-1 ${isOwner ? 'text-blue-100' : 'text-gray-500'}`}>
                                                        {isOwner ? page.you : page.admin}
                                                    </p>
                                                    <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
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
                                <div className="px-4 py-3 border-t border-gray-100">
                                    <div className="flex items-end gap-2">
                                        <textarea
                                            value={replyBody}
                                            onChange={(e) => setReplyBody(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && !e.shiftKey) {
                                                    e.preventDefault();
                                                    void sendReply();
                                                }
                                            }}
                                            placeholder={page.replyPlaceholder}
                                            rows={2}
                                            className="flex-1 resize-none rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-primary/40 focus:bg-white"
                                        />
                                        <button
                                            type="button"
                                            onClick={sendReply}
                                            disabled={sending || !replyBody.trim()}
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
                            onCreated={(created) => {
                                setShowNewForm(false);
                                selectThread(created.id);
                                void loadThreads();
                            }}
                        />
                    </div>
                </ModalShell>
            )}
        </div>
    );
}
