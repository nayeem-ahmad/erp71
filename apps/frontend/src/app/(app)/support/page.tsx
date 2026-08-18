'use client';

import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Plus, Send, CheckCircle, Loader2 } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { usePlatformFeatures } from '@/contexts/PlatformFeaturesContext';
import ModalShell, { ModalHeader } from '@/components/ModalShell';
import SupportComposer from '@/components/SupportComposer';

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
    const { t } = useI18n();
    const page = t.components.supportPage;
    const types = t.components.feedbackWidget.types;
    const { support, feedback } = usePlatformFeatures();

    const [threads, setThreads] = useState<Thread[]>([]);
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

    const categoryLabel = (category: string) => {
        if (category === 'support') return types.support;
        if (category === 'bug') return types.bug;
        if (category === 'feature') return types.feature;
        return types.general;
    };

    const loadThreads = async () => {
        try {
            const data = await api.getSupportThreads() as Thread[];
            setThreads(data);
        } catch (err: any) {
            setError(err.message || 'Failed to load threads');
        } finally {
            setLoadingThreads(false);
        }
    };

    const loadMessages = async (threadId: string) => {
        setLoadingMessages(true);
        try {
            const res: any = await api.getSupportMessages(threadId);
            setMessages(res.messages ?? []);
            setThreadInfo(res.thread ?? null);
        } catch (err: any) {
            setError(err.message || 'Failed to load messages');
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        void loadThreads();
        const params = new URLSearchParams(window.location.search);
        const thread = params.get('thread');
        if (thread) setActiveThreadId(thread);
    }, []);

    useEffect(() => {
        if (!activeThreadId) return;
        void loadMessages(activeThreadId);

        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(() => {
            void loadMessages(activeThreadId);
            void loadThreads();
        }, 10000);

        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, [activeThreadId]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const selectThread = (id: string) => {
        setActiveThreadId(id);
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
                                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${activeThreadId === thread.id ? 'bg-primary-light border-l-2 border-primary' : ''}`}
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
                                        {new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
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
                            onCreated={(threadId) => {
                                setShowNewForm(false);
                                setActiveThreadId(threadId);
                                void loadThreads();
                            }}
                        />
                    </div>
                </ModalShell>
            )}
        </div>
    );
}
