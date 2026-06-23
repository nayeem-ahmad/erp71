import { useState, useEffect, useRef } from 'react';
import { api } from '../../../../../lib/api';
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

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (
                dropdownRef.current &&
                inputRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                !inputRef.current.contains(event.target as Node)
            ) {
                setShowDropdown(false);
            }
        }

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleSelectCustomer = (cust: any) => {
        setCustomer(cust);
        setQuery('');
        setShowDropdown(false);
    };

    const handleClearCustomer = () => {
        setCustomer(null);
        setQuery('');
    };

    // When a customer is selected, show a compact inline chip instead of the search box.
    if (customer) {
        return (
            <div className="flex items-center gap-2 min-w-0 rounded border bg-gray-50 px-2 py-1 text-sm">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Customer</span>
                <span className="font-medium text-gray-900 truncate">{customer.name}</span>
                <span className="text-gray-500 truncate">📱 {customer.phone}</span>
                {customer.credit_limit ? (
                    <span className="text-gray-500 whitespace-nowrap">💳 ৳{customer.credit_limit}</span>
                ) : null}
                {customer.loyalty_points ? (
                    <span className="text-gray-500 whitespace-nowrap">⭐ {customer.loyalty_points}</span>
                ) : null}
                <button
                    type="button"
                    onClick={handleClearCustomer}
                    className="ml-auto text-gray-400 hover:text-gray-700 flex-shrink-0"
                    title="Remove customer"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
        );
    }

    return (
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
                placeholder="Customer — search by name or phone…"
                className="w-full pl-8 pr-3 py-1.5 border rounded text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent"
            />

            {/* Dropdown */}
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
                                <div className="text-xs text-gray-500">{cust.phone}</div>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
