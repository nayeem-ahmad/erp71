/** A note as the list returns it: no body, a plain-text preview instead. */
export interface NoteSummary {
    id: string;
    title: string;
    pinned: boolean;
    preview: string;
    hasImages: boolean;
    created_at: string;
    updated_at: string;
}

/** A note opened for editing. `content` is markdown. */
export interface Note {
    id: string;
    title: string;
    content: string;
    pinned: boolean;
    created_at: string;
    updated_at: string;
}

export interface NoteInput {
    title?: string;
    content?: string;
    pinned?: boolean;
}
