import { PageSkeleton } from '@/components/ui/PageSkeleton';

/*
 * Covers every page under /accounting without a `loading.tsx` of its own. The
 * boundary is per segment, so moving between two of those pages shows it too,
 * where the `(app)` one would leave the old page up for the whole round trip.
 * Most of them are registers (vouchers, journal, ledger), so a list's outline;
 * the reports have their own.
 */
export default function AccountingLoading() {
    return <PageSkeleton />;
}
