'use client';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Bot, ChevronDown, History, Loader2, MessageSquare, Send, Trash2, X } from 'lucide-react';
import type { AiChatConversationSummary, AiChatMessage, AiChatToolCall } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/**
 * The markdown renderer is a sizeable dependency and the chat panel is closed on
 * most page views, so it is fetched only once an answer needs it. Until it lands
 * the raw text shows — readable, just unstyled.
 */
const Markdown = lazy(() => import('@/components/ui/Markdown'));

/**
 * Deep link per tool, so an answer can hand the user the real report rather than
 * being the only place that number exists. Keyed by backend tool name.
 */
const TOOL_ROUTES: Record<string, string> = {
    // Sales
    sales_summary: '/sales/reports/summary',
    sales_trend: '/sales/reports/summary',
    sales_breakdown: '/sales/reports/products',
    top_movers: '/sales/reports/products',
    returns_analysis: '/sales/returns',
    customer_retention: '/sales/customers/reports/due-aging',
    // Inventory
    low_stock: '/inventory/reports/reorder',
    stock_on_hand: '/inventory/reports/valuation',
    stock_aging: '/inventory/reports/valuation',
    stock_movements: '/inventory/ledger',
    shrinkage_summary: '/inventory/shrinkage',
    // Purchasing
    purchase_summary: '/purchases/reports/summary',
    purchase_trend: '/purchases/reports/summary',
    purchase_breakdown: '/purchases/reports/summary',
    // Parties
    customer_lookup: '/sales/customers',
    customer_purchase_history: '/sales/customers',
    customer_segments: '/sales/customers',
    receivables_aging: '/sales/customers/reports/due-aging',
    payables_aging: '/accounting/reports/ap-aging',
    supplier_lookup: '/purchases/supplier-ledger',
    // Finance
    expense_summary: '/accounting/expenses',
    // financial_statement covers five statements; P&L is the one users mean
    // most often, and every other statement is one click away from it.
    financial_statement: '/accounting/reports/pl',
    budget_vs_actual: '/accounting/reports/budget-vs-actual',
    vat_tax_summary: '/accounting/reports/vat-tax',
    cash_position: '/accounting/reports/cashbook',
    // Operations
    open_pipeline: '/sales/orders',
    workforce_summary: '/hr/attendance',
    loyalty_summary: '/sales/loyalty',
    // The general-purpose lookups have no single report page behind them, so
    // they are deliberately absent: a link to the wrong page is worse than none.
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
    const [showHistory, setShowHistory] = useState(false);
    const [conversations, setConversations] = useState<AiChatConversationSummary[] | null>(null);
    const [historyBusy, setHistoryBusy] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (open && !showHistory) inputRef.current?.focus();
    }, [open, showHistory]);

    useEffect(() => {
        if (!showHistory) {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
        }
    }, [messages, sending, showHistory]);

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
        setShowHistory(false);
    }, []);

    /**
     * Refetched on every open rather than cached: the list is short, and the
     * thread the user just typed into has to appear at the top without a reload.
     */
    const openHistory = useCallback(async () => {
        setShowHistory(true);
        setHistoryError(null);
        setHistoryBusy(true);
        try {
            setConversations(await api.getAiConversations());
        } catch {
            setHistoryError(m.historyLoadError);
        } finally {
            setHistoryBusy(false);
        }
    }, [m.historyLoadError]);

    const openConversation = useCallback(
        async (id: string) => {
            setHistoryError(null);
            setHistoryBusy(true);
            try {
                const detail = await api.getAiConversation(id);
                setMessages(detail.messages);
                setConversationId(detail.id);
                setError(null);
                setShowHistory(false);
            } catch {
                setHistoryError(m.conversationLoadError);
            } finally {
                setHistoryBusy(false);
            }
        },
        [m.conversationLoadError],
    );

    const deleteConversation = useCallback(
        async (id: string) => {
            try {
                await api.deleteAiConversation(id);
                setConversations((prev) => prev?.filter((c) => c.id !== id) ?? null);
                // Deleting the thread that is currently on screen would otherwise
                // leave the next question posting to a conversation that is gone.
                if (id === conversationId) {
                    setConversationId(undefined);
                    setMessages([]);
                }
                toast.success(m.deleted);
            } catch {
                toast.error(m.deleteError);
            }
        },
        [conversationId, m.deleteError, m.deleted],
    );

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
                                {showHistory ? (
                                    <button
                                        type="button"
                                        onClick={() => setShowHistory(false)}
                                        className="flex min-h-touch min-w-touch items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100"
                                        aria-label={m.historyBackAria}
                                    >
                                        <ArrowLeft className="h-4 w-4" />
                                    </button>
                                ) : (
                                    <Bot className="h-4 w-4 text-blue-600" />
                                )}
                                <span className="text-sm font-semibold text-gray-900">
                                    {showHistory ? m.historyTitle : m.title}
                                </span>
                            </div>
                            <div className="flex items-center gap-1">
                                {showHistory ? null : (
                                    <>
                                        <button
                                            type="button"
                                            onClick={() => void openHistory()}
                                            className="flex min-h-touch min-w-touch items-center justify-center rounded-md p-1.5 text-gray-500 hover:bg-gray-100 hover:text-blue-600"
                                            aria-label={m.historyAria}
                                            title={m.historyAria}
                                        >
                                            <History className="h-4 w-4" />
                                        </button>
                                        {messages.length > 0 ? (
                                            <button
                                                type="button"
                                                onClick={startNew}
                                                className="rounded-md px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                                            >
                                                {m.newChat}
                                            </button>
                                        ) : null}
                                    </>
                                )}
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

                        {showHistory ? (
                            <HistoryList
                                conversations={conversations}
                                busy={historyBusy}
                                error={historyError}
                                activeId={conversationId}
                                labels={m}
                                locale={locale}
                                onOpen={openConversation}
                                onDelete={deleteConversation}
                            />
                        ) : (
                            <>
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
                            </>
                        )}
                    </div>
                </>
            ) : null}
        </>
    );
}

