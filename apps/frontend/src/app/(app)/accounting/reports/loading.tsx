import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Every financial statement: period filters, then label/amount lines. */
export default function AccountingReportsLoading() {
    return <PageSkeleton body="report" rows={12} />;
}
