import { PageSkeleton } from '@/components/ui/PageSkeleton';

/*
 * Covers every page under /inventory without a `loading.tsx` of its own. The
 * boundary is per segment, so moving between two of those pages shows it too,
 * where the `(app)` one would leave the old page up for the whole round trip.
 * Most of them are lists, so a list's outline — the module hub included.
 */
export default function InventoryLoading() {
    return <PageSkeleton />;
}
