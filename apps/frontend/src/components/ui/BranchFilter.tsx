'use client';

import { useId } from 'react';
import { useI18n } from '@/lib/i18n';
import { ALL_BRANCHES, type UseBranchScope } from '@/lib/branch-scope';
import { Select } from './Select';

export type BranchFilterProps = {
    /** The page's `useBranchScope()` result. */
    scope: Pick<UseBranchScope, 'branches' | 'value' | 'setValue' | 'canSeeAll' | 'locked' | 'hidden' | 'ready'>;
    className?: string;
};

/**
 * The one branch filter every branch-aware page puts first in its
 * `PageHeader` actions. Behaviour lives in `useBranchScope`; this only draws
 * it: hidden in a one-branch shop, disabled on the member's only branch,
 * “All branches” first when the member may see the whole company.
 */
export function BranchFilter({ scope, className = '' }: BranchFilterProps) {
    const { t } = useI18n();
    const hintId = useId();
    const copy = t.dashboardLayout;

    if (!scope.ready || scope.hidden) return null;

    return (
        <>
            <Select
                value={scope.value}
                onChange={(event) => scope.setValue(event.target.value)}
                disabled={scope.locked}
                aria-label={copy.branchLabel}
                aria-describedby={scope.locked ? hintId : undefined}
                title={scope.locked ? copy.branchFilterLocked : undefined}
                className={`w-auto max-w-[14rem] ${className}`.trim()}
                data-testid="branch-filter"
            >
                {scope.canSeeAll ? <option value={ALL_BRANCHES}>{copy.branchFilterAll}</option> : null}
                {scope.branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                        {branch.name}
                    </option>
                ))}
            </Select>
            {scope.locked ? (
                <span id={hintId} className="sr-only">
                    {copy.branchFilterLocked}
                </span>
            ) : null}
        </>
    );
}

export default BranchFilter;
