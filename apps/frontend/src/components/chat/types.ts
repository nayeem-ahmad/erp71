export interface ChatPerson {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    role: string;
    /**
     * When this person last opened the conversation. Only `GET /chat/conversations/:id`
     * fills it in, and never for the viewer's own row — it exists to answer
     * "has the other side seen this yet", not to describe yourself.
     */
    lastReadAt?: string | null;
}

export interface ChatConversation {
    id: string;
    kind: 'dm' | 'group';
    /** Already resolved per viewer by the API — a DM is titled by the other person. */
    title: string;
    archived: boolean;
    muted?: boolean;
    lastMessageAt: string | null;
    lastMessagePreview: string | null;
    unreadCount?: number;
    participants: ChatPerson[];
    createdAt?: string;
    createdBy?: string | null;
}

export interface ChatAttachment {
    id: string;
    url: string;
    name: string;
    mimeType: string;
    size: number | null;
}

export interface ChatMessage {
    id: string;
    conversationId: string;
    kind: 'text' | 'system';
    body: string;
    deleted: boolean;
    editedAt: string | null;
    createdAt: string;
    sender: { id: string; name: string | null; email: string; avatarUrl: string | null };
    attachments: ChatAttachment[];
}

export interface ChatMessagePage {
    messages: ChatMessage[];
    hasMore: boolean;
    nextCursor: string | null;
}

/** What the composer hands up once a picked file has been read. */
export interface PendingAttachment {
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    fileBase64: string;
    /** Object URL for the local thumbnail; revoked when the item is dropped. */
    previewUrl: string | null;
}

export const CHAT_ACCEPTED_MIME_TYPES = [
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
] as const;

export const MAX_CHAT_ATTACHMENTS = 5;
/** Mirrors the backend ceiling: ~7 MB of base64 ≈ a 5 MB file. */
export const MAX_CHAT_FILE_BYTES = 5 * 1024 * 1024;

/**
 * The newest message of mine the other side has already seen, or null.
 *
 * Read state is one cursor per participant rather than a row per message, so
 * seen-ness is always a contiguous prefix of the thread: marking the single
 * newest seen message is the whole truth, and a tick on every bubble would only
 * repeat it. DMs only for now — a group would have to say *who*, and one label
 * cannot.
 */
export function seenReceiptMessageId(
    messages: ChatMessage[],
    currentUserId: string | null,
    conversation: ChatConversation | null,
): string | null {
    if (!currentUserId || conversation?.kind !== 'dm') return null;

    const peer = conversation.participants.find((person) => person.id !== currentUserId);
    const cursor = peer?.lastReadAt ? Date.parse(peer.lastReadAt) : NaN;
    if (Number.isNaN(cursor)) return null;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index];
        if (message.kind !== 'text' || message.deleted) continue;
        if (message.sender.id !== currentUserId) continue;
        // Messages are oldest-first, so the first own message at or before the
        // cursor walking backwards is the newest one they have seen.
        if (Date.parse(message.createdAt) <= cursor) return message.id;
    }

    return null;
}

export function displayName(person: {
    name?: string | null;
    email?: string | null;
}): string {
    return person.name?.trim() || person.email || '';
}

/** Two-letter monogram for the avatar fallback. */
export function initialsFor(person: { name?: string | null; email?: string | null }): string {
    const source = displayName(person);
    const parts = source.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
