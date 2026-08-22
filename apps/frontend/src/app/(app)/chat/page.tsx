'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BellOff, Info, Loader2, Plus, Users } from 'lucide-react';
import PageHeader from '@/components/ui/compact/PageHeader';
import { PageShell } from '@/components/ui';
import ChatAvatar from '@/components/chat/ChatAvatar';
import ConversationDetailsModal from '@/components/chat/ConversationDetailsModal';
import ConversationList from '@/components/chat/ConversationList';
import MessageComposer from '@/components/chat/MessageComposer';
import MessageThread from '@/components/chat/MessageThread';
import NewConversationModal from '@/components/chat/NewConversationModal';
import {
    seenReceiptMessageId,
    type ChatConversation,
    type ChatMessage,
    type ChatMessagePage,
    type PendingAttachment,
} from '@/components/chat/types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { toast } from '@/lib/toast';

/** The open thread should feel live; the list only has to stay roughly current. */
const MESSAGE_POLL_MS = 5_000;
const LIST_POLL_MS = 30_000;

export default function ChatPage() {
    const { t } = useI18n();
    const m = t.chat;
    const router = useRouter();
    const searchParams = useSearchParams();

    const [conversations, setConversations] = useState<ChatConversation[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [active, setActive] = useState<ChatConversation | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [cursor, setCursor] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);

    const [loadingList, setLoadingList] = useState(true);
    const [loadingThread, setLoadingThread] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [sending, setSending] = useState(false);
    const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [showDetails, setShowDetails] = useState(false);
    const [currentUserId, setCurrentUserId] = useState<string | null>(null);
    const [unavailable, setUnavailable] = useState(false);

    // Read by `loadMessages`, which must not take these as dependencies: it is the
    // poll callback, and a new identity for it tears down and restarts the
    // interval — re-running the loud path and flashing the spinner.
    const currentUserIdRef = useRef<string | null>(null);
    const markedReadRef = useRef<{ conversationId: string; through: string } | null>(null);

    // Needed to tell my own messages from everyone else's, and to decide who the
    // "other person" in a DM is.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const user = (await api.getMe()) as { id?: string } | null;
                if (!cancelled) setCurrentUserId(user?.id ?? null);
            } catch {
                if (!cancelled) setCurrentUserId(null);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        currentUserIdRef.current = currentUserId;
    }, [currentUserId]);

    // Deep link from a chat notification: /chat?conversation=<id>
    useEffect(() => {
        const requested = searchParams.get('conversation');
        if (requested) setActiveId(requested);
    }, [searchParams]);

    const loadConversations = useCallback(async () => {
        try {
            const list = (await api.getChatConversations()) as ChatConversation[];
            setConversations(Array.isArray(list) ? list : []);
            setUnavailable(false);
        } catch (error) {
            const status = (error as { status?: number })?.status;
            if (status === 403) {
                setUnavailable(true);
            } else {
                toast.error(m.errors.listFailed);
            }
        } finally {
            setLoadingList(false);
        }
    }, [m.errors.listFailed]);

    /**
     * Refreshes the newest page of a thread. `quiet` is the poll path: it must
     * not raise a spinner or a toast, or the thread flickers and errors stack up
     * every five seconds while the network is down.
     */
    const loadMessages = useCallback(
        async (conversationId: string, quiet = false) => {
            if (!quiet) setLoadingThread(true);
            try {
                const [page, conversation] = await Promise.all([
                    api.getChatMessages(conversationId) as Promise<ChatMessagePage>,
                    api.getChatConversation(conversationId) as Promise<ChatConversation>,
                ]);
                setMessages(page.messages ?? []);
                setCursor(page.nextCursor ?? null);
                setHasMore(Boolean(page.hasMore));
                setActive(conversation);

                // Only stamp the cursor when it would actually move. This runs on
                // every 5s poll, so an unconditional call is one write per open
                // client per poll — and since the stamp is now visible to the
                // other side as a read receipt, a pointless write is not free.
                // Sending already stamps it server-side, hence the sender check.
                const newest = page.messages?.[page.messages.length - 1] ?? null;
                const marked = markedReadRef.current;
                const alreadyMarked =
                    marked?.conversationId === conversationId &&
                    marked.through >= (newest?.createdAt ?? '');
                if (newest && newest.sender.id !== currentUserIdRef.current && !alreadyMarked) {
                    await api.markChatConversationRead(conversationId);
                    // Recorded as the message we read up to rather than the wall
                    // clock: the server stamps now(), which is never earlier.
                    markedReadRef.current = { conversationId, through: newest.createdAt };
                }

                // Zero this row locally so the badge clears immediately rather
                // than on the next list poll.
                setConversations((prev) =>
                    prev.map((row) =>
                        row.id === conversationId ? { ...row, unreadCount: 0 } : row,
                    ),
                );
            } catch (error) {
                if (quiet) return;
                const status = (error as { status?: number })?.status;
                if (status === 404) {
                    // Left the group, or it was never ours: drop back to the list.
                    setActiveId(null);
                    setActive(null);
                    void loadConversations();
                } else {
                    toast.error(m.errors.messagesFailed);
                }
            } finally {
                if (!quiet) setLoadingThread(false);
            }
        },
        [loadConversations, m.errors.messagesFailed],
    );

    useEffect(() => {
        void loadConversations();
    }, [loadConversations]);

    useEffect(() => {
        if (unavailable) return;
        const timer = setInterval(() => void loadConversations(), LIST_POLL_MS);
        return () => clearInterval(timer);
    }, [loadConversations, unavailable]);

    useEffect(() => {
        if (!activeId) {
            setActive(null);
            setMessages([]);
            return;
        }
        setEditing(null);
        void loadMessages(activeId);

        const timer = setInterval(() => void loadMessages(activeId, true), MESSAGE_POLL_MS);
        return () => clearInterval(timer);
    }, [activeId, loadMessages]);

    const loadOlder = async () => {
        if (!activeId || !cursor) return;
        setLoadingMore(true);
        try {
            const page = (await api.getChatMessages(activeId, {
                before: cursor,
            })) as ChatMessagePage;
            setMessages((prev) => [...(page.messages ?? []), ...prev]);
            setCursor(page.nextCursor ?? null);
            setHasMore(Boolean(page.hasMore));
        } catch {
            toast.error(m.errors.messagesFailed);
        } finally {
            setLoadingMore(false);
        }
    };

    const send = async (body: string, attachments: PendingAttachment[]): Promise<boolean> => {
        if (!activeId) return false;
        setSending(true);
        try {
            if (editing) {
                await api.editChatMessage(editing.id, body);
                setEditing(null);
            } else {
                await api.sendChatMessage(activeId, {
                    body,
                    attachments: attachments.map((attachment) => ({
                        fileBase64: attachment.fileBase64,
                        fileName: attachment.fileName,
                        mimeType: attachment.mimeType,
                    })),
                });
            }
            await loadMessages(activeId, true);
            void loadConversations();
            return true;
        } catch (error) {
            toast.error((error as Error)?.message || m.errors.sendFailed);
            return false;
        } finally {
            setSending(false);
        }
    };

    const removeMessage = async (message: ChatMessage) => {
        try {
            await api.deleteChatMessage(message.id);
            if (activeId) await loadMessages(activeId, true);
            void loadConversations();
        } catch (error) {
            toast.error((error as Error)?.message || m.errors.deleteFailed);
        }
    };

    const openConversation = (id: string) => {
        setActiveId(id);
        // Keep the URL shareable and the back button meaningful on mobile, where
        // list and thread are two separate screens.
        router.replace(`${routes.chat}?conversation=${id}`, { scroll: false });
    };

    const backToList = () => {
        setActiveId(null);
        router.replace(routes.chat, { scroll: false });
    };

    const seenMessageId = useMemo(
        () => seenReceiptMessageId(messages, currentUserId, active),
        [messages, currentUserId, active],
    );

    const totalUnread = useMemo(
        () => conversations.reduce((sum, row) => sum + (row.unreadCount ?? 0), 0),
        [conversations],
    );

    if (unavailable) {
        return (
            <PageShell>
                <PageHeader title={m.page.title} />
                <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
                    <p className="text-sm text-gray-700">{m.page.notEnabled}</p>
                    <p className="mt-1 text-xs text-gray-500">{m.page.notEnabledHint}</p>
                </div>
            </PageShell>
        );
    }

    return (
        <div className="flex h-full flex-col overflow-hidden bg-canvas">
            <div className="flex min-h-0 flex-1 gap-0 overflow-hidden md:gap-4 md:p-4">
                {/* List pane. On mobile the two panes are one screen each, pushed
                    by the back button — a side-by-side split would scroll the
                    body horizontally at 360px. */}
                <aside
                    className={`flex w-full min-w-0 flex-col overflow-hidden border-e border-gray-200 bg-white md:w-72 md:shrink-0 md:rounded-lg md:border ${
                        activeId ? 'hidden md:flex' : 'flex'
                    }`}
                >
                    <div className="border-b border-gray-200 p-3">
                        <PageHeader
                            title={m.page.title}
                            subtitle={
                                totalUnread > 0 ? m.page.unreadSubtitle : undefined
                            }
                            actions={
                                <button
                                    type="button"
                                    onClick={() => setShowNew(true)}
                                    className="inline-flex min-h-touch items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
                                >
                                    <Plus className="h-3 w-3" aria-hidden="true" />
                                    {m.page.newConversation}
                                </button>
                            }
                        />
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        <ConversationList
                            conversations={conversations}
                            activeId={activeId}
                            loading={loadingList}
                            onSelect={openConversation}
                        />
                    </div>
                </aside>

                <section
                    className={`min-w-0 flex-1 flex-col overflow-hidden bg-white md:rounded-lg md:border md:border-gray-200 ${
                        activeId ? 'flex' : 'hidden md:flex'
                    }`}
                >
                    {!activeId ? (
                        <div className="flex flex-1 items-center justify-center p-6">
                            <p className="text-sm text-gray-500">{m.page.pickConversation}</p>
                        </div>
                    ) : !active ? (
                        <div className="flex flex-1 items-center justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                        </div>
                    ) : (
                        <>
                            <header className="flex items-center gap-2 border-b border-gray-200 p-3">
                                <button
                                    type="button"
                                    onClick={backToList}
                                    aria-label={m.actions.back}
                                    className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 md:hidden"
                                >
                                    <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
                                </button>

                                {active.kind === 'group' ? (
                                    <span
                                        aria-hidden="true"
                                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-600"
                                    >
                                        <Users className="h-4 w-4" />
                                    </span>
                                ) : (
                                    <ChatAvatar
                                        person={
                                            active.participants.find(
                                                (person) => person.id !== currentUserId,
                                            ) ?? { name: active.title }
                                        }
                                    />
                                )}

                                <div className="min-w-0 flex-1">
                                    <h2 className="flex items-center gap-1 truncate text-sm font-semibold text-gray-900">
                                        {active.title}
                                        {active.muted && (
                                            <BellOff
                                                className="h-3 w-3 text-gray-400"
                                                aria-label={m.list.muted}
                                            />
                                        )}
                                    </h2>
                                    <p className="truncate text-xs text-gray-500">
                                        {active.kind === 'group'
                                            ? `${active.participants.length} ${m.page.members}`
                                            : (active.participants.find(
                                                  (person) => person.id !== currentUserId,
                                              )?.email ?? '')}
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    onClick={() => setShowDetails(true)}
                                    aria-label={m.details.title}
                                    className="flex min-h-touch min-w-touch items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-700"
                                >
                                    <Info className="h-4 w-4" />
                                </button>
                            </header>

                            <MessageThread
                                messages={messages}
                                currentUserId={currentUserId}
                                seenMessageId={seenMessageId}
                                loading={loadingThread}
                                hasMore={hasMore}
                                loadingMore={loadingMore}
                                onLoadMore={() => void loadOlder()}
                                onEdit={(message) =>
                                    setEditing({ id: message.id, body: message.body })
                                }
                                onDelete={(message) => void removeMessage(message)}
                            />

                            <MessageComposer
                                disabled={active.archived}
                                sending={sending}
                                editing={editing}
                                onSend={send}
                                onCancelEdit={() => setEditing(null)}
                            />
                        </>
                    )}
                </section>
            </div>

            {showNew && (
                <NewConversationModal
                    onClose={() => setShowNew(false)}
                    onCreated={(id) => {
                        setShowNew(false);
                        void loadConversations();
                        openConversation(id);
                    }}
                />
            )}

            {showDetails && active && (
                <ConversationDetailsModal
                    conversation={active}
                    currentUserId={currentUserId}
                    onClose={() => setShowDetails(false)}
                    onChanged={() => {
                        if (activeId) void loadMessages(activeId, true);
                        void loadConversations();
                    }}
                    onLeft={() => {
                        setShowDetails(false);
                        backToList();
                        void loadConversations();
                    }}
                />
            )}
        </div>
    );
}
