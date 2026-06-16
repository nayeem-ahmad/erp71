import { useState, useEffect } from 'react';
import { format } from 'date-fns';

interface SalesHeaderProps {
    refNumber: string;
    setRefNumber: (value: string) => void;
    currentUser: any;
}

export default function SalesHeader({ refNumber, setRefNumber, currentUser }: SalesHeaderProps) {
    const [now, setNow] = useState<string>(format(new Date(), 'yyyy-MM-dd HH:mm'));

    useEffect(() => {
        setNow(format(new Date(), 'yyyy-MM-dd HH:mm'));
    }, []);

    return (
        <div className="bg-white rounded-lg border p-6 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Sales Number */}
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Sales Number</label>
                    <input
                        type="text"
                        placeholder="Auto-generated"
                        disabled
                        className="w-full px-3 py-2 border rounded bg-gray-50 text-sm text-gray-700"
                    />
                </div>

                {/* Reference Number */}
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Reference #</label>
                    <input
                        type="text"
                        value={refNumber}
                        onChange={(e) => setRefNumber(e.target.value)}
                        placeholder="Optional"
                        className="w-full px-3 py-2 border rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                </div>

                {/* User */}
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">User</label>
                    <input
                        type="text"
                        value={currentUser?.name || ''}
                        disabled
                        className="w-full px-3 py-2 border rounded bg-gray-50 text-sm text-gray-700"
                    />
                </div>

                {/* Date/Time */}
                <div>
                    <label className="block text-xs font-semibold text-gray-600 mb-1">Date/Time</label>
                    <input
                        type="datetime-local"
                        value={now}
                        disabled
                        className="w-full px-3 py-2 border rounded bg-gray-50 text-sm text-gray-700"
                    />
                </div>
            </div>
        </div>
    );
}
