import PageShell from './compact/PageShell';
import SkeletonStatus from './SkeletonStatus';
import { compactDensity } from '@/lib/ui/compact-density';

/*
 * No 'use client' and no hooks, deliberately: this is what every `loading.tsx`
 * renders, and those stay server components so a skeleton costs no JS beyond
 * `PageShell` (shared by every page already) and the one-line status label.
 * It still works inside a client component, for a page that wants the same
 * placeholder from its own loading state.
 *
 * A `loading.tsx` imports it from `@/components/ui/PageSkeleton`, never the
 * `@/components/ui` barrel: a server component that imports the barrel turns
 * every `'use client'` module the barrel re-exports into a client entry of
 * that route, which is the opposite of what a skeleton is for.
 */

/** What fills the page under the header — the shape of what the page will render. */
export type PageSkeletonBody = 'table' | 'dashboard' | 'report';

type SkeletonBarProps = {
    className?: string;
    /**
     * For a bar on the grey page canvas rather than inside a white card. The
     * canvas is `gray-100`, the same grey a bar uses inside a card, so a bar
     * straight on it needs a shade darker to show at all.
     */
    onCanvas?: boolean;
};

/** One pulsing grey block. Size and shape come from `className`. */
export function SkeletonBar({ className = '', onCanvas = false }: SkeletonBarProps) {
    return <div className={`animate-pulse rounded ${onCanvas ? 'bg-gray-200' : 'bg-gray-100'} ${className}`} />;
}

/** Widths for a column of text, varied so rows do not read as one grey slab. */
const LINE_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12', 'w-3/5', 'w-1/3', 'w-2/3', 'w-1/2'];

function lineWidth(index: number) {
    return LINE_WIDTHS[index % LINE_WIDTHS.length];
}

/**
 * `PageHeader`'s footprint: title and subtitle on the left, breadcrumb and
 * action buttons on the right. The bars sit in boxes of the real line heights
 * (`text-lg` title, `text-xs` subtitle) so the page does not jump when the
 * words replace them.
 */
function HeaderSkeleton({ actions }: { actions: number }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1">
                <div className="flex h-7 items-center">
                    <SkeletonBar onCanvas className="h-5 w-40 max-w-full" />
                </div>
                <div className="mt-0.5 flex h-4 items-center">
                    <SkeletonBar onCanvas className="h-3 w-64 max-w-full" />
                </div>
            </div>
            <div className="flex min-w-0 flex-col items-end gap-2">
                <SkeletonBar onCanvas className="h-3 w-32" />
                {actions > 0 ? (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {Array.from({ length: actions }, (_, index) => (
                            <SkeletonBar key={index} onCanvas className="h-8 w-20 rounded-lg" />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/** A KPI strip: label, figure, and the small line under it. */
function StatsSkeleton() {
    return (
        <div className="grid grid-cols-2 gap-2.5 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className={`${compactDensity.card} space-y-2`}>
                    <SkeletonBar className="h-3 w-20" />
                    <SkeletonBar className="h-6 w-24" />
                    <SkeletonBar className="h-2.5 w-16" />
                </div>
            ))}
        </div>
    );
}

/**
 * `DataTable`'s footprint: search toolbar, header row, rows, pagination. The
 * last two columns are hidden below `md`, as list pages hide secondary
 * columns, so the placeholder never scrolls sideways at 360px.
 */
function TableSkeleton({ rows }: { rows: number }) {
    const cells = (index: number, header: boolean) =>
        Array.from({ length: 5 }, (_, column) => (
            <div key={column} className={column >= 3 ? 'hidden md:block' : undefined}>
                <SkeletonBar className={`h-3 ${header ? 'w-16 max-w-full' : lineWidth(index + column)}`} />
            </div>
        ));

    return (
        <div className={`${compactDensity.cardSurface} overflow-hidden`}>
            <div className="flex items-center gap-2 border-b border-gray-100 p-2">
                <SkeletonBar className="h-8 w-full max-w-xs rounded-lg" />
                <SkeletonBar className="ms-auto h-7 w-16 shrink-0 rounded-lg" />
                <SkeletonBar className="hidden h-7 w-16 shrink-0 rounded-lg sm:block" />
            </div>
            <div className="grid grid-cols-3 gap-3 border-b border-gray-200 bg-gray-50/80 px-2 py-2 md:grid-cols-5">
                {cells(0, true)}
            </div>
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className="grid grid-cols-3 gap-3 border-b border-gray-50 px-2 py-2.5 md:grid-cols-5">
                    {cells(index, false)}
                </div>
            ))}
            <div className="flex items-center justify-between gap-2 px-3 py-2">
                <SkeletonBar className="h-3 w-24" />
                <SkeletonBar className="h-6 w-32 rounded-lg" />
            </div>
        </div>
    );
}

