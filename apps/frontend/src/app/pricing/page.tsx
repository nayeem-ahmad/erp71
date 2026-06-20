'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Minus, ArrowRight, ChevronDown, ChevronUp } from 'lucide-react';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import {
    MARKETING_PLANS,
    PLAN_COMPARISON_ROWS,
    PRICING_FAQS,
    yearlySavingsPercent,
    type ComparisonCell,
} from '@/lib/marketing/plans';

function Cell({ value }: { value: ComparisonCell }) {
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

export default function PricingPage() {
    const { t } = useI18n();
    const m = t.marketing.pricing;
    const [yearly, setYearly] = useState(false);

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav active="pricing" />

            <section className="pt-32 pb-16 px-6 bg-gradient-to-b from-blue-50 to-white text-center">
                <div className="max-w-3xl mx-auto space-y-4">
                    <h1 className="text-5xl md:text-6xl font-black tracking-tighter leading-none text-gray-900">
                        {m.title}
                    </h1>
                    <p className="text-xl text-gray-500 max-w-xl mx-auto">
                        {m.description}
                    </p>

                    <div className="flex items-center justify-center gap-4 pt-4">
                        <span className={`text-sm font-semibold ${!yearly ? 'text-gray-900' : 'text-gray-400'}`}>
                            {m.monthly}
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
                            {m.yearly}
                        </span>
                        {yearly && (
                            <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full">
                                2 months free!
                            </span>
                        )}
                    </div>
                </div>
            </section>

            <section className="py-12 px-6 bg-white">
                <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
                    {MARKETING_PLANS.map((plan) => {
                        const price = yearly ? plan.yearlyPrice : plan.monthlyPrice;
                        const saving = yearly ? yearlySavingsPercent(plan) : 0;

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
                                    {plan.monthlyPrice === 0 ? 'Start free' : m.ctaButton}
                                </Link>
                            </div>
                        );
                    })}
                </div>

                <p className="text-center text-sm text-gray-400 mt-8">
                    All paid plans include a 14-day free trial &bull; No credit card required &bull; Cancel anytime
                </p>
            </section>

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
                                    {MARKETING_PLANS.map((p) => (
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
                                {PLAN_COMPARISON_ROWS.map((row, idx) => (
                                    <tr
                                        key={row.feature}
                                        className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                    >
                                        <td className="px-6 py-3.5 font-medium text-gray-700">{row.feature}</td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.free} /></td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.basic} /></td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.accounting} /></td>
                                        <td className="px-4 py-3.5 text-center bg-blue-50/40"><Cell value={row.standard} /></td>
                                        <td className="px-4 py-3.5 text-center"><Cell value={row.premium} /></td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </section>

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

            <section className="py-20 px-6 bg-white">
                <div className="max-w-2xl mx-auto">
                    <h2 className="text-3xl font-black tracking-tight text-center mb-10">
                        {m.faqTitle}
                    </h2>
                    <div className="space-y-3">
                        {PRICING_FAQS.map((faq) => (
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

            <MarketingFooter />
        </div>
    );
}