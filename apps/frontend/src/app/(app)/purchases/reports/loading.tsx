import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Every purchase report: date filters, then the figures. */
export default function PurchaseReportsLoading() {
    return <PageSkeleton body="report" />;
}
