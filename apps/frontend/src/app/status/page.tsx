'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, AlertTriangle, RefreshCw } from 'lucide-react';

interface HealthData {
    status: string;
    db: string;
    uptime: number;
    latency_ms: number;
    timestamp: string;
}

interface ServiceTile {
    name: string;
    operational: boolean;
    detail: string;
}

function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
}

function StatusIcon({ operational }: { operational: boolean }) {
    return operational ? (
        <CheckCircle2 className="w-5 h-5 text-green-500" />
    ) : (
        <AlertTriangle className="w-5 h-5 text-red-500" />
    );
}

export default function StatusPage() {
    const [tiles, setTiles] = useState<ServiceTile[]>([]);
    const [allOperational, setAllOperational] = useState<boolean | null>(null);
    const [lastChecked, setLastChecked] = useState<Date | null>(null);
    const [loading, setLoading] = useState(true);

    async function fetchStatus() {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? '';
        const start = Date.now();
        let data: HealthData | null = null;
        let fetchOk = false;
        let latency = 0;

        try {
            const res = await fetch(`${apiUrl}/api/v1/health`, { cache: 'no-store' });
            latency = Date.now() - start;
            if (res.ok) {
                data = (await res.json()) as HealthData;
                fetchOk = true;
            }
        } catch {
            latency = Date.now() - start;
        }

        const apiOperational = fetchOk && data !== null;
        const dbOperational = apiOperational && data!.db === 'ok';
        const uptimeSeconds = apiOperational ? data!.uptime : 0;

        const newTiles: ServiceTile[] = [
            {
                name: 'API',
                operational: apiOperational,
                detail: apiOperational ? `${latency} ms latency` : 'Unreachable',
            },
            {
                name: 'Database',
                operational: dbOperational,
                detail: dbOperational ? 'Connected' : apiOperational ? 'Degraded' : 'Unknown',
            },
            {
                name: 'Uptime',
                operational: apiOperational,
                detail: apiOperational ? formatUptime(uptimeSeconds) : 'N/A',
            },
        ];

        setTiles(newTiles);
        setAllOperational(newTiles.every((t) => t.operational));
        setLastChecked(new Date());
        setLoading(false);
    }

    useEffect(() => {
        fetchStatus();
        const interval = setInterval(fetchStatus, 30_000);
        return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900 flex flex-col">

            {/* Nav */}
            <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="text-xl font-black tracking-tight text-blue-600">
                        RetailSaaS
                    </Link>
                    <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
                        <Link href="/#features" className="hover:text-gray-900 transition-colors">Features</Link>
                        <Link href="/pricing" className="hover:text-gray-900 transition-colors">Pricing</Link>
                        <Link href="/status" className="text-gray-900 font-semibold transition-colors">Status</Link>
                    </nav>
                    <div className="flex items-center gap-3">
                        <Link href="/login" className="text-sm font-semibold text-gray-700 hover:text-gray-900 px-4 py-2">
                            Sign in
                        </Link>
                        <Link
                            href="/signup"
                            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors"
                        >
                            Start free trial
                        </Link>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <main className="flex-1 pt-28 pb-16 px-6">
                <div className="max-w-3xl mx-auto space-y-8">

                    <div className="text-center space-y-2">
                        <h1 className="text-4xl font-black tracking-tight">System Status</h1>
                        <p className="text-gray-500">Real-time health of all RetailSaaS services</p>
                    </div>

                    {/* Overall banner */}
                    {loading ? (
                        <div className="flex items-center justify-center gap-3 py-5 rounded-2xl bg-gray-100 text-gray-500 font-semibold animate-pulse">
                            <RefreshCw className="w-5 h-5 animate-spin" />
                            Checking services…
                        </div>
                    ) : allOperational ? (
                        <div className="flex items-center justify-center gap-3 py-5 rounded-2xl bg-green-50 border border-green-200 text-green-700 font-bold text-lg">
                            <CheckCircle2 className="w-6 h-6" />
                            All Systems Operational
                        </div>
                    ) : (
                        <div className="flex items-center justify-center gap-3 py-5 rounded-2xl bg-yellow-50 border border-yellow-200 text-yellow-800 font-bold text-lg">
                            <AlertTriangle className="w-6 h-6" />
                            Service Degraded
                        </div>
                    )}

                    {/* Tile grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        {loading
                            ? Array.from({ length: 3 }).map((_, i) => (
                                <div
                                    key={i}
                                    className="p-6 rounded-2xl border border-gray-100 bg-gray-50 animate-pulse h-32"
                                />
                            ))
                            : tiles.map((tile) => (
                                <div
                                    key={tile.name}
                                    className={`p-6 rounded-2xl border ${
                                        tile.operational
                                            ? 'border-green-100 bg-green-50'
                                            : 'border-red-100 bg-red-50'
                                    }`}
                                >
                                    <div className="flex items-center justify-between mb-3">
                                        <span className="font-bold text-gray-800">{tile.name}</span>
                                        <StatusIcon operational={tile.operational} />
                                    </div>
                                    <div
                                        className={`text-sm font-semibold ${
                                            tile.operational ? 'text-green-700' : 'text-red-700'
                                        }`}
                                    >
                                        {tile.operational ? 'Operational' : 'Degraded'}
                                    </div>
                                    <div className="text-xs text-gray-500 mt-1">{tile.detail}</div>
                                </div>
                            ))}
                    </div>

                    {/* Last checked */}
                    {lastChecked && (
                        <p className="text-center text-sm text-gray-400">
                            Last checked:{' '}
                            <time dateTime={lastChecked.toISOString()}>
                                {lastChecked.toLocaleTimeString()}
                            </time>
                            {' '}· Auto-refreshes every 30 seconds
                        </p>
                    )}
                </div>
            </main>

            {/* Footer */}
            <footer className="py-10 px-6 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                    <span className="font-black text-lg text-blue-600">RetailSaaS</span>
                    <div className="flex items-center gap-6">
                        <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
                        <Link href="/status" className="hover:text-gray-700 transition-colors">Status</Link>
                        <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
                        <Link href="/signup" className="hover:text-gray-700 transition-colors">Sign up</Link>
                    </div>
                    <span>&copy; {new Date().getFullYear()} RetailSaaS. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
}
