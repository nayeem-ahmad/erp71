/** Shapes returned by `/admin/social-media`, shared by the page and its modals. */

export const SOCIAL_NETWORKS = [
    'facebook',
    'instagram',
    'linkedin',
    'x',
    'threads',
    'pinterest',
] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

/** Buffer's `mode` enum. Order here is the order the push modal offers them. */
export const BUFFER_MODES = ['addToQueue', 'now', 'next', 'customScheduled'] as const;
export type BufferMode = (typeof BUFFER_MODES)[number];

export type SocialPush = {
    id: string;
    channel_id: string;
    channel_name: string | null;
    channel_service: string | null;
    mode: string;
    due_at: string | null;
    status: 'SENT' | 'FAILED';
    external_post_id: string | null;
    error: string | null;
    created_at: string;
};

export type SocialPost = {
    id: string;
    status: 'DRAFT' | 'SCHEDULED' | 'PUBLISHED' | 'FAILED';
    title: string | null;
    content: string;
    link_url: string | null;
    image_url: string | null;
    networks: string[];
    scheduled_for: string | null;
    published_at: string | null;
    author_name: string | null;
    created_at: string;
    updated_at: string;
    pushes: SocialPush[];
    last_push_at: string | null;
};

export type BufferChannel = {
    id: string;
    name: string | null;
    service: string | null;
    avatar: string | null;
    isQueuePaused: boolean | null;
};

export function formatDateTime(value: string | null): string {
    if (!value) return '—';
    return new Date(value).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