/** A module dashboard: KPI tiles, then two chart/list panels. */
function DashboardSkeleton() {
    return (
        <>
            <StatsSkeleton />
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {Array.from({ length: 2 }, (_, index) => (
                    <div key={index} className={`${compactDensity.card} space-y-3`}>
                        <SkeletonBar className="h-3 w-28" />
                        <SkeletonBar className="h-36 w-full rounded-md" />
                    </div>
                ))}
            </div>
        </>
    );
}

/** A financial or sales report: the filter bar, then a statement of label/amount lines. */
function ReportSkeleton({ rows }: { rows: number }) {
    return (
        <>
            <div className={compactDensity.filterBar}>
                {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="space-y-1">
                        <SkeletonBar className="h-3 w-16" />
                        <SkeletonBar className="h-8 w-36 rounded-lg" />
                    </div>
                ))}
                <SkeletonBar className="h-8 w-20 rounded-lg" />
            </div>
            <div className={`${compactDensity.card} space-y-3`}>
                <SkeletonBar className="h-4 w-48 max-w-full" />
                {Array.from({ length: rows }, (_, index) => (
                    <div key={index} className="flex items-center justify-between gap-4">
                        <SkeletonBar className={`h-3 ${lineWidth(index)}`} />
                        <SkeletonBar className="h-3 w-20 shrink-0" />
                    </div>
                ))}
            </div>
        </>
    );
}

type PageSkeletonProps = {
    body?: PageSkeletonBody;
    /**
     * Header action buttons to leave room for. Defaults to two on a table page
     * ("Import", "New …") and none elsewhere.
     */
    actions?: number;
    /** A KPI strip between header and table, as the customers list has. */
    stats?: boolean;
    /** Rows in the table or statement placeholder. */
    rows?: number;
    maxWidth?: 'full' | 'wide' | 'narrow';
};

/**
 * The placeholder for a whole `(app)` page while its route loads — what a
 * segment's `loading.tsx` renders, so a click in the sidebar paints the next
 * page's outline in the same frame instead of leaving the old page up for a
 * round trip. Same `PageShell` and header footprint as the real page, so the
 * content lands where its outline was.
 */
export function PageSkeleton({
    body = 'table',
    actions = body === 'table' ? 2 : 0,
    stats = false,
    rows = 8,
    maxWidth = 'full',
}: PageSkeletonProps) {
    return (
        <PageShell maxWidth={maxWidth}>
            <div aria-hidden data-testid="page-skeleton" data-body={body} className="space-y-4">
                <HeaderSkeleton actions={actions} />
                {body === 'dashboard' ? <DashboardSkeleton /> : null}
                {body === 'table' ? (
                    <>
                        {stats ? <StatsSkeleton /> : null}
                        <TableSkeleton rows={rows} />
                    </>
                ) : null}
                {body === 'report' ? <ReportSkeleton rows={rows} /> : null}
            </div>
            <SkeletonStatus />
        </PageShell>
    );
}
