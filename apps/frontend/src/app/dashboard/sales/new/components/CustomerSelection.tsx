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

    return (
        <div className="bg-white rounded-lg border p-6 space-y-4">
            <h3 className="font-semibold text-gray-900">Customer</h3>

            <div className="relative">
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
                    <input
                        ref={inputRef}
                        type="text"
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setShowDropdown(true);
                        }}
                        onFocus={() => setShowDropdown(true)}
                        placeholder="Search by name or phone..."
                        disabled={!!customer}
                        className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
                    />
                </div>

                {/* Dropdown */}
                {showDropdown && !customer && (
                    <div
                        ref={dropdownRef}
                        className="absolute top-full left-0 right-0 mt-1 border rounded-lg bg-white shadow-lg z-50 max-h-64 overflow-y-auto"
                    >
                        {loading ? (
                            <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
                        ) : filteredCustomers.length === 0 ? (
                            <div className="p-4 text-center text-gray-500 text-sm">
                                {query ? 'No customers found' : 'Start typing to search'}
                            </div>
                        ) : (
                            filteredCustomers.map((cust) => (
                                <div
                                    key={cust.id}
                                    onClick={() => handleSelectCustomer(cust)}
                                    className="p-3 hover:bg-gray-50 cursor-pointer border-b last:border-b-0"
                                >
                                    <div className="font-medium text-gray-900">{cust.name}</div>
                                    <div className="text-xs text-gray-500">{cust.phone}</div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>

            {/* Selected Customer */}
            {customer && (
                <div className="border rounded-lg p-4 bg-gray-50 space-y-2">
                    <div className="flex justify-between items-start">
                        <div>
                            <div className="font-semibold text-gray-900">{customer.name}</div>
                            <div className="text-sm text-gray-600 mt-2 space-y-1">
                                <div>📱 {customer.phone}</div>
                                {customer.address && <div>📍 {customer.address}</div>}
                                {customer.credit_limit && (
                                    <div>💳 Credit Limit: ৳{customer.credit_limit}</div>
                                )}
                                {customer.loyalty_points && (
                                    <div>⭐ Points: {customer.loyalty_points}</div>
                                )}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleClearCustomer}
                            className="text-gray-500 hover:text-gray-700"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
