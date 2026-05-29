'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Minus, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';

// ─── Plan definitions ────────────────────────────────────────────────────────

const PLANS = [
    {
        id: 'free',
        name: 'FREE',
        monthlyPrice: 0,
        yearlyPrice: 0,
        highlight: false,
        tagline: 'Try it out, no strings attached',
        limits: {
            users: '1 user',
            stores: '1 store',
            products: '100 products',
        },
        features: [
            'Basic POS terminal',
            '1 user account',
            '1 store location',
            'Up to 100 products',
            'Community support',
        ],
    },
    {
        id: 'basic',
        name: 'BASIC',
        monthlyPrice: 1499,
        yearlyPrice: 1249,
        highlight: false,
        tagline: 'For small shops just getting started',
        limits: {
            users: '3 users',
            stores: '1 store',
            products: 'Unlimited',
        },
        features: [
            'Full POS terminal',
            'Inventory management',
            'Purchase orders',
            '3 user accounts',
            '1 store location',
            'Unlimited products',
            'Email support',
        ],
    },
    {
        id: 'standard',
        name: 'STANDARD',
        monthlyPrice: 2999,
        yearlyPrice: 2499,
        highlight: true,
        tagline: 'For growing businesses with multiple locations',
        limits: {
            users: '10 users',
            stores: '3 stores',
            products: 'Unlimited',
        },
        features: [
            'Everything in BASIC',
            'Accounting module',
            'Financial reports',
            'Sales orders',
            'Customer management',
            'Supplier management',
            'E-commerce storefront',
            '3 store locations',
            '10 user accounts',
            'Priority email support',
        ],
    },
    {
        id: 'premium',
        name: 'PREMIUM',
        monthlyPrice: 4999,
        yearlyPrice: 4166,
        highlight: false,
        tagline: 'For enterprise retailers with no limits',
        limits: {
            users: 'Unlimited',
            stores: 'Unlimited',
            products: 'Unlimited',
        },
        features: [
            'Everything in STANDARD',
            'Manufacturing / BOM',
            'White-label branding',
            'Public API access',
            'Unlimited stores',
            'Unlimited user accounts',
            'Dedicated account manager',
            'Priority phone & chat support',
        ],
    },
];

// ─── Feature comparison table ─────────────────────────────────────────────────

type CellValue = string | boolean;

interface ComparisonRow {
    feature: string;
    free: CellValue;
    basic: CellValue;
    standard: CellValue;
    premium: CellValue;
}

