import { useState, useEffect } from 'react';

// Formats a Date as `yyyy-MM-dd HH:mm` in local time.
function formatNow(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
        `${pad(date.getHours())}:${pad(date.getMinutes())}`
    );
}

interface SalesHeaderProps {
    refNumber: string;
    setRefNumber: (value: string) => void;
    currentUser: any;
}

export default function SalesHeader({ refNumber, setRefNumber, currentUser }: SalesHeaderProps) {
    const [now, setNow] = useState<string>(formatNow(new Date()));

    useEffect(() => {
        setNow(formatNow(new Date()));
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
