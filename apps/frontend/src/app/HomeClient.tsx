'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
    ArrowRight, CheckCircle2, PlayCircle, Shield, Zap,
} from 'lucide-react';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import {
    FEATURES, MODULES, PAYMENT_METHODS, USE_CASES,
} from '@/lib/marketing/content';
import { buildMarketingPlansFromApi, type PublicPlanFromApi } from '@/lib/marketing/plans';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

function HeroBackground() {
    return (
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
            <div className="absolute inset-0 bg-gradient-to-b from-blue-50 to-white" />
            <div className="absolute -top-28 -start-28 w-[28rem] h-[28rem] bg-blue-200/35 rounded-full blur-3xl animate-hero-float" />
            <div className="absolute top-1/4 -end-36 w-80 h-80 bg-indigo-200/30 rounded-full blur-3xl animate-hero-float-slow" />
            <div
                className="absolute bottom-8 left-1/3 w-72 h-72 bg-sky-200/25 rounded-full blur-3xl animate-hero-float"
                style={{ animationDelay: '-11s' }}
            />
            <div
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[36rem] h-[36rem] bg-blue-100/20 rounded-full blur-3xl animate-hero-drift"
                style={{ animationDelay: '-6s' }}
            />
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#8080800a_1px,transparent_1px),linear-gradient(to_bottom,#8080800a_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_at_center,black_15%,transparent_72%)]" />
        </div>
    );
}

function DashboardPreview({ m }: { m: ReturnType<typeof useI18n>['t']['marketing']['home'] }) {
    return (
        <figure className="relative mx-auto max-w-5xl">
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-200/40 to-indigo-200/40 rounded-3xl blur-2xl" aria-hidden />
            <div className="relative bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-blue-100 overflow-hidden">
                <Image
                    src="/marketing/dashboard-preview.webp"
                    alt={m.preview.alt}
                    width={2160}
                    height={1350}
                    sizes="(max-width: 1024px) 100vw, 64rem"
                    priority
                    className="w-full h-auto"
                />
            </div>
            <figcaption className="mt-3 text-center text-xs text-gray-400">{m.preview.caption}</figcaption>
        </figure>
    );
}

