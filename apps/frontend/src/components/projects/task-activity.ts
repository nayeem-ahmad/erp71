/**
 * Merging the comment and activity streams, and turning an activity row into a
 * sentence.
 *
 * The server stores a before/after payload rather than rendered text, so the
 * sentence is composed here and therefore translates. Kept out of the component
 * so the merge order and the payload handling can be tested directly.
 */

export interface ActivityActor {
    id: string;
    name?: string | null;
    email: string;
}

export interface TaskComment {
    id: string;
    body: string;
    created_at: string;
    updated_at?: string;
    user?: ActivityActor | null;
}

export interface TaskActivity {
    id: string;
    type: string;
    data?: Record<string, unknown> | null;
    created_at: string;
    actor?: ActivityActor | null;
}

export type FeedEntry =
    | ({ kind: 'comment' } & TaskComment)
    | ({ kind: 'activity' } & TaskActivity);

export function actorName(actor?: ActivityActor | null): string | null {
    return actor?.name ?? actor?.email ?? null;
}

/**
 * Newest first. Comments and activity are two tables with no shared ordering
 * column, so the merge happens here rather than in a query.
 */
export function mergeFeed(comments: TaskComment[], activity: TaskActivity[]): FeedEntry[] {
    const entries: FeedEntry[] = [
        ...comments.map((comment) => ({ kind: 'comment' as const, ...comment })),
        ...activity.map((row) => ({ kind: 'activity' as const, ...row })),
    ];
    return entries.sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
}

type ActivityStrings = Record<string, string>;

const asText = (value: unknown, fallback: string): string =>
    value === null || value === undefined || value === '' ? fallback : String(value);

/**
 * `strings` is the i18n bundle for `projects.activity`; every branch reads from
 * it rather than building English inline.
 */
export function describeActivity(entry: TaskActivity, strings: ActivityStrings): string {
    const data = (entry.data ?? {}) as Record<string, unknown>;
    const none = strings.none ?? '—';

    switch (entry.type) {
        case 'CREATED':
            return strings.CREATED ?? entry.type;
        case 'RENAMED':
            return (strings.RENAMED ?? '')
                .replace('{from}', asText(data.from, none))
                .replace('{to}', asText(data.to, none));
        case 'STATUS_CHANGED':
            return (strings.STATUS_CHANGED ?? '')
                .replace('{from}', asText(data.from, none))
                .replace('{to}', asText(data.to, none));
        case 'ASSIGNED':
            // "Unassigned" and "assigned to X" are different sentences, not one
            // sentence with a blank in it.
            return data.to == null
                ? (strings.UNASSIGNED ?? '')
                : (strings.ASSIGNED ?? '').replace('{to}', String(data.to));
        case 'PRIORITY_CHANGED':
            return (strings.PRIORITY_CHANGED ?? '')
                .replace('{from}', asText(data.from, none))
                .replace('{to}', asText(data.to, none));
        case 'DATES_CHANGED':
            return strings.DATES_CHANGED ?? entry.type;
        case 'LABELS_CHANGED':
            return (strings.LABELS_CHANGED ?? '').replace('{count}', asText(data.count, '0'));
        case 'RE_ESTIMATED':
            return (strings.RE_ESTIMATED ?? '')
                .replace('{from}', asText(data.from, none))
                .replace('{to}', asText(data.to, none));
        default:
            // A type this client does not know about — a newer server, say —
            // shows as itself rather than as an empty line.
            return entry.type;
    }
}
