'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    Package, ShoppingCart, CheckCircle2, ArrowRight, Plus, Zap, Store, Loader2,
    Stethoscope, ShoppingBag, Computer, Pill,
} from 'lucide-react';
import { api } from '../../../lib/api';
import { useI18n } from '@/lib/i18n';

type Step = 'store' | 'products' | 'pos' | 'done';

const STEP_ORDER: Step[] = ['store', 'products', 'pos', 'done'];

function markOnboardingComplete() {
    localStorage.setItem('onboarding_complete', '1');
}

function StepIndicator({ current, labels }: { current: Step; labels: Record<Step, string> }) {
    const idx = STEP_ORDER.indexOf(current);
    const icons: Record<Step, typeof Package> = {
        store: Store,
        products: Package,
        pos: ShoppingCart,
        done: CheckCircle2,
    };

    return (
        <div className="flex items-center gap-2 mb-10 overflow-x-auto pb-1">
            {STEP_ORDER.map((stepId, i) => {
                const done = i < idx;
                const active = i === idx;
                const Icon = icons[stepId];
                return (
                    <div key={stepId} className="flex items-center gap-2 flex-shrink-0">
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-colors ${
                            done ? 'bg-green-500 text-white' : active ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'
                        }`}>
                            {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                        </div>
                        <span className={`text-sm font-semibold hidden sm:block ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                            {labels[stepId]}
                        </span>
                        {i < STEP_ORDER.length - 1 && (
                            <div className={`w-8 h-0.5 mx-1 ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}

const BUSINESS_TYPES = [
    { value: 'SURGICAL_MEDICAL', label: 'Surgical / Medical', icon: Stethoscope, description: '1,173 products pre-loaded' },
    { value: 'PHARMACY', label: 'Pharmacy', icon: Pill, description: 'Coming soon' },
    { value: 'GROCERY', label: 'Grocery', icon: ShoppingBag, description: 'Coming soon' },
    { value: 'COMPUTER_HARDWARE', label: 'Computer Hardware', icon: Computer, description: 'Coming soon' },
] as const;

function StoreStep({
    existingStore,
    onNext,
}: {
    existingStore: { tenantName: string; storeName: string } | null;
    onNext: () => void;
}) {
    const { t } = useI18n();
    const copy = t.onboarding.store;
    const [form, setForm] = useState({ tenantName: '', storeName: '', address: '' });
    const [businessType, setBusinessType] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (existingStore) {
        return (
            <div className="text-center space-y-6 py-4">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                    <Store className="w-10 h-10 text-blue-600" />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-gray-900">{copy.confirmTitle}</h2>
                    <p className="text-gray-500 text-sm mt-2">{copy.confirmDescription}</p>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-2xl p-5 text-left space-y-2">
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400">{copy.tenantName}</p>
                    <p className="font-semibold text-gray-900">{existingStore.tenantName}</p>
                    <p className="text-xs font-bold uppercase tracking-widest text-gray-400 pt-2">{copy.storeName}</p>
                    <p className="font-semibold text-gray-900">{existingStore.storeName}</p>
                </div>
                <p className="text-sm text-gray-500">
                    <span className="font-semibold text-gray-800">{existingStore.storeName}</span> {copy.readyMessage}
                </p>
                <button
                    onClick={onNext}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    {copy.continue} <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        );
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!form.tenantName.trim() || !form.storeName.trim()) {
            setError(copy.nameRequired);
            return;
        }
        setLoading(true);
        try {
            const result = await api.setupTenant({
                tenantName: form.tenantName.trim(),
                name: form.storeName.trim(),
                address: form.address.trim() || undefined,
                planCode: 'FREE',
                businessType: businessType ?? undefined,
            });
            if (result?.tenant?.id) {
                localStorage.setItem('tenant_id', result.tenant.id);
            }
            if (result?.store?.id) {
                localStorage.setItem('store_id', result.store.id);
            }
            onNext();
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <h2 className="text-2xl font-black text-gray-900 mb-1">{copy.createTitle}</h2>
                <p className="text-gray-500 text-sm">{copy.createDescription}</p>
            </div>
            {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{copy.tenantName} *</label>
                <input
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={copy.tenantPlaceholder}
                    value={form.tenantName}
                    onChange={(e) => setForm({ ...form, tenantName: e.target.value })}
                />
            </div>
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{copy.storeName} *</label>
                <input
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={copy.storePlaceholder}
                    value={form.storeName}
                    onChange={(e) => setForm({ ...form, storeName: e.target.value })}
                />
            </div>
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{copy.address}</label>
                <input
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={copy.addressPlaceholder}
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
            </div>
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Business Type <span className="text-gray-400 font-normal">(optional — pre-loads products)</span></label>
                <div className="grid grid-cols-2 gap-2">
                    {BUSINESS_TYPES.map(({ value, label, icon: Icon, description }) => {
                        const isAvailable = value === 'SURGICAL_MEDICAL';
                        const isSelected = businessType === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                disabled={!isAvailable}
                                onClick={() => setBusinessType(isSelected ? null : value)}
                                className={`flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
                                    isSelected
                                        ? 'border-blue-500 bg-blue-50'
                                        : isAvailable
                                        ? 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                                        : 'border-gray-100 bg-gray-50 opacity-50 cursor-not-allowed'
                                }`}
                            >
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-blue-100' : 'bg-gray-100'}`}>
                                    <Icon className={`w-4 h-4 ${isSelected ? 'text-blue-600' : 'text-gray-500'}`} />
                                </div>
                                <div>
                                    <p className={`text-xs font-semibold ${isSelected ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
                                    <p className={`text-xs ${isSelected ? 'text-blue-500' : 'text-gray-400'}`}>{description}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
            <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl transition-colors"
            >
                {loading ? copy.saving : <><Store className="w-4 h-4" /> {copy.createStore}</>}
            </button>
        </form>
    );
}

function AddProductStep({ onNext }: { onNext: () => void }) {
    const { t } = useI18n();
    const copy = t.onboarding.products;
    const [form, setForm] = useState({ name: '', sku: '', price: '' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [done, setDone] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        if (!form.name || !form.price) {
            setError(copy.nameRequired);
            return;
        }
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
                    <h3 className="text-xl font-bold text-gray-900">{copy.successTitle}</h3>
                    <p className="text-gray-500 mt-1">
                        <span className="font-semibold">{form.name}</span> {copy.successDescription}
                    </p>
                </div>
                <button
                    onClick={onNext}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    {t.onboarding.store.continue} <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        );
    }

    return (
        <form onSubmit={handleSubmit} className="space-y-5">
            <div>
                <h2 className="text-2xl font-black text-gray-900 mb-1">{copy.title}</h2>
                <p className="text-gray-500 text-sm">{copy.description}</p>
            </div>
            {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
            <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">{copy.name} *</label>
                <input
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder={copy.namePlaceholder}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{copy.sku}</label>
                    <input
                        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        placeholder={copy.optional}
                        value={form.sku}
                        onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    />
                </div>
                <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">{copy.price} *</label>
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
                {loading ? copy.saving : <><Plus className="w-4 h-4" /> {copy.addProduct}</>}
            </button>
        </form>
    );
}

function PosStep({ onNext }: { onNext: () => void }) {
    const { t } = useI18n();
    const copy = t.onboarding.pos;
    const router = useRouter();
    const [checking, setChecking] = useState(false);
    const [saleDetected, setSaleDetected] = useState(false);

    const checkForSales = useCallback(async () => {
        setChecking(true);
        try {
            const sales = await api.getSales();
            if (Array.isArray(sales) && sales.length > 0) {
                setSaleDetected(true);
            }
        } catch {
            // Ignore polling errors; user can still self-report.
        } finally {
            setChecking(false);
        }
    }, []);

    useEffect(() => {
        void checkForSales();
        const interval = setInterval(() => {
            void checkForSales();
        }, 4000);

        const onFocus = () => {
            void checkForSales();
        };
        window.addEventListener('focus', onFocus);
        return () => {
            clearInterval(interval);
            window.removeEventListener('focus', onFocus);
        };
    }, [checkForSales]);

    if (saleDetected) {
        return (
            <div className="text-center space-y-6 py-6">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                    <CheckCircle2 className="w-10 h-10 text-green-600" />
                </div>
                <div>
                    <h2 className="text-2xl font-black text-gray-900">{copy.saleDetected}</h2>
                    <p className="text-gray-500 text-sm mt-2">{copy.saleDetectedDescription}</p>
                </div>
                <button
                    onClick={onNext}
                    className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    {t.onboarding.store.continue} <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-black text-gray-900 mb-1">{copy.title}</h2>
                <p className="text-gray-500 text-sm">{copy.description}</p>
            </div>
            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 flex items-start gap-4">
                <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
                    <Zap className="w-5 h-5 text-blue-600" />
                </div>
                <div className="text-sm text-blue-800">
                    <p className="font-semibold mb-1">{copy.tipTitle}</p>
                    <p>{copy.tipBody}</p>
                </div>
            </div>
            {checking && (
                <p className="text-xs text-gray-400 flex items-center gap-2 justify-center">
                    <Loader2 className="w-3 h-3 animate-spin" /> {copy.checkingSales}
                </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3">
                <button
                    onClick={() => router.push('/dashboard/pos')}
                    className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors"
                >
                    <ShoppingCart className="w-4 h-4" /> {copy.openPos}
                </button>
                <button
                    onClick={onNext}
                    className="flex-1 flex items-center justify-center gap-2 border border-gray-200 hover:bg-gray-50 text-gray-700 font-semibold py-3 rounded-xl transition-colors"
                >
                    {copy.madeSale} <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

function DoneStep() {
    const { t } = useI18n();
    const copy = t.onboarding.done;
    const router = useRouter();

    return (
        <div className="text-center space-y-6 py-4">
            <div className="text-6xl">🎉</div>
            <div>
                <h2 className="text-2xl font-black text-gray-900">{copy.title}</h2>
                <p className="text-gray-500 mt-2 max-w-sm mx-auto">{copy.description}</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <button
                    onClick={() => { markOnboardingComplete(); router.push('/dashboard'); }}
                    className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-8 rounded-xl transition-colors"
                >
                    {copy.goToDashboard} <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

export default function OnboardingPage() {
    const { t } = useI18n();
    const router = useRouter();
    const [step, setStep] = useState<Step | null>(null);
    const [existingStore, setExistingStore] = useState<{ tenantName: string; storeName: string } | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (localStorage.getItem('onboarding_complete') === '1') {
            router.replace('/dashboard');
            return;
        }

        api.getMe()
            .then((me) => {
                const tenantId = localStorage.getItem('tenant_id');
                const tenant = me?.tenants?.find((item: any) => item.id === tenantId) || me?.tenants?.[0];
                const store = tenant?.stores?.[0];
                if (tenant && store) {
                    setExistingStore({ tenantName: tenant.name, storeName: store.name });
                    if (!localStorage.getItem('tenant_id')) {
                        localStorage.setItem('tenant_id', tenant.id);
                    }
                    if (!localStorage.getItem('store_id')) {
                        localStorage.setItem('store_id', store.id);
                    }
                } else {
                    setExistingStore(null);
                }
                setStep((current) => current ?? 'store');
            })
            .catch(() => setStep((current) => current ?? 'store'))
            .finally(() => setLoading(false));
    }, [router]);

    const stepLabels = useMemo(() => ({
        store: t.onboarding.steps.store,
        products: t.onboarding.steps.products,
        pos: t.onboarding.steps.pos,
        done: t.onboarding.steps.done,
    }), [t]);

    const advance = () => {
        setStep((current) => {
            if (!current) return 'store';
            const idx = STEP_ORDER.indexOf(current);
            return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)];
        });
    };

    if (loading || step === null) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 flex items-start justify-center pt-16 px-4">
            <div className="w-full max-w-lg">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-black text-gray-900 tracking-tight">{t.onboarding.title}</h1>
                    <p className="text-gray-500 mt-1">{t.onboarding.subtitle}</p>
                </div>

                <StepIndicator current={step} labels={stepLabels} />

                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
                    {step === 'store' && <StoreStep existingStore={existingStore} onNext={advance} />}
                    {step === 'products' && <AddProductStep onNext={advance} />}
                    {step === 'pos' && <PosStep onNext={advance} />}
                    {step === 'done' && <DoneStep />}
                </div>

                {step !== 'done' && (
                    <div className="mt-4 text-center">
                        <button
                            onClick={() => { markOnboardingComplete(); router.push('/dashboard'); }}
                            className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                        >
                            {t.onboarding.skipSetup}
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}