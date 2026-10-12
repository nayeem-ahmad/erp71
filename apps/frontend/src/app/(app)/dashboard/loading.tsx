import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** The dashboard's outline: greeting header and range picker, KPI tiles, two panels. */
export default function DashboardLoading() {
    return <PageSkeleton body="dashboard" actions={1} />;
}
