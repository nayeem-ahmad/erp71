import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import PartySearchSelect, {
    PartySummaryLine,
    type PartyOption,
} from '@/components/document-entry/PartySearchSelect';

interface CustomerSelectionProps {
    customer: any;
    setCustomer: (customer: any) => void;
    readOnly?: boolean;
}

/** The sale's customer picker: the shared party typeahead plus credit context. */
export default function CustomerSelection({ customer, setCustomer, readOnly = false }: CustomerSelectionProps) {
    const [customers, setCustomers] = useState<PartyOption[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Nothing to pick from when the sale is only being viewed.
        if (readOnly) return;

        let cancelled = false;
        setLoading(true);
        api.getCustomers()
            .then((data: PartyOption[]) => { if (!cancelled) setCustomers(data ?? []); })
            .catch((error: unknown) => console.error('Failed to load customers', error))
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [readOnly]);

    return (
        <PartySearchSelect
            parties={customers}
            loading={loading}
            selected={customer}
            onSelect={setCustomer}
            readOnly={readOnly}
            readOnlyFallback="Walk-in customer"
            label="Customer"
            placeholder="Search by name or phone…"
            noMatchLabel="No customers found"
            clearLabel="Remove customer"
            summary={(cust) => (
                <PartySummaryLine
                    parts={[
                        <span key="name" className="font-medium text-gray-700">{cust.name}</span>,
                        cust.phone,
                        cust.address,
                        Number(cust.due_balance ?? 0) > 0
                            ? `Due ৳${Number(cust.due_balance).toLocaleString()}`
                            : null,
                        cust.credit_limit ? `Limit ৳${Number(cust.credit_limit).toLocaleString()}` : null,
                        cust.loyalty_points ? `${cust.loyalty_points} pts` : null,
                    ]}
                />
            )}
        />
    );
}
