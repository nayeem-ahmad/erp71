'use client';
import { useI18n, formatMessage } from '@/lib/i18n';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { CheckCircle2, Minus, ArrowRight, ChevronDown, ChevronUp, Sparkles, Upload } from 'lucide-react';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import {
    buildAccountingEditionFromApi,
    buildMarketingPlansFromApi,
    ACCOUNTING_EDITION,
    AI_HIGHLIGHTS,
    INCLUDED_EVERYWHERE,
    MARKETING_PLANS,
    MIGRATION_HIGHLIGHTS,
    PLAN_COMPARISON_GROUPS,
    type PublicPlanFromApi,
    PRICING_FAQS,
    yearlySavingsPercent,
    type ComparisonCell,
    type PlanId,
} from '@/lib/marketing/plans';

/** Marketing prices are whole taka — formatBDT defaults to two decimals. */
const money = (amount: number) =>
    formatBDT(amount, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

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
        <div className="border border-gray-200 rounded-xl overflow-hidden">
            <button
                onClick={() => setOpen((prev) => !prev)}
                className="w-full flex items-center justify-between px-6 py-5 text-start font-semibold text-gray-900 hover:bg-gray-50 transition-colors"
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

export default function PricingClient() {
    const { t } = useI18n();
    const m = t.marketing.pricing;
    const [yearly, setYearly] = useState(false);
    const [comparePlan, setComparePlan] = useState<PlanId>('growth');
    const [apiPlans, setApiPlans] = useState<PublicPlanFromApi[]>([]);

    useEffect(() => {
        api.getSubscriptionPlans()
            .then((plans) => setApiPlans(Array.isArray(plans) ? plans : []))
            .catch(() => null);
    }, []);

    const displayPlans = useMemo(
        () => buildMarketingPlansFromApi(apiPlans),
        [apiPlans],
    );
    const accounting = useMemo(
        () => buildAccountingEditionFromApi(apiPlans),
        [apiPlans],
    );
    const anchorPlan = displayPlans.find((plan) => plan.highlight) ?? displayPlans[0];

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
                            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${yearly ? 'bg-blue-600' : 'bg-gray-200'}`}
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
                            <span className="bg-emerald-100 text-emerald-700 text-xs font-bold px-3 py-1 rounded-full">
                                2 months free
                            </span>
                        )}
                    </div>
                </div>
            </section>

            <section className="py-12 px-6 bg-white">
                <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                    {displayPlans.map((plan) => {
                        const price = yearly ? plan.yearlyPrice : plan.monthlyPrice;
                        const saving = yearly ? yearlySavingsPercent(plan) : 0;

                        return (
                            <div
                                key={plan.id}
                                className={`relative flex flex-col p-8 rounded-xl border-2 transition-shadow ${
                                    plan.comingSoon
                                        ? 'border-gray-200 bg-gray-50 opacity-95'
                                        : plan.highlight
                                        ? 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-100'
                                        : 'border-gray-200 bg-white hover:shadow-md'
                                }`}
                            >
                                {plan.comingSoon && (
                                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-amber-500 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap tracking-wide uppercase">
                                        {m.comingSoon}
                                    </div>
                                )}
                                {plan.highlight && !plan.comingSoon && (
                                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 bg-blue-600 text-white text-xs font-bold px-4 py-1 rounded-full whitespace-nowrap tracking-wide uppercase">
                                        {t.marketing.home.pricing.mostPopular}
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
                                        {plan.priceLabel ?? money(price)}
                                    </span>
                                    {!plan.priceLabel && price > 0 && (
                                        <span className="text-gray-400 text-sm">/mo</span>
                                    )}
                                </div>

                                {plan.contactSales ? (
                                    <p className="text-gray-500 text-xs font-semibold mb-4">
                                        from {money(plan.monthlyPrice)} / mo
                                    </p>
                                ) : yearly && saving > 0 ? (
                                    <p className="text-emerald-600 text-xs font-semibold mb-4">
                                        {formatMessage(m.yearlySave, { percent: saving })}
                                    </p>
                                ) : (
                                    <div className="mb-4" />
                                )}

                                {/* Zero is hidden rather than shown as "no setup fee": every plan
                                    reads 0 until an admin sets one, and a row of "৳0" on all four
                                    cards would say nothing. Starter's absence is the message. */}
                                {plan.setupFee > 0 && (
                                    <p className="text-xs text-gray-600 border-t border-dashed border-gray-200 pt-3 mb-4">
                                        <span className="font-semibold text-gray-900">{money(plan.setupFee)}</span> one-time setup
                                    </p>
                                )}

                                <ul className="space-y-2.5 mb-8 flex-1">
                                    {plan.features.map((f) => (
                                        <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>

                                {plan.contactSales ? (
                                    <Link
                                        href="/contact"
                                        className="block text-center font-bold py-3 rounded-xl bg-gray-900 hover:bg-gray-700 text-white transition-colors"
                                    >
                                        Talk to sales
                                    </Link>
                                ) : plan.comingSoon ? (
                                    <span className="block text-center font-bold py-3 rounded-xl bg-gray-200 text-gray-500 cursor-not-allowed">
                                        {m.comingSoon}
                                    </span>
                                ) : (
                                    <Link
                                        href={`/signup?plan=${plan.id}`}
                                        className={`block text-center font-bold py-3 rounded-xl transition-colors ${
                                            plan.highlight
                                                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                                : 'bg-gray-900 hover:bg-gray-700 text-white'
                                        }`}
                                    >
                                        {m.ctaButton}
                                    </Link>
                                )}
                            </div>
                        );
                    })}
                </div>

                <p className="text-center text-sm text-gray-400 mt-8">
                    {m.paidPlansNote}
                </p>
            </section>

            <section className="pb-4 px-6 bg-white">
                <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="rounded-xl border border-gray-200 border-s-4 border-s-blue-600 p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Sparkles className="w-5 h-5 text-blue-600" />
                            <h3 className="font-bold text-gray-900">Every plan is AI-enabled</h3>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-blue-600">Not an add-on</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            {AI_HIGHLIGHTS.map((item) => (
                                <div key={item.title} className="text-sm">
                                    <p className="font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-gray-500 leading-relaxed">{item.body}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 mt-4 pt-3">
                            Credits are the fuel. Every plan carries a monthly allowance and top-ups can be
                            bought at any time. Running out never affects the till — the assistant pauses,
                            the POS does not.
                        </p>
                    </div>

                    <div className="rounded-xl border border-gray-200 p-6">
                        <div className="flex items-center gap-3 mb-4">
                            <Upload className="w-5 h-5 text-blue-600" />
                            <h3 className="font-bold text-gray-900">Moving your data in is included</h3>
                            <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Every plan</span>
                        </div>
                        <div className="grid sm:grid-cols-2 gap-4">
                            {MIGRATION_HIGHLIGHTS.map((item) => (
                                <div key={item.title} className="text-sm">
                                    <p className="font-semibold text-gray-900">{item.title}</p>
                                    <p className="text-gray-500 leading-relaxed">{item.body}</p>
                                </div>
                            ))}
                        </div>
                        <p className="text-xs text-gray-500 leading-relaxed border-t border-gray-100 mt-4 pt-3">
                            Free on every plan, using our standard import tools — we load the files for you.
                            Customisation is quoted separately: history out of Tally or a desktop POS, bespoke
                            field mapping, or reports built for how your business works.
                        </p>
                    </div>
                </div>
            </section>

            <section className="py-12 px-6 bg-white">
                <div className="max-w-7xl mx-auto rounded-xl bg-gray-50 border border-gray-200 p-8 grid lg:grid-cols-2 gap-8">
                    <div className="space-y-4">
                        <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
                            A different product
                        </span>
                        <h2 className="text-2xl font-black tracking-tight text-gray-900">
                            {accounting.name} — {money(accounting.monthlyPrice)}/mo
                        </h2>
                        <p className="text-gray-600 text-sm leading-relaxed">
                            {accounting.tagline}. The workspace has no POS, no inventory and no CRM — not as a
                            restriction, but because none of it applies to the work. If you are choosing between
                            this and {anchorPlan?.name ?? 'Growth'}, the question is whether you sell anything.
                        </p>
                        <Link
                            href="/signup?plan=accounting"
                            className="inline-flex items-center gap-2 text-blue-600 font-semibold text-sm hover:underline"
                        >
                            Choose the accounting edition
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                    <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 content-start">
                        {accounting.features.map((f) => (
                            <li key={f} className="flex items-start gap-2.5 text-sm text-gray-700">
                                <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                {f}
                            </li>
                        ))}
                    </ul>
                </div>
            </section>

            <section className="py-12 px-6 bg-white">
                <div className="max-w-7xl mx-auto">
                    <h2 className="text-xl font-bold tracking-tight text-gray-900 mb-2">
                        On every plan, including the cheapest
                    </h2>
                    <p className="text-gray-500 text-sm mb-6 max-w-2xl">
                        These are not upsells. A business records money and stock with them, and none of that
                        should depend on what you pay.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
                        {INCLUDED_EVERYWHERE.map((item) => (
                            <div key={item} className="flex items-start gap-2.5 text-sm text-gray-700">
                                <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                                {item}
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="py-16 px-6 bg-gray-50">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-3xl font-black tracking-tight text-center mb-2">
                        {m.compareTitle}
                    </h2>
                    <p className="text-center text-gray-500 text-sm mb-10">{m.compareDescription}</p>

                    <div className="md:hidden space-y-4">
                        <label className="block">
                            <span className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2 block">
                                Compare plan
                            </span>
                            <select
                                value={comparePlan}
                                onChange={(event) => setComparePlan(event.target.value as PlanId)}
                                className="w-full min-h-touch rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                            >
                                {displayPlans.map((plan) => (
                                    <option key={plan.id} value={plan.id}>
                                        {plan.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {PLAN_COMPARISON_GROUPS.map((group) => (
                            <div key={group.title} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                                <p className="px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400 bg-gray-50 border-b border-gray-100">
                                    {group.title}
                                </p>
                                <div className="divide-y divide-gray-100">
                                    {group.rows.map((row) => (
                                        <div key={row.feature} className="flex items-center justify-between gap-4 px-4 py-3.5">
                                            <span className="text-sm font-medium text-gray-700">
                                                {row.feature}
                                                {row.soon && (
                                                    <span className="ms-2 text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                                                        In development
                                                    </span>
                                                )}
                                            </span>
                                            <div className="flex-shrink-0">
                                                <Cell value={row[comparePlan]} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="hidden md:block overflow-x-auto rounded-xl border border-gray-200 shadow-sm bg-white">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-100">
                                    <th className="text-start px-6 py-4 font-semibold text-gray-500 w-1/3">
                                        Feature
                                    </th>
                                    {displayPlans.map((p) => (
                                        <th
                                            key={p.id}
                                            className={`text-center px-4 py-4 font-black text-sm tracking-wider uppercase ${
                                                p.highlight ? 'text-blue-600' : 'text-gray-700'
                                            }`}
                                        >
                                            <span className="block">{p.name}</span>
                                            {p.comingSoon && (
                                                <span className="mt-1 block text-[10px] font-bold normal-case tracking-normal text-amber-600">
                                                    {m.comingSoon}
                                                </span>
                                            )}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {PLAN_COMPARISON_GROUPS.map((group) => (
                                    <>
                                        <tr key={group.title} className="bg-gray-50 border-y border-gray-100">
                                            <td
                                                colSpan={displayPlans.length + 1}
                                                className="px-6 py-2.5 text-[11px] font-bold uppercase tracking-widest text-gray-400"
                                            >
                                                {group.title}
                                            </td>
                                        </tr>
                                        {group.rows.map((row, idx) => (
                                            <tr
                                                key={row.feature}
                                                className={`border-b border-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}`}
                                            >
                                                <td className="px-6 py-3.5 font-medium text-gray-700">
                                                    {row.feature}
                                                    {row.soon && (
                                                        <span className="ms-2 text-[10px] font-semibold uppercase tracking-wider text-amber-600">
                                                            In development
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3.5 text-center"><Cell value={row.starter} /></td>
                                                <td className="px-4 py-3.5 text-center bg-blue-50/40"><Cell value={row.growth} /></td>
                                                <td className="px-4 py-3.5 text-center"><Cell value={row.business} /></td>
                                                <td className="px-4 py-3.5 text-center"><Cell value={row.enterprise} /></td>
                                            </tr>
                                        ))}
                                    </>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="flex flex-wrap justify-center gap-x-8 gap-y-2 mt-6 text-xs text-gray-500">
                        <span className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-blue-600" /> Included in the plan
                        </span>
                        <span className="flex items-center gap-1.5">
                            <Minus className="w-4 h-4 text-gray-300" /> Not available on that plan
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="font-semibold text-amber-600">In development</span> On the roadmap, not yet purchasable
                        </span>
                    </div>
                </div>
            </section>

            <section className="py-20 px-6 bg-blue-600 text-white text-center">
                <div className="max-w-2xl mx-auto space-y-6">
                    <h2 className="text-4xl font-black tracking-tight">
                        {m.ctaTitle}
                    </h2>
                    <p className="text-blue-100 text-lg">
                        {m.ctaDescription}
                    </p>
                    <Link
                        href={`/signup?plan=${anchorPlan?.id ?? 'growth'}`}
                        className="inline-flex items-center gap-3 bg-white text-blue-600 hover:bg-blue-50 font-bold py-4 px-10 rounded-xl transition-colors"
                    >
                        Get started with {anchorPlan?.name ?? 'Growth'}
                        <ArrowRight className="w-5 h-5" />
                    </Link>
                    <p className="text-blue-200 text-sm">{m.paidPlansNote}</p>
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
                            href="mailto:support@erp71.com"
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
