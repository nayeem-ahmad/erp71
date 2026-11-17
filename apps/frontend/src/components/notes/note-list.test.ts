import { notePreview, sortNotes, summarize, upsertNote } from './note-list';
import type { NoteSummary } from './types';

const row = (id: string, pinned: boolean, updated: string): NoteSummary => ({
    id,
    title: id,
    pinned,
    preview: '',
    hasImages: false,
    created_at: updated,
    updated_at: updated,
});

describe('notePreview', () => {
    it('reads the markdown as plain text, without pictures or link targets', () => {
        expect(notePreview('- **Order** rice\n- call [Karim](https://x.y)\n\n![shelf](https://res.cloudinary.com/a.png)')).toBe(
            'Order rice call Karim',
        );
    });
});

describe('summarize', () => {
    it('flags a note that carries a picture', () => {
        const summary = summarize({
            id: 'n1',
            title: 'Shelf',
            content: 'Before\n\n![shelf](https://res.cloudinary.com/a.png)',
            pinned: false,
            created_at: '2026-11-01T00:00:00Z',
            updated_at: '2026-11-02T00:00:00Z',
        });
        expect(summary).toMatchObject({ id: 'n1', preview: 'Before', hasImages: true });
        expect(summary).not.toHaveProperty('content');
    });
});

describe('sortNotes / upsertNote', () => {
    it('keeps pinned notes first, then the most recently edited', () => {
        const sorted = sortNotes([
            row('old', false, '2026-11-01T00:00:00Z'),
            row('pinned-old', true, '2026-10-01T00:00:00Z'),
            row('new', false, '2026-11-10T00:00:00Z'),
        ]);
        expect(sorted.map((note) => note.id)).toEqual(['pinned-old', 'new', 'old']);
    });

    it('moves a just-saved note to the top of the unpinned ones, replacing its old row', () => {
        const list = [row('a', false, '2026-11-10T00:00:00Z'), row('b', false, '2026-11-01T00:00:00Z')];
        const next = upsertNote(list, {
            id: 'b',
            title: 'B edited',
            content: 'text',
            pinned: false,
            created_at: '2026-11-01T00:00:00Z',
            updated_at: '2026-11-17T00:00:00Z',
        });
        expect(next.map((note) => note.id)).toEqual(['b', 'a']);
        expect(next[0].title).toBe('B edited');
    });
});
