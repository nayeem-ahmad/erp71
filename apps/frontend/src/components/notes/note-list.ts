import type { Note, NoteSummary } from './types';

const PREVIEW_LENGTH = 160;

/**
 * A plain-text glimpse of a markdown body, the same way the API builds the
 * list's `preview` — so a note edited here reads the same in the list before
 * and after the next reload.
 */
export function notePreview(markdown: string): string {
    return markdown
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[`*_~#>]+/g, '')
        .replace(/^\s*(?:[-+]|\d+\.)\s+/gm, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, PREVIEW_LENGTH);
}

export function summarize(note: Note): NoteSummary {
    return {
        id: note.id,
        title: note.title,
        pinned: note.pinned,
        preview: notePreview(note.content),
        hasImages: /!\[[^\]]*\]\([^)]+\)/.test(note.content),
        created_at: note.created_at,
        updated_at: note.updated_at,
    };
}

/** Pinned first, then most recently edited — the order the API lists them in. */
export function sortNotes(notes: NoteSummary[]): NoteSummary[] {
    return [...notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
}

/** Put a saved note back into the list, in its new place. */
export function upsertNote(notes: NoteSummary[], note: Note): NoteSummary[] {
    const next = notes.filter((row) => row.id !== note.id);
    next.push(summarize(note));
    return sortNotes(next);
}
