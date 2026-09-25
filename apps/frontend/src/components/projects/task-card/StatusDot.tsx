/** A column's category, as the dot beside its name. */
const STATUS_DOT: Record<string, string> = {
    TODO: 'bg-gray-400',
    IN_PROGRESS: 'bg-blue-600',
    DONE: 'bg-emerald-600',
};

/**
 * Where a task stands, as a colour: grey not started, blue under way, green
 * done. Drawn from the column's *category* rather than its name, because
 * columns are per project and named freely — every one of them still carries
 * one of the three categories.
 */
export default function StatusDot({ category }: { category?: string | null }) {
    return (
        <span
            aria-hidden
            className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[category ?? ''] ?? 'bg-gray-400'}`}
        />
    );
}
