import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** The customer list: segmentation, import and new-customer actions, the segment strip, the table. */
export default function CustomersLoading() {
    return <PageSkeleton actions={3} stats />;
}
