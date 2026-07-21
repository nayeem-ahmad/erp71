'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bot, ChevronDown, Loader2, MessageSquare, Send, X } from 'lucide-react';
import type { AiChatMessage, AiChatToolCall } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/**
 * Deep link per tool, so an answer can hand the user the real report rather than
 * being the only place that number exists. Keyed by backend tool name.
 */
const TOOL_ROUTES: Record<string, string> = {
    sales_summary: '/sales/reports/summary',
    top_products: '/sales/reports/products',
    low_stock: '/inventory/reports/reorder',
    stock_on_hand: '/inventory/reports/valuation',
    customer_lookup: '/sales/customers',
    receivables_aging: '/sales/customers/reports/due-aging',
    expense_summary: '/accounting/expenses',
    purchase_summary: '/purchases/reports/summary',
};

export default function AiChatWidget() {
    const { t, locale } = useI18n();
    const m = t.components.aiChatWidget;
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<AiChatMessage[]>([]);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [conversationId, setConversationId] = useState<string | undefined>();
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }, [messages, sending]);

    const send = useCallback(
        async (text: string) => {
            const question = text.trim();
            if (!question || sending) return;

            setError(null);
            setInput('');
            setSending(true);
            setMessages((prev) => [
                ...prev,
                { id: `local-${prev.length}`, role: 'user', content: question, created_at: new Date().toISOString() },
            ]);

            try {
                const result = await api.aiChat({ message: question, conversationId, locale });
                setConversationId(result.conversation_id);
                setMessages((prev) => [...prev, result.message]);
            } catch (err: unknown) {
                setError(err instanceof Error ? err.message : m.genericError);
            } finally {
                setSending(false);
            }
        },
        [conversationId, locale, m.genericError, sending],
    );

    const startNew = useCallback(() => {
        setConversationId(undefined);
        setMessages([]);
        setError(null);
    }, []);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="flex min-h-touch min-w-touch items-center justify-center rounded-lg p-2 text-gray-600 transition-colors hover:bg-gray-100 hover:text-blue-600"
                aria-label={m.openAria}
                aria-expanded={open}
                title={m.openAria}
            >
                <Bot className="h-5 w-5" />
            </button>

            {open ? (
                <>
                    {/* Mobile: a bottom sheet over a scrim. Desktop: a docked right-hand panel. */}
                    <button
                        type="button"
                        className="fixed inset-0 z-modal bg-black/40 backdrop-blur-sm md:hidden"
                        onClick={() => setOpen(false)}
                        aria-label={m.closeAria}
                    />
                    <div className="fixed inset-x-0 bottom-0 z-modal flex h-[80vh] flex-col rounded-t-xl border border-gray-200 bg-white shadow-2xl md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-[380px] md:rounded-none md:border-y-0 md:border-r-0">
                        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2">
                            <div className="flex items-center gap-2">
                                <Bot className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-semibold text-gray-900">{m.title}</span>
                            </div>
                            <div className="flex items-center gap-1">
                                {messages.length > 0 ? (
                                    <button
                                        type="button"
                                        onClick={startNew}
                                        className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                                    >
                                        {m.newChat}
                                    </button>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={() => setOpen(false)}
                                    className="flex min-h-touch min-w-touch items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                                    aria-label={m.closeAria}
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        </div>

                        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
                            {messages.length === 0 ? (
                                <EmptyState
                                    heading={m.emptyHeading}
                                    description={m.emptyDescription}
                                    suggestions={[
                                        m.suggestions.s1,
                                        m.suggestions.s2,
                                        m.suggestions.s3,
                                        m.suggestions.s4,
                                    ]}
                                    onPick={send}
                                />
                            ) : null}

                            {/* Keyed by position too: locally-optimistic user messages
                                carry a placeholder id, so ids alone are not unique. */}
                            {messages.map((message, index) => (
                                <MessageBubble
                                    key={`${index}-${message.id}`}
                                    message={message}
                                    sourcesLabel={m.sources}
                                />
                            ))}

                            {sending ? (
                                <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    {m.thinking}
                                </div>
                            ) : null}

                            {error ? (
                                <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
                            ) : null}
                        </div>

                        <div className="border-t border-gray-200 p-2">
                            <div className="flex items-end gap-2">
                                <textarea
                                    ref={inputRef}
                                    value={input}
                                    onChange={(e) => setInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            void send(input);
                                        }
                                    }}
                                    rows={2}
                                    maxLength={2000}
                                    placeholder={m.placeholder}
                                    className="min-h-touch flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
                                />
                                <button
                                    type="button"
                                    onClick={() => void send(input)}
                                    disabled={sending || !input.trim()}
                                    className="flex min-h-touch min-w-touch items-center justify-center rounded-lg bg-blue-600 p-2 text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
                                    aria-label={m.sendAria}
                                >
                                    <Send className="h-4 w-4" />
                                </button>
                            </div>
                            <p className="mt-1 px-1 text-[11px] text-gray-400">{m.disclaimer}</p>
                        </div>
                    </div>
                </>
            ) : null}
        </>
    );
}

