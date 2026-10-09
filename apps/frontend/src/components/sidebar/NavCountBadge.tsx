/**
 * Count pill on a nav link. Renders nothing at zero so links stay quiet.
 * Amber is work waiting on you (the approval queue); blue is something new to
 * read (team chat), and stays legible on the active link's blue fill.
 */
export default function NavCountBadge({ count, title, tone = 'amber' }: { count: number; title: string; tone?: 'amber' | 'blue' }) {
    if (count <= 0) return null;

    return (
        <span
            title={title}
            className={`ms-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                tone === 'blue' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-800'
            }`}
        >
            {count > 99 ? '99+' : count}
        </span>
    );
}
