import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '@/lib/api';
import { useDismissOnClickOutside } from '@/lib/click-outside';
import { X, Search } from 'lucide-react';

interface CustomerSelectionProps {
    customer: any;
    setCustomer: (customer: any) => void;
}

export default function CustomerSelection({ customer, setCustomer }: CustomerSelectionProps) {
    const [query, setQuery] = useState('');
    const [customers, setCustomers] = useState<any[]>([]);
    const [filteredCustomers, setFilteredCustomers] = useState<any[]>([]);
    const [showDropdown, setShowDropdown] = useState(false);
    const [loading, setLoading] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        loadCustomers();
    }, []);

    const loadCustomers = async () => {
        try {
            setLoading(true);
            const data = await api.getCustomers();
            setCustomers(data);
        } catch (error) {
            console.error('Failed to load customers', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const filtered = customers.filter((c) =>
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.phone.includes(query)
        );
        setFilteredCustomers(filtered);
    }, [query, customers]);

    const isInside = useCallback(
        (target: Node) =>
            !!(
                dropdownRef.current?.contains(target)
                || inputRef.current?.contains(target)
            ),
        [],
    );
    useDismissOnClickOutside(showDropdown, isInside, () => setShowDropdown(false));

    const handleSelectCustomer = (cust: any) => {
        setCustomer(cust);
        setQuery('');
        setShowDropdown(false);
    };

    const handleClearCustomer = () => {
        setCustomer(null);
        setQuery('');
    };

    return (
        <div className="flex flex-col gap-1">
            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setShowDropdown(true);
                    }}
                    onFocus={() => setShowDropdown(true)}
                    placeholder={customer ? customer.name : 'Customer — search by name or phone…'}
                    className="w-full pl-8 pr-8 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent"
                />
                {customer && (
                    <button
                        type="button"
                        onClick={handleClearCustomer}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"
                        title="Remove customer"
                    >
                        <X className="w-4 h-4" />
                    </button>
                )}

                {showDropdown && (
                    <div
                        ref={dropdownRef}
                        className="absolute top-full left-0 right-0 mt-1 border rounded bg-white shadow-lg z-50 max-h-64 overflow-y-auto"
                    >
                        {loading ? (
                            <div className="p-3 text-center text-gray-500 text-sm">Loading...</div>
                        ) : filteredCustomers.length === 0 ? (
                            <div className="p-3 text-center text-gray-500 text-sm">
                                {query ? 'No customers found' : 'Start typing to search'}
                            </div>
                        ) : (
                            filteredCustomers.map((cust) => (
                                <div
                                    key={cust.id}
                                    onClick={() => handleSelectCustomer(cust)}
                                    className="px-3 py-2 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                                >
                                    <div className="font-medium text-gray-900 text-sm">{cust.name}</div>
                                    <div className="text-xs text-gray-500">
                                        {cust.phone}
                                        {cust.address ? ` · ${cust.address}` : ''}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {customer && (
                <div className="px-1 text-[11px] text-gray-500 leading-snug">
                    <span className="font-medium text-gray-700">{customer.name}</span>
                    {customer.phone && <span className="mx-1.5 text-gray-300">·</span>}
                    {customer.phone && <span>{customer.phone}</span>}
                    {customer.address ? (
                        <>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>{customer.address}</span>
                        </>
                    ) : null}
                    {customer.due_balance != null && Number(customer.due_balance) > 0 ? (
                        <>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>Due ৳{Number(customer.due_balance).toLocaleString()}</span>
                        </>
                    ) : null}
                    {customer.credit_limit ? (
                        <>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>Limit ৳{Number(customer.credit_limit).toLocaleString()}</span>
                        </>
                    ) : null}
                    {customer.loyalty_points ? (
                        <>
                            <span className="mx-1.5 text-gray-300">·</span>
                            <span>{customer.loyalty_points} pts</span>
                        </>
                    ) : null}
                </div>
            )}
        </div>
    );
}