function EmptyState({
    heading,
    description,
    suggestions,
    onPick,
}: {
    heading: string;
    description: string;
    suggestions: string[];
    onPick: (text: string) => void;
}) {
    return (
        <div className="space-y-3 py-4">
            <div className="text-center">
                <MessageSquare className="mx-auto h-8 w-8 text-gray-300" />
                <p className="mt-2 text-sm font-semibold text-gray-900">{heading}</p>
                <p className="mt-1 text-xs text-gray-500">{description}</p>
            </div>
            <div className="space-y-1.5">
                {suggestions.map((s) => (
                    <button
                        key={s}
                        type="button"
                        onClick={() => onPick(s)}
                        className="min-h-touch w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-xs text-gray-700 transition-colors hover:border-blue-600 hover:bg-blue-50 hover:text-blue-700"
                    >
                        {s}
                    </button>
                ))}
            </div>
        </div>
    );
}

function MessageBubble({ message, sourcesLabel }: { message: AiChatMessage; sourcesLabel: string }) {
    if (message.role === 'user') {
        return (
            <div className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-lg rounded-br-sm bg-blue-600 px-3 py-2 text-sm text-white">
                    {message.content}
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-1">
            {/* Rendered as text, never as HTML: the content is model output built
                partly from tenant-controlled strings (product and customer names). */}
            <div className="max-w-[95%] whitespace-pre-wrap rounded-lg rounded-bl-sm bg-gray-100 px-3 py-2 text-sm text-gray-900">
                {message.content}
            </div>
            {message.tool_calls?.length ? <Sources calls={message.tool_calls} label={sourcesLabel} /> : null}
        </div>
    );
}

/**
 * The audit affordance: every answer shows exactly which lookups produced it,
 * with a link through to the real report. Collapsed by default so it does not
 * compete with the answer.
 */
function Sources({ calls, label }: { calls: AiChatToolCall[]; label: string }) {
    const [expanded, setExpanded] = useState(false);
    const named = calls.filter((c) => !c.error);
    if (named.length === 0) return null;

    return (
        <div className="px-1">
            <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-gray-500 hover:text-blue-600"
            >
                <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? '' : '-rotate-90'}`} />
                {label} ({named.length})
            </button>
            {expanded ? (
                <ul className="mt-1 space-y-0.5 pl-4">
                    {named.map((call, i) => {
                        const route = TOOL_ROUTES[call.name];
                        const detail = [
                            call.args.from && call.args.to ? `${call.args.from} → ${call.args.to}` : null,
                            typeof call.rowCount === 'number' ? `${call.rowCount} rows` : null,
                        ]
                            .filter(Boolean)
                            .join(', ');
                        return (
                            <li key={`${call.name}-${i}`} className="text-[11px] text-gray-500">
                                {route ? (
                                    <Link href={route} className="text-blue-600 hover:underline">
                                        {call.name}
                                    </Link>
                                ) : (
                                    <span>{call.name}</span>
                                )}
                                {detail ? <span className="text-gray-400"> — {detail}</span> : null}
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
