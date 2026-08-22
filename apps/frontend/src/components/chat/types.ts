export interface ChatPerson {
    id: string;
    name: string | null;
    email: string;
    avatarUrl: string | null;
    role: string;
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