const COMPARISON_ROWS: ComparisonRow[] = [
    { feature: 'POS terminal',           free: true,         basic: true,        standard: true,       premium: true },
    { feature: 'Inventory management',   free: false,        basic: true,        standard: true,       premium: true },
    { feature: 'Purchase orders',        free: false,        basic: true,        standard: true,       premium: true },
    { feature: 'Sales orders',           free: false,        basic: false,       standard: true,       premium: true },
    { feature: 'Accounting module',      free: false,        basic: false,       standard: true,       premium: true },
    { feature: 'Financial reports',      free: false,        basic: false,       standard: true,       premium: true },
    { feature: 'Customer management',    free: false,        basic: false,       standard: true,       premium: true },
    { feature: 'Supplier management',    free: false,        basic: false,       standard: true,       premium: true },
    { feature: 'Multi-store support',    free: '1 store',    basic: '1 store',   standard: '3 stores', premium: 'Unlimited' },
    { feature: 'E-commerce storefront',  free: false,        basic: false,       standard: true,       premium: true },
    { feature: 'Manufacturing / BOM',    free: false,        basic: false,       standard: false,      premium: true },
    { feature: 'White-label branding',   free: false,        basic: false,       standard: false,      premium: true },
    { feature: 'Public API access',      free: false,        basic: false,       standard: false,      premium: true },
    { feature: 'Priority support',       free: false,        basic: false,       standard: true,       premium: true },
];

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQS = [
    {
        q: 'Can I change my plan later?',
        a: 'Yes — you can upgrade or downgrade at any time from your account settings. Upgrades take effect immediately and you are billed the prorated difference. Downgrades take effect at the start of your next billing cycle.',
    },
    {
        q: 'Is there a free trial?',
        a: 'Every paid plan comes with a 14-day free trial. No credit card is required to start. If you decide not to continue, your account simply reverts to the FREE plan.',
    },
    {
        q: 'How does billing work?',
        a: 'Monthly plans are billed on the same date each month. Yearly plans are billed once upfront and save you the equivalent of 2 months. We accept bKash, Nagad, and all major credit/debit cards.',
    },
    {
        q: 'Do you offer refunds?',
        a: 'We offer a full refund within 7 days of the first charge on any new subscription. After that period, refunds are issued on a case-by-case basis — contact support and we will work something out.',
    },
    {
        q: 'What happens to my data if I cancel?',
        a: 'Your data is retained for 90 days after cancellation. You can export everything (products, customers, transactions) at any time from the settings panel. After 90 days, data is permanently deleted.',
    },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function Cell({ value }: { value: CellValue }) {
    if (value === true) {
        return (
            <span className="flex justify-center">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
            </span>
        );
    }
    if (value === false) {
        return (
            <span className="flex justify-center text-gray-300">
                <Minus className="w-5 h-5" />
            </span>
        );
    }
    return <span className="text-sm font-medium text-gray-700">{value}</span>;
}

function FaqItem({ q, a }: { q: string; a: string }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="border border-gray-200 rounded-2xl overflow-hidden">
            <button
                onClick={() => setOpen((prev) => !prev)}
                className="w-full flex items-center justify-between px-6 py-5 text-left font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
            >
                <span>{q}</span>
                {open ? (
                    <ChevronUp className="w-5 h-5 text-gray-400 flex-shrink-0" />
                ) : (
                    <ChevronDown className="w-5 h-5 text-gray-400 flex-shrink-0" />
                )}
            </button>
            {open && (
                <div className="px-6 pb-5 text-gray-600 text-sm leading-relaxed border-t border-gray-100 pt-4">
                    {a}
                </div>
            )}
        </div>
    );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PricingPage() {
    const [yearly, setYearly] = useState(false);

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            {/* Nav — same as landing page */}
            <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="text-xl font-black tracking-tight text-blue-600">
                        RetailSaaS
                    </Link>
                    <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
                        <Link href="/#features" className="hover:text-gray-900 transition-colors">Features</Link>
                        <Link href="/pricing" className="text-blue-600 font-semibold transition-colors">Pricing</Link>
                        <Link href="/#testimonials" className="hover:text-gray-900 transition-colors">Reviews</Link>
                    </nav>
                    <div className="flex items-center gap-3">
                        <Link
                            href="/login"
                            className="text-sm font-semibold text-gray-700 hover:text-gray-900 px-4 py-2"
                        >
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

            {/* Hero */}
            <section className="pt-32 pb-16 px-6 bg-gradient-to-b from-blue-50 to-white text-center">
                <div className="max-w-3xl mx-auto space-y-4">
                    <h1 className="text-5xl md:text-6xl font-black tracking-tighter leading-none text-gray-900">
                        Simple, transparent pricing
                    </h1>
                    <p className="text-xl text-gray-500 max-w-xl mx-auto">
                        Built for Bangladeshi retail businesses. Start free — upgrade when you&apos;re ready.
                    </p>

                    {/* Billing toggle */}
                    <div className="flex items-center justify-center gap-4 pt-4">
                        <span className={`text-sm font-semibold ${!yearly ? 'text-gray-900' : 'text-gray-400'}`}>
                            Monthly
                        </span>
                        <button
                            onClick={() => setYearly((prev) => !prev)}
                            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none ${yearly ? 'bg-blue-600' : 'bg-gray-200'}`}
                            aria-label="Toggle billing period"
                        >
                            <span
                                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${yearly ? 'translate-x-8' : 'translate-x-1'}`}
                            />
                        </button>
                        <span className={`text-sm font-semibold ${yearly ? 'text-gray-900' : 'text-gray-400'}`}>
                            Yearly
                        </span>
                        {yearly && (
                            <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                                2 months free!
                            </span>
                        )}
                    </div>
                </div>
            </section>

            {/* Plan cards */}
            <section className="py-12 px-6 bg-white">
                <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                    {PLANS.map((plan) => {
                        const price = yearly ? plan.yearlyPrice : plan.monthlyPrice;
                        const saving =
                            yearly && plan.monthlyPrice > 0
                                ? Math.round(((plan.monthlyPrice - plan.yearlyPrice) / plan.monthlyPrice) * 100)
                                : 0;

                        return (
                            <div
                                key={plan.id}
                                className={`relative flex flex-col p-8 rounded-2xl border-2 transition-shadow ${
                                    plan.highlight
                                        ? 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-100'
                                        : 'border-gray-200 bg-white hover:shadow-md'
                                }`}
                            >
                                {plan.highlight && (
                                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap tracking-wide uppercase">
                                        Most Popular
                                    </div>
                                )}

                                <div className="mb-6">
                                    <h2 className="text-xs font-black tracking-widest text-gray-400 uppercase mb-1">
                                        {plan.name}
                                    </h2>
                                    <p className="text-gray-500 text-sm">{plan.tagline}</p>
                                </div>

                                <div className="flex items-baseline gap-1 mb-1">
                                    <span className="text-4xl font-black">
                                        {price === 0 ? 'Free' : `৳${price.toLocaleString()}`}
                                    </span>
                                    {price > 0 && (
                                        <span className="text-gray-400 text-sm">/mo</span>
                                    )}
                                </div>

                                {yearly && saving > 0 && (
                                    <p className="text-green-600 text-xs font-semibold mb-4">
                                        Save {saving}% vs monthly
                                    </p>
                                )}
                                {(!yearly || saving === 0) && <div className="mb-4" />}

                                <ul className="space-y-2.5 mb-8 flex-1">
                                    {plan.features.map((f) => (
                                        <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                <Link
                                    href={`/signup?plan=${plan.id}`}
                                    className={`block text-center font-bold py-3 rounded-xl transition-colors ${
                                        plan.highlight
                                            ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                            : 'bg-gray-900 hover:bg-gray-700 text-white'
                                    }`}
                                >
                                    {plan.monthlyPrice === 0 ? 'Start free' : 'Start free trial'}
                                </Link>
                            </div>
                        );
                    })}
                </div>

                <p className="text-center text-sm text-gray-400 mt-8">
                    All paid plans include a 14-day free trial &bull; No credit card required &bull; Cancel anytime
                </p>
            </section>

            {/* Feature comparison table */}
            <section className="py-16 px-6 bg-gray-50">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl font-black tracking-tight text-center mb-10">
                        Compare plans in detail
                    </h2>

                    <div className="overflow-x-auto rounded-2xl border border-gray-200 shadow-sm bg-white">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-left px-6 py-4 font-semibold text-gray-500 w-1/3">
                                        Feature
                                    </th>
                                    {PLANS.map((p) => (
                                        <th
                                            key={p.id}
                                            className={`text-center px-4 py-4 font-black text-sm tracking-wider uppercase ${
                                                p.highlight ? 'text-blue-600' : 'text-gray-700'
                                            }`}
                                        >
                                            {p.name}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {COMPARISON_ROWS.map((row, idx) => (
                                    <tr
                                        key={row.feature}
                                        className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                    >
                                        <td className="px-6 py-3.5 font-medium text-gray-700">{row.feature}</td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.free} /></td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.basic} /></td>
                                        <td className="px-4 py-3.5 text-center bg-blue-50/40"><Cell value={row.standard} /></td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.premium} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

            {/* CTA strip */}
            <section className="py-20 px-6 bg-blue-600 text-white text-center">
                <div className="max-w-2xl mx-auto space-y-6">
                    <h2 className="text-4xl font-black tracking-tight">
                        Ready to modernise your store?
                    </h2>
                    <p className="text-blue-100 text-lg">
                        Join hundreds of Bangladeshi retailers who have moved their business to RetailSaaS.
                    </p>
                    <Link
                        href="/signup?plan=standard"
                        className="inline-flex items-center gap-3 bg-white text-blue-600 hover:bg-blue-50 font-bold py-4 px-10 rounded-2xl transition-colors"
                    >
                        Get started with STANDARD
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                    <p className="text-blue-200 text-sm">14-day free trial &bull; Cancel anytime</p>
                </div>
            </section>

            {/* FAQ */}
            <section className="py-20 px-6 bg-white">
                <div className="max-w-2xl mx-auto">
                    <h2 className="text-3xl font-black tracking-tight text-center mb-10">
                        Frequently asked questions
                    </h2>
                    <div className="space-y-3">
                        {FAQS.map((faq) => (
                            <FaqItem key={faq.q} q={faq.q} a={faq.a} />
                        ))}
                    </div>
                    <p className="text-center text-gray-500 text-sm mt-10">
                        Still have questions?{' '}
                        <a
                            href="mailto:support@retailsaas.com.bd"
                            className="text-blue-600 hover:underline font-medium"
                        >
                            Contact support
                        </a>
                    </p>
                </div>
            </section>

            {/* Footer — same as landing page */}
            <footer className="py-10 px-6 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                    <span className="font-black text-lg text-blue-600">RetailSaaS</span>
                    <div className="flex items-center gap-6">
                        <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy</Link>
                        <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
                        <Link href="/signup" className="hover:text-gray-700 transition-colors">Sign up</Link>
                    </div>
                    <span>&copy; {new Date().getFullYear()} RetailSaaS. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
}
