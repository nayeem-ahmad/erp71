'use client';

import { Checkbox } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/**
 * The master data "Clear all data" can delete, as the backend names it
 * (`TENANT_DATA_GROUPS` / `BRANCH_DATA_GROUPS` in
 * apps/backend/src/tenants/clear-tenant-data.ts). A branch has no products of
 * its own — they are shared by every branch.
 */
const TENANT_GROUPS = ['products', 'stock', 'customers', 'suppliers', 'employees', 'projects', 'finance', 'other'] as const;
const BRANCH_GROUPS = ['customers', 'suppliers', 'stock'] as const;

export type DataGroup = (typeof TENANT_GROUPS)[number];
export type DataScope = 'tenant' | 'branch';

const groupsOf = (scope: DataScope): readonly DataGroup[] => (scope === 'branch' ? BRANCH_GROUPS : TENANT_GROUPS);

/** Everything ticked: what "Clear all data" deleted before it offered a choice. */
export function allGroups(scope: DataScope): Set<DataGroup> {
    return new Set(groupsOf(scope));
}

/** The `keep` list to send: the scope's groups left unticked. Stock goes with the products whatever its box says. */
export function keptGroups(scope: DataScope, deleting: ReadonlySet<DataGroup>): DataGroup[] {
    return groupsOf(scope).filter((g) => !deleting.has(g) && !(g === 'stock' && deleting.has('products')));
}

type Props = {
    scope: DataScope;
    /** The groups ticked for deletion. */
    deleting: ReadonlySet<DataGroup>;
    onChange: (next: Set<DataGroup>) => void;
    disabled?: boolean;
};

/** "Also delete" checklist for the Clear all data confirm, on Settings › Data and the admin Danger zone. */
export default function ClearDataGroups({ scope, deleting, onChange, disabled }: Props) {
    const { t } = useI18n();
    const g = t.settingsExtras.dataManagement.clearData.groups;
    const branch = scope === 'branch';

    const label: Record<DataGroup, string> = {
        products: g.productsLabel,
        stock: g.stockLabel,
        customers: g.customersLabel,
        suppliers: g.suppliersLabel,
        employees: g.employeesLabel,
        projects: g.projectsLabel,
        finance: g.financeLabel,
        other: g.otherLabel,
    };
    const hint: Record<DataGroup, string> = {
        products: g.productsHint,
        stock: branch ? g.stockBranchHint : g.stockHint,
        customers: branch ? g.customersBranchHint : g.customersHint,
        suppliers: branch ? g.suppliersBranchHint : g.suppliersHint,
        employees: g.employeesHint,
        projects: g.projectsHint,
        finance: g.financeHint,
        other: g.otherHint,
    };

    const toggle = (group: DataGroup) => {
        const next = new Set(deleting);
        if (next.has(group)) next.delete(group);
        else next.add(group);
        onChange(next);
    };

    return (
        <fieldset className="space-y-2" disabled={disabled}>
            <legend className="text-xs font-semibold text-gray-700">{g.heading}</legend>
            <p className="text-xs text-gray-500">{g.intro}</p>
            <div className="space-y-0.5">
                {groupsOf(scope).map((group) => {
                    // Deleting a product cascades its stock, so the box cannot say otherwise.
                    const forced = group === 'stock' && deleting.has('products');
                    const id = `clear-data-group-${group}`;
                    return (
                        <label
                            key={group}
                            htmlFor={id}
                            className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-gray-50"
                        >
                            <Checkbox
                                id={id}
                                checked={forced || deleting.has(group)}
                                disabled={forced}
                                onChange={() => toggle(group)}
                                className="mt-0.5 shrink-0"
                            />
                            <span className="min-w-0">
                                <span className="block text-sm text-gray-900">{label[group]}</span>
                                <span className="block text-xs text-gray-500">{forced ? g.stockWithProducts : hint[group]}</span>
                            </span>
                        </label>
                    );
                })}
            </div>
            {branch && <p className="text-xs text-gray-500">{g.branchNote}</p>}
        </fieldset>
    );
}
