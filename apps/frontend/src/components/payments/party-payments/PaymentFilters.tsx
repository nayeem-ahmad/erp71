'use client';

import { CreatedRangeFilter } from '@/components/data-table';
import { IdSearchSelect } from '@/components/document-entry/PartySearchSelect';
import { Select } from '@/components/ui';
import type { CreatedRange } from '@/lib/created-range';
import type { MessageDictionary } from '@/lib/localization/messages';
import type { PaymentMethodOption } from './usePaymentMethods';
import type { MoneyFlow, PartyOption, PartyPaymentsLabels } from './types';

/** Filters on the method column: a method's name, or payments saved without one. */
export const NO_METHOD_FILTER = '__none__';

export interface PaymentFilterState {
    range: CreatedRange | null;
    partyId: string;
    flow: MoneyFlow | 'all';
    method: string;
}

interface PaymentFiltersProps {
    value: PaymentFilterState;
    onChange: (next: PaymentFilterState) => void;
    parties: PartyOption[];
    partiesLoading: boolean;
    methods: PaymentMethodOption[];
    labels: PartyPaymentsLabels;
    ui: MessageDictionary['partyPayments'];
}

/**
 * The list's filters in one row: when (server), which way and by what
 * (client-side over the loaded period), and who (server).
 */
export function PaymentFilters({ value, onChange, parties, partiesLoading, methods, labels, ui }: PaymentFiltersProps) {
    const set = (patch: Partial<PaymentFilterState>) => onChange({ ...value, ...patch });
    const flows: { key: PaymentFilterState['flow']; label: string }[] = [
        { key: 'all', label: ui.directionAll },
        { key: 'receive', label: ui.directionIn },
        { key: 'pay', label: ui.directionOut },
    ];

    return (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-3">
            <div>
                <CreatedRangeFilter value={value.range} onChange={(range) => set({ range })} label={labels.columns.dateTime} />
            </div>
            <div>
                <p className="mb-1 text-xs font-medium text-gray-600">{labels.direction}</p>
                <div role="radiogroup" aria-label={labels.direction} className="inline-flex overflow-hidden rounded-md border border-gray-200">
                    {flows.map((flow) => {
                        const on = value.flow === flow.key;
                        return (
                            <button
                                key={flow.key}
                                type="button"
                                role="radio"
                                aria-checked={on}
                                onClick={() => set({ flow: flow.key })}
                                className={`border-e border-gray-200 px-3 py-1.5 text-xs font-medium last:border-e-0 max-md:min-h-touch ${
                                    on ? 'bg-blue-50 text-blue-700' : 'bg-white text-gray-600 hover:bg-gray-50'
                                }`}
                            >
                                {flow.label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {methods.length > 0 ? (
                <div className="min-w-[140px]">
                    <label htmlFor="payment-method-filter" className="mb-1 block text-xs font-medium text-gray-600">{ui.method}</label>
                    <Select
                        id="payment-method-filter"
                        value={value.method}
                        onChange={(e) => set({ method: e.target.value })}
                        className="w-full"
                    >
                        <option value="">{ui.allMethods}</option>
                        {methods.map((method) => (
                            <option key={method.id} value={method.name}>{method.name}</option>
                        ))}
                        <option value={NO_METHOD_FILTER}>{ui.methodNotRecorded}</option>
                    </Select>
                </div>
            ) : null}
            <div className="min-w-[200px] flex-1 md:max-w-xs">
                <IdSearchSelect
                    id="payment-party-filter"
                    items={parties}
                    value={value.partyId}
                    onChange={(partyId) => set({ partyId })}
                    loading={partiesLoading}
                    label={labels.filterParty}
                    placeholder={labels.allParties}
                    emptyLabel={labels.noParties}
                    noMatchLabel={labels.noParties}
                />
            </div>
        </div>
    );
}