/** Marketing prices are whole taka — formatBDT defaults to two decimals. */
const money = (amount: number) =>
    formatBDT(amount, { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export default function HomeClient() {
    const { t } = useI18n();
    const m = t.marketing.home;

    // The pricing preview reads the same live plans as /pricing. It used to map
    // the static constants directly, so the two pages disagreed the moment an
    // admin changed a price — /pricing followed the API and this one did not.
    const [apiPlans, setApiPlans] = useState<PublicPlanFromApi[]>([]);
    useEffect(() => {
        api.getSubscriptionPlans()
            .then((plans) => setApiPlans(Array.isArray(plans) ? plans : []))
            .catch(() => null);
    }, []);
    const displayPlans = useMemo(() => buildMarketingPlansFromApi(apiPlans), [apiPlans]);

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav />

            <section className="relative pt-32 pb-20 px-6 overflow-hidden">
                <HeroBackground />
                <div className="relative z-10 max-w-6xl mx-auto">
                    <div className="text-center space-y-8 max-w-4xl mx-auto">
                        <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full text-sm font-semibold">
                            <Zap className="w-4 h-4" />
                            {m.hero.badge}
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none text-gray-900">
                            {m.hero.titleLine1}{' '}
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                                {m.hero.titleLine2}
                            </span>
                        </h1>
                        <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                            {m.hero.description}
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                            <Link
                                href="/signup"
                                className="group bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center gap-3 w-full sm:w-auto justify-center"
                            >
                                {m.hero.startTrial}
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 rtl:-scale-x-100 rtl:group-hover:-translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/demo"
                                className="bg-white hover:bg-gray-50 text-gray-700 font-bold py-4 px-10 rounded-2xl border border-gray-200 transition-colors w-full sm:w-auto text-center flex items-center justify-center gap-2"
                            >
                                <PlayCircle className="w-5 h-5 text-blue-500" />
                                {m.hero.tryDemo}
                            </Link>
                        </div>
                        <p className="text-sm text-gray-400">{m.hero.footnote}</p>
                        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                            {m.trustBadges.map((badge) => (
                                <span key={badge} className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full">
                                    {badge}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="mt-16">
                        <DashboardPreview m={m} />
                    </div>
                </div>
            </section>

            <section className="py-16 px-6 bg-blue-600">
                <div className="max-w-5xl mx-auto">
                    <h2 className="text-center text-blue-100 text-sm font-semibold mb-8">{m.capabilities.title}</h2>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center text-white">
                        {m.capabilities.items.map(({ value, label }) => (
                            <div key={value}>
                                <div className="text-2xl font-black mb-1">{value}</div>
                                <div className="text-blue-200 text-sm font-medium">{label}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section id="how-it-works" className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">{m.howItWorks.title}</h2>
                        <p className="text-gray-500 text-lg max-w-xl mx-auto">
                            {m.howItWorks.description}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {m.howItWorks.steps.map(({ step, title, description }) => (
                            <div key={step} className="p-6 rounded-2xl border border-gray-100 bg-gray-50/50">
                                <div className="text-xs font-black tracking-widest text-blue-600 mb-3">{step}</div>
                                <h3 className="font-bold text-lg mb-2">{title}</h3>
                                <p className="text-gray-500 text-sm leading-relaxed">{description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section id="features" className="py-24 px-6 bg-gray-50">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">{m.features.title}</h2>
                        <p className="text-gray-500 text-lg max-w-xl mx-auto">
                            {m.features.description}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {FEATURES.map(({ icon: Icon }, i) => {
                            const item = m.features.items[i];
                            return (
                                <div key={item.title} className="p-6 rounded-2xl border border-gray-100 bg-white hover:border-blue-100 hover:shadow-md transition-all group">
                                    <div className="w-12 h-12 bg-blue-50 group-hover:bg-blue-100 rounded-xl flex items-center justify-center mb-4 transition-colors">
                                        <Icon className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                                    <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">{m.modules.title}</h2>
                        <p className="text-gray-500 text-lg max-w-2xl mx-auto">
                            {m.modules.description}
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {MODULES.map(({ icon: Icon }, i) => {
                            const item = m.modules.items[i];
                            return (
                                <div key={item.title} className="p-8 rounded-2xl border border-gray-100 bg-gradient-to-br from-white to-blue-50/30">
                                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                                        <Icon className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <h3 className="font-bold text-xl mb-2">{item.title}</h3>
                                    <p className="text-gray-500 text-sm leading-relaxed mb-4">{item.desc}</p>
                                    <ul className="space-y-2">
                                        {item.bullets.map((bullet) => (
                                            <li key={bullet} className="flex items-center gap-2 text-sm text-gray-700">
                                                <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                                {bullet}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section className="py-16 px-6 bg-gray-50">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-2xl font-black tracking-tight mb-3">{m.payments.title}</h2>
                    <p className="text-gray-500 text-sm max-w-xl mx-auto mb-6">{m.payments.description}</p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        {PAYMENT_METHODS.map(({ name, tone }) => (
                            <span key={name} className={`px-4 py-2 rounded-xl text-sm font-bold ${tone}`}>
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            <section id="use-cases" className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">{m.useCases.title}</h2>
                        <p className="text-gray-500 text-lg max-w-xl mx-auto">{m.useCases.description}</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {USE_CASES.map(({ icon: Icon }, i) => {
                            const item = m.useCases.items[i];
                            return (
                                <div key={item.title} className="p-6 rounded-2xl border border-gray-100 bg-gray-50/50">
                                    <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center mb-4">
                                        <Icon className="w-6 h-6 text-blue-600" />
                                    </div>
                                    <h3 className="font-bold text-lg mb-2">{item.title}</h3>
                                    <p className="text-gray-500 text-sm leading-relaxed">{item.desc}</p>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>

            <section id="pricing" className="py-24 px-6 bg-gray-50">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">{m.pricing.title}</h2>
                        <p className="text-gray-500 text-lg">{m.pricing.description}</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                        {displayPlans.map((plan) => (
                            <div
                                key={plan.id}
                                className={`relative p-6 rounded-2xl border-2 flex flex-col ${
                                    plan.comingSoon
                                        ? 'border-gray-200 bg-gray-50'
                                        : plan.highlight
                                        ? 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-100'
                                        : 'border-gray-200 bg-white'
                                }`}
                            >
                                {plan.comingSoon && (
                                    <div className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3">{m.pricing.comingSoon}</div>
                                )}
                                {plan.highlight && !plan.comingSoon && (
                                    <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3">{m.pricing.mostPopular}</div>
                                )}
                                <h3 className="text-sm font-black tracking-widest text-gray-400 uppercase">{plan.name}</h3>
                                <p className="text-gray-500 text-sm mt-1 mb-4">{plan.tagline}</p>
                                <div className="flex items-baseline gap-1 mb-4">
                                    <span className="text-3xl font-black">
                                        {plan.priceLabel ?? (plan.monthlyPrice === 0 ? m.pricing.free : money(plan.monthlyPrice))}
                                    </span>
                                    {!plan.priceLabel && plan.monthlyPrice > 0 && (
                                        <span className="text-gray-400 text-sm">{m.pricing.perMonth}</span>
                                    )}
                                </div>
                                <ul className="space-y-2 mb-6 flex-1">
                                    {plan.features.slice(0, 4).map((feature) => (
                                        <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                            {feature}
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
                                        {m.pricing.comingSoon}
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
                                        {m.pricing.startFreeTrial}
                                    </Link>
                                )}
                            </div>
                        ))}
                    </div>
                    <div className="text-center mt-8">
                        <Link
                            href="/pricing"
                            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm transition-colors"
                        >
                            {m.pricing.seeFull} <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </section>

            <section className="py-24 px-6 bg-gray-900 text-white text-center">
                <div className="max-w-2xl mx-auto space-y-6">
                    <Shield className="w-12 h-12 text-blue-400 mx-auto" />
                    <h2 className="text-4xl font-black tracking-tight">{m.cta.title}</h2>
                    <p className="text-gray-400 text-lg">
                        {m.cta.description}
                    </p>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 font-bold py-4 px-10 rounded-2xl transition-colors"
                    >
                        {m.cta.button} <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </section>

            <MarketingFooter />
        </div>
    );
}