import { PageSkeleton } from '@/components/ui/PageSkeleton';

/** The scorecard's outline: header with branch and period pickers, then KPI tiles. */
export default function ScorecardLoading() {
    return <PageSkeleton body="dashboard" actions={2} />;
}
