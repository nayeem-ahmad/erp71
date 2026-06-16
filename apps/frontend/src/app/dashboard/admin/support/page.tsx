'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n, formatMessage } from '@/lib/i18n';
import { MessageSquare, Search, Send, CheckCircle, RotateCcw, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';

type Thread = {
    id: string;
    subject: string;
    status: string;
    tenant: string;
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

export default function AdminSupportPage() {
    const { t } = useI18n();
    const m = t.admin.support;

    const [threads, setThreads] = useState<Thread[]>([]);
    const [total, setTotal] = useState(0);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState('');

    const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
    const [messages, setMessages] = useState<Message[]>([]);
    const [threadInfo, setThreadInfo] = useState<{ subject: string; status: string; tenant: string } | null>(null);
    const [replyBody, setReplyBody] = useState('');
    const [sending, setSending] = useState(false);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [resolving, setResolving] = useState(false);

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const loadThreads = async (opts?: { search?: string; status?: string }) => {
        setIsLoading(true);
        try {
            const res: any = await api.getAdminSupportThreads({
                search: (opts?.search ?? search) || undefined,
                status: (opts?.status ?? statusFilter) || undefined,
                limit: 50,
            });
            setThreads(res.data ?? []);
            setTotal(res.total ?? 0);
        } catch (err: any) {
            setError(err.message || m.loadFailed);
        } finally {
            setIsLoading(false);
        }
    };

    const loadMessages = async (threadId: string) => {
        setLoadingMessages(true);
        try {
            const res: any = await api.getAdminSupportMessages(threadId);
            setMessages(res.messages ?? []);
            setThreadInfo(res.thread ?? null);
        } catch (err: any) {
            setError(err.message || m.loadFailed);
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        void loadThreads();
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

    const handleSearch = (value: string) => {
        setSearch(value);
        void loadThreads({ search: value, status: statusFilter });
    };

    const handleStatusFilter = (value: string) => {
        setStatusFilter(value);
        void loadThreads({ search, status: value });
    };

    const selectThread = (id: string) => {
        setActiveThreadId(id);
        setError('');
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

    return (
        <div className="h-full flex flex-col overflow-hidden bg-[#f3f4f6]">
            <div className="flex-1 flex overflow-hidden p-4 gap-4 min-h-0">
                {/* Thread list */}
                <div className="w-80 shrink-0 flex flex-col gap-3 overflow-hidden">
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-gray-900">{m.title}</h1>
                        <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mt-0.5">
                            {formatMessage(m.subtitle, { total })}
                        </p>
                    </div>

                    {error && (
                        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-col gap-2">
                        <label className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white px-3 py-2">
                            <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                            <input
                                value={search}
                                onChange={(e) => handleSearch(e.target.value)}
                                placeholder={m.searchPlaceholder}
                                className="w-full bg-transparent outline-none text-sm"
                            />
                        </label>
                        <select
                            value={statusFilter}
                            onChange={(e) => handleStatusFilter(e.target.value)}
                            className="rounded-xl border border-gray-100 bg-white px-3 py-2 text-sm font-semibold text-gray-700 outline-none cursor-pointer"
                        >
                            <option value="">{m.allStatuses}</option>
                            <option value="open">{m.statusOpen}</option>
                            <option value="resolved">{m.statusResolved}</option>
                        </select>
                    </div>

                    <div className="flex-1 overflow-y-auto rounded-2xl border border-gray-100 bg-white divide-y divide-gray-100">
                        {isLoading ? (
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
                                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${activeThreadId === thread.id ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''}`}
                                >
                                    <div className="flex items-center justify-between gap-2 mb-0.5">
                                        <p className="text-sm font-bold text-gray-900 truncate">{thread.subject}</p>
                                        <span className={`shrink-0 text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-full ${thread.status === 'resolved' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                                            {thread.status}
                                        </span>
                                    </div>
                                    <p className="text-xs text-gray-500 font-semibold truncate">{thread.tenant}</p>
                                    {thread.lastMessage && (
                                        <p className="text-xs text-gray-400 truncate mt-0.5">{thread.lastMessage.body}</p>
                                    )}
                                    <p className="text-[10px] text-gray-300 mt-1">
                                        {new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                    </p>
                                </button>
                            ))
                        )}
                    </div>
                </div>

                {/* Message area */}
                <div className="flex-1 flex flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white min-w-0">
                    {!activeThreadId ? (
                        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-sm text-gray-400">
                            <MessageSquare className="w-8 h-8 text-gray-200" />
                            <p>{m.selectThread}</p>
                        </div>
                    ) : (
                        <>
                            {/* Thread header */}
                            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="font-black text-sm text-gray-900 truncate">{threadInfo?.subject}</p>
                                    {threadInfo?.tenant && (
                                        <p className="text-xs text-gray-500 font-semibold">{threadInfo.tenant}</p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    onClick={toggleResolve}
                                    disabled={resolving}
                                    className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-colors ${
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

                            {/* Messages */}
                            <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                                                <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 ${isAdmin ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
                                                    <p className={`text-[10px] font-bold mb-1 ${isAdmin ? 'text-indigo-200' : 'text-gray-500'}`}>
                                                        {isAdmin ? m.you : m.owner}
                                                    </p>
                                                    <p className="text-sm whitespace-pre-wrap">{msg.body}</p>
                                                    <p className={`text-[10px] mt-1 ${isAdmin ? 'text-indigo-300' : 'text-gray-400'}`}>
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
                                        placeholder={m.replyPlaceholder}
                                        rows={2}
                                        className="flex-1 resize-none rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm outline-none focus:border-indigo-400 focus:bg-white"
                                    />
                                    <button
                                        type="button"
                                        onClick={sendReply}
                                        disabled={sending || !replyBody.trim()}
                                        className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-40"
                                    >
                                        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