type HistoryLabels = {
    historyEmpty: string;
    untitledConversation: string;
    messageCount: string;
    deleteAria: string;
    deleteConfirm: string;
    deleteConfirmAria: string;
    deleteCancel: string;
};

/**
 * The past-threads pane. Replaces the message list in-place rather than opening a
 * second modal over the panel: on mobile the panel is already a bottom sheet, and
 * stacking a sheet on a sheet buries the dismiss affordance.
 */
function HistoryList({
    conversations,
    busy,
    error,
    activeId,
    labels,
    locale,
    onOpen,
    onDelete,
}: Readonly<{
    conversations: AiChatConversationSummary[] | null;
    busy: boolean;
    error: string | null;
    activeId?: string;
    labels: HistoryLabels;
    locale: string;
    onOpen: (id: string) => void;
    onDelete: (id: string) => void;
}>) {
    // Two-step delete rather than a confirm dialog: the destructive control sits
    // inside a row, and swapping it for an explicit confirm keeps the whole
    // interaction on one surface.
    const [pendingDelete, setPendingDelete] = useState<string | null>(null);

    if (busy && !conversations) {
        return (
            <div className="flex flex-1 items-center justify-center p-3">
                <Loader2 className="h-4 w-4 animate-spin text-gray-400" />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-3">
            {error ? (
                <div className="mb-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">{error}</div>
            ) : null}

            {conversations?.length === 0 ? (
                <div className="py-8 text-center">
                    <MessageSquare className="mx-auto h-8 w-8 text-gray-300" />
                    <p className="mt-2 text-xs text-gray-500">{labels.historyEmpty}</p>
                </div>
            ) : null}

            <ul className="space-y-1">
                {conversations?.map((c) => (
                    <li
                        key={c.id}
                        className={`flex items-center gap-1 rounded-lg border px-2 ${
                            c.id === activeId ? 'border-blue-600 bg-blue-50' : 'border-gray-200'
                        }`}
                    >
                        <button
                            type="button"
                            onClick={() => onOpen(c.id)}
                            className="min-h-touch flex-1 overflow-hidden py-2 text-left"
                        >
                            <span className="block truncate text-xs font-medium text-gray-900">
                                {c.title || labels.untitledConversation}
                            </span>
                            <span className="block text-[11px] text-gray-500">
                                {formatDate(c.updated_at, locale)} ·{' '}
                                {labels.messageCount.replace('{count}', String(c.message_count))}
                            </span>
                        </button>

                        {pendingDelete === c.id ? (
                            <span className="flex items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setPendingDelete(null);
                                        onDelete(c.id);
                                    }}
                                    className="min-h-touch rounded-md px-2 text-xs font-medium text-red-600 hover:bg-red-50"
                                    aria-label={labels.deleteConfirmAria}
                                >
                                    {labels.deleteConfirm}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setPendingDelete(null)}
                                    className="min-h-touch rounded-md px-2 text-xs text-gray-500 hover:bg-gray-100"
                                >
                                    {labels.deleteCancel}
                                </button>
                            </span>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setPendingDelete(c.id)}
                                className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600"
                                aria-label={labels.deleteAria}
                                title={labels.deleteAria}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </li>
                ))}
            </ul>
        </div>
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
            {/* Markdown, never HTML: the content is model output built partly from
                tenant-controlled strings (product and customer names), so raw HTML
                stays disabled in the renderer. */}
            <div className="max-w-[95%] rounded-lg rounded-bl-sm bg-gray-100 px-3 py-2 text-sm text-gray-900">
                <Suspense fallback={<div className="whitespace-pre-wrap">{message.content}</div>}>
                    <Markdown content={message.content} />
                </Suspense>
            </div>
            {message.tool_calls?.length ? <Sources calls={message.tool_calls} label={sourcesLabel} /> : null}
        </div>
    );
}

/** Domain only — a full URL does not fit the panel and reads as noise. */
function hostOf(url: string): string {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return url;
    }
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
                            typeof call.args.query === 'string' ? `“${call.args.query}”` : null,
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
                                {/* Web sources get their own links: unlike an internal
                                    lookup there is no report page to point at, and an
                                    unattributable external claim is not auditable. */}
                                {call.urls?.length ? (
                                    <ul className="mt-0.5 space-y-0.5 pl-3">
                                        {call.urls.map((url) => (
                                            <li key={url} className="truncate">
                                                <a
                                                    href={url}
                                                    target="_blank"
                                                    rel="noopener noreferrer nofollow"
                                                    className="text-blue-600 hover:underline"
                                                    title={url}
                                                >
                                                    {hostOf(url)}
                                                </a>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </div>
    );
}
