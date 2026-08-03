import {
    actorName,
    describeActivity,
    mergeFeed,
    type TaskActivity,
    type TaskComment,
} from './task-activity';

const strings = {
    none: '—',
    CREATED: 'created this task',
    RENAMED: 'renamed it from “{from}” to “{to}”',
    STATUS_CHANGED: 'moved it from {from} to {to}',
    ASSIGNED: 'assigned it to {to}',
    UNASSIGNED: 'removed the assignee',
    PRIORITY_CHANGED: 'changed priority from {from} to {to}',
    DATES_CHANGED: 'changed the dates',
    LABELS_CHANGED: 'changed the labels ({count} now)',
    RE_ESTIMATED: 're-estimated from {from}h to {to}h',
};

const comment = (id: string, at: string): TaskComment => ({
    id,
    body: `body ${id}`,
    created_at: at,
});

const activity = (id: string, at: string, type = 'CREATED'): TaskActivity => ({
    id,
    type,
    created_at: at,
});

describe('mergeFeed', () => {
    // Two tables with no shared ordering column — the timeline only reads as a
    // timeline if the merge sorts across both.
    it('interleaves comments and activity, newest first', () => {
        const merged = mergeFeed(
            [comment('c1', '2026-08-03T10:00:00Z'), comment('c2', '2026-08-03T12:00:00Z')],
            [
                activity('a1', '2026-08-03T11:00:00Z'),
                activity('a2', '2026-08-03T09:00:00Z'),
            ],
        );

        expect(merged.map((e) => e.id)).toEqual(['c2', 'a1', 'c1', 'a2']);
    });

    it('tags each entry with which stream it came from', () => {
        const merged = mergeFeed([comment('c1', '2026-08-03T10:00:00Z')], [activity('a1', '2026-08-03T09:00:00Z')]);
        expect(merged.map((e) => e.kind)).toEqual(['comment', 'activity']);
    });

    it('copes with either stream being empty', () => {
        expect(mergeFeed([], [])).toEqual([]);
        expect(mergeFeed([comment('c1', '2026-08-03T10:00:00Z')], [])).toHaveLength(1);
        expect(mergeFeed([], [activity('a1', '2026-08-03T10:00:00Z')])).toHaveLength(1);
    });
});

describe('actorName', () => {
    it('prefers the name', () => {
        expect(actorName({ id: 'u1', name: 'Karim', email: 'k@x.com' })).toBe('Karim');
    });

    it('falls back to the email', () => {
        expect(actorName({ id: 'u1', email: 'k@x.com' })).toBe('k@x.com');
    });

    it('is null for a deleted or missing actor', () => {
        expect(actorName(null)).toBeNull();
    });
});

describe('describeActivity', () => {
    const describe_ = (type: string, data?: Record<string, unknown>) =>
        describeActivity({ id: 'a1', type, data, created_at: '2026-08-03T10:00:00Z' }, strings);

    it('describes a creation', () => {
        expect(describe_('CREATED')).toBe('created this task');
    });

    it('fills both sides of a rename', () => {
        expect(describe_('RENAMED', { from: 'Old', to: 'New' })).toBe(
            'renamed it from “Old” to “New”',
        );
    });

    it('fills both sides of a status change', () => {
        expect(describe_('STATUS_CHANGED', { from: 'To do', to: 'Doing' })).toBe(
            'moved it from To do to Doing',
        );
    });

    // "Unassigned" and "assigned to X" are different sentences, not one sentence
    // with a blank in it.
    it('uses a different sentence when the assignee is removed', () => {
        expect(describe_('ASSIGNED', { to: 'Karim' })).toBe('assigned it to Karim');
        expect(describe_('ASSIGNED', { to: null })).toBe('removed the assignee');
    });

    it('substitutes a dash where a value is missing rather than printing undefined', () => {
        expect(describe_('STATUS_CHANGED', { to: 'Doing' })).toBe('moved it from — to Doing');
    });

    it('counts labels', () => {
        expect(describe_('LABELS_CHANGED', { count: 2 })).toBe('changed the labels (2 now)');
    });

    it('shows zero labels as zero, not as a dash', () => {
        expect(describe_('LABELS_CHANGED', { count: 0 })).toBe('changed the labels (0 now)');
    });

    it('describes a re-estimate', () => {
        expect(describe_('RE_ESTIMATED', { from: 8, to: 5 })).toBe('re-estimated from 8h to 5h');
    });

    it('handles a re-estimate that had no previous value', () => {
        expect(describe_('RE_ESTIMATED', { from: null, to: 5 })).toBe(
            're-estimated from —h to 5h',
        );
    });

    it('copes with a row that has no data at all', () => {
        expect(describe_('DATES_CHANGED')).toBe('changed the dates');
    });

    // A newer server sending a type this client does not know must not render a
    // blank line.
    it('falls back to the raw type it does not recognise', () => {
        expect(describe_('ARCHIVED')).toBe('ARCHIVED');
    });
});
