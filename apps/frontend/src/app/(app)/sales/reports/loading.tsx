import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Every sales report: date filters, then the figures. */
export default function SalesReportsLoading() {
    return <PageSkeleton body="report" />;
}
