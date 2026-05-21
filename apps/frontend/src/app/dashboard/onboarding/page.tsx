'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Package, ShoppingCart, CheckCircle2, ArrowRight, ArrowLeft, Plus, Zap,
} from 'lucide-react';
import { api } from '../../../lib/api';

type Step = 'products' | 'pos' | 'done';

const STEPS: { id: Step; label: string; icon: typeof Package }[] = [
    { id: 'products', label: 'Add a product', icon: Package },
    { id: 'pos', label: 'Make a sale', icon: ShoppingCart },
    { id: 'done', label: 'All set!', icon: CheckCircle2 },
];

function StepIndicator({ current }: { current: Step }) {
    const idx = STEPS.findIndex((s) => s.id === current);
    return (
        <div className="flex items-center gap-2 mb-10">
            {STEPS.map((step, i) => {
                const done = i < idx;
                const active = i === idx;
                const Icon = step.icon;
                return (
                    <div key={step.id} className="flex items-center gap-2">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                            done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
                        }`}>
                            {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                        </div>
                        <span className={`text-sm font-semibold hidden sm:block ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                            {step.label}
                        </span>
                        {i < STEPS.length - 1 && (
                            <div className={`w-8 h-0.5 mx-1 ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function AddProductStep({ onNext }: { onNext: () => void }) {
    const [form, setForm] = useState({ name: '', sku: '', price: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!form.name || !form.price) { setError('Name and price are required.'); return; }
        setLoading(true);
        try {
            await api.createProduct({
                name: form.name,
                sku: form.sku || undefined,
                price: parseFloat(form.price),
            });
            setDone(true);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    if (done) {
        return (
            <div className="text-center space-y-6 py-8">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <div>
                    <h3 className="text-xl font-bold text-gray-900">Product added!</h3>
                    <p className="text-gray-500 mt-1">
                        <span className="font-semibold">{form.name}</span> is now in your catalog.
                    </p>
                </div>
                <button
                    onClick={onNext}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    Continue <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <h2 className="text-2xl font-black text-gray-900 mb-1">Add your first product</h2>
                <p className="text-gray-500 text-sm">You can add more products later from the Inventory section.</p>
            </div>
            {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Product name *</label>
                <input
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="e.g. Plain T-Shirt"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">SKU / barcode</label>
                    <input
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="Optional"
                        value={form.sku}
                        onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Price (BDT) *</label>
                    <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder="0.00"
                        value={form.price}
                        onChange={(e) => setForm({ ...form, price: e.target.value })}
                    />
                </div>
            </div>
            <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors"
            >
                {loading ? 'Saving…' : <><Plus className="w-4 h-4" /> Add product</>}
            </button>
        </form>
    );
}

function PosStep({ onNext }: { onNext: () => void }) {
    const router = useRouter();
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-black text-gray-900 mb-1">Open the Point of Sale</h2>
                <p className="text-gray-500 text-sm">
                    Select the product you just added, enter an amount, and record your first sale.
                    Come back here when you&apos;re done.
                </p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Zap className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">Quick tip</p>
                    <p>Use the search bar in the POS to find your product by name or scan its barcode.</p>
                </div>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
                <button
                    onClick={() => router.push('/dashboard/pos')}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors"
                >
                    <ShoppingCart className="w-4 h-4" /> Open POS
                </button>
                <button
                    onClick={onNext}
                    className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors"
                >
                    I&apos;ve made a sale <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

function DoneStep() {
    const router = useRouter();
    return (
        <div className="text-center space-y-6 py-4">
            <div className="text-6xl">🎉</div>
            <div>
                <h2 className="text-2xl font-black text-gray-900">You&apos;re all set!</h2>
                <p className="text-gray-500 mt-2 max-w-sm mx-auto">
                    Your store is live. Head to the dashboard to explore analytics, manage inventory, and more.
                </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                    onClick={() => { localStorage.setItem('onboarding_complete', '1'); router.push('/dashboard'); }}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    Go to dashboard <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export default function OnboardingPage() {
    const [step, setStep] = useState<Step>('products');

    const advance = () => {
        setStep((s) => {
            if (s === 'products') return 'pos';
            if (s === 'pos') return 'done';
            return 'done';
        });
    };

    return (
        <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
            <div className="w-full max-w-lg">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">Welcome to RetailSaaS</h1>
                    <p className="text-gray-500 mt-1">Let&apos;s get your store up and running in 3 quick steps.</p>
                </div>

                <StepIndicator current={step} />

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                    {step === 'products' && <AddProductStep onNext={advance} />}
                    {step === 'pos' && <PosStep onNext={advance} />}
                    {step === 'done' && <DoneStep />}
                </div>

                {step !== 'done' && (
                    <div className="mt-4 text-center">
                        <button
                            onClick={() => { localStorage.setItem('onboarding_complete', '1'); }}
                            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            Skip setup
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
