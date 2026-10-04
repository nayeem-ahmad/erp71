import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** Every stock report: filters, then the figures. */
export default function InventoryReportsLoading() {
    return <PageSkeleton body="report" />;
}
