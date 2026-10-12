import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** The product catalogue: import, export and new-product actions over the table. */
export default function ProductsLoading() {
    return <PageSkeleton actions={3} rows={10} />;
}
