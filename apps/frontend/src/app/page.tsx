import Link from 'next/link';
import {
    ArrowRight, CheckCircle2, PlayCircle, Receipt, Shield, Star, Zap,
} from 'lucide-react';
import MarketingFooter from '@/components/marketing/MarketingFooter';
import MarketingNav from '@/components/marketing/MarketingNav';
import {
    FEATURES, HERO_STATS, HOW_IT_WORKS, MODULES, PAYMENT_METHODS, TESTIMONIALS, TRUST_BADGES,
} from '@/lib/marketing/content';
import { MARKETING_PLANS } from '@/lib/marketing/plans';

function DashboardPreview() {
    return (
        <div className="relative mx-auto max-w-4xl">
            <div className="absolute -inset-4 bg-gradient-to-r from-blue-200/40 to-indigo-200/40 rounded-3xl blur-2xl" />
            <div className="relative bg-white rounded-2xl border border-gray-200 shadow-2xl shadow-blue-100 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50">
                    <span className="w-3 h-3 rounded-full bg-red-400" />
                    <span className="w-3 h-3 rounded-full bg-yellow-400" />
                    <span className="w-3 h-3 rounded-full bg-green-400" />
                    <span className="ml-3 text-xs font-semibold text-gray-400">app.nayeemahmad.com/dashboard</span>
                </div>
                <div className="grid grid-cols-12 min-h-[280px]">
                    <div className="col-span-3 bg-gray-900 p-4 space-y-3 hidden sm:block">
                        {['Dashboard', 'POS', 'Inventory', 'Sales', 'Accounting'].map((item, i) => (
                            <div
                                key={item}
                                className={`text-xs font-semibold px-3 py-2 rounded-lg ${i === 0 ? 'bg-blue-600 text-white' : 'text-gray-400'}`}
                            >
                                {item}
                            </div>
                        ))}
                    </div>
                    <div className="col-span-12 sm:col-span-9 p-6 bg-[#f9fafb]">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                            {[
                                { label: 'Today sales', value: '৳ 48,250' },
                                { label: 'Orders', value: '127' },
                                { label: 'Low stock', value: '6' },
                                { label: 'Customers', value: '1,204' },
                            ].map((card) => (
                                <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-3">
                                    <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">{card.label}</p>
                                    <p className="text-lg font-black text-gray-900 mt-1">{card.value}</p>
                                </div>
                            ))}
                        </div>
                        <div className="bg-white rounded-xl border border-gray-100 p-4">
                            <div className="flex items-center justify-between mb-3">
                                <p className="text-sm font-bold text-gray-800">Recent sales</p>
                                <span className="text-xs text-blue-600 font-semibold">Live</span>
                            </div>
                            <div className="space-y-2">
                                {['Plain T-Shirt — ৳ 850', 'Wireless Mouse — ৳ 1,200', 'Notebook A5 — ৳ 120'].map((row) => (
                                    <div key={row} className="flex items-center justify-between text-sm">
                                        <span className="text-gray-600">{row}</span>
                                        <Receipt className="w-4 h-4 text-green-500" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function HomePage() {
    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">
            <MarketingNav />

            <section className="pt-32 pb-20 px-6 bg-gradient-to-b from-blue-50 to-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center space-y-8 max-w-4xl mx-auto">
                        <div className="inline-flex items-center gap-2 bg-blue-100 text-blue-700 px-4 py-1.5 rounded-full text-sm font-semibold">
                            <Zap className="w-4 h-4" />
                            Built for Bangladeshi retail businesses
                        </div>
                        <h1 className="text-5xl md:text-7xl font-black tracking-tighter leading-none text-gray-900">
                            Run your store.{' '}
                            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">
                                Grow your business.
                            </span>
                        </h1>
                        <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
                            All-in-one retail management — POS, inventory, accounting, storefront, and BDT
                            payments. Go live in minutes, scale from one counter to many branches.
                        </p>
                        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
                            <Link
                                href="/signup"
                                className="group bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center gap-3 w-full sm:w-auto justify-center"
                            >
                                Start your free trial
                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                            </Link>
                            <Link
                                href="/login?demo=1"
                                className="bg-white hover:bg-gray-50 text-gray-700 font-bold py-4 px-10 rounded-2xl border border-gray-200 transition-colors w-full sm:w-auto text-center flex items-center justify-center gap-2"
                            >
                                <PlayCircle className="w-5 h-5 text-blue-500" />
                                Try Demo
                            </Link>
                        </div>
                        <p className="text-sm text-gray-400">No credit card required · 14-day free trial · Cancel anytime</p>
                        <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                            {TRUST_BADGES.map((badge) => (
                                <span key={badge} className="text-xs font-semibold text-gray-500 bg-white border border-gray-200 px-3 py-1 rounded-full">
                                    {badge}
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="mt-16">
                        <DashboardPreview />
                    </div>
                </div>
            </section>

            <section className="py-16 px-6 bg-blue-600">
                <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center text-white">
                    {HERO_STATS.map(({ value, label }) => (
                        <div key={label}>
                            <div className="text-4xl font-black mb-1">{value}</div>
                            <div className="text-blue-200 text-sm font-medium">{label}</div>
                        </div>
                    ))}
                </div>
            </section>

            <section id="how-it-works" className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">Up and running in one afternoon</h2>
                        <p className="text-gray-500 text-lg max-w-xl mx-auto">
                            From signup to first sale — a guided path designed for shop owners, not IT teams.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        {HOW_IT_WORKS.map(({ step, title, description }) => (
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
                        <h2 className="text-4xl font-black tracking-tight mb-4">Everything your store needs</h2>
                        <p className="text-gray-500 text-lg max-w-xl mx-auto">
                            One platform to replace spreadsheets, paper ledgers, and disconnected tools.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {FEATURES.map(({ icon: Icon, title, desc }) => (
                            <div key={title} className="p-6 rounded-2xl border border-gray-100 bg-white hover:border-blue-100 hover:shadow-md transition-all group">
                                <div className="w-12 h-12 bg-blue-50 group-hover:bg-blue-100 rounded-xl flex items-center justify-center mb-4 transition-colors">
                                    <Icon className="w-6 h-6 text-blue-600" />
                                </div>
                                <h3 className="font-bold text-lg mb-2">{title}</h3>
                                <p className="text-gray-500 text-sm leading-relaxed">{desc}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">Modules that scale with you</h2>
                        <p className="text-gray-500 text-lg max-w-2xl mx-auto">
                            Start with POS and inventory. Unlock accounting, storefront, and manufacturing as you grow.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {MODULES.map(({ icon: Icon, title, desc, bullets }) => (
                            <div key={title} className="p-8 rounded-2xl border border-gray-100 bg-gradient-to-br from-white to-blue-50/30">
                                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mb-4">
                                    <Icon className="w-6 h-6 text-blue-600" />
                                </div>
                                <h3 className="font-bold text-xl mb-2">{title}</h3>
                                <p className="text-gray-500 text-sm leading-relaxed mb-4">{desc}</p>
                                <ul className="space-y-2">
                                    {bullets.map((bullet) => (
                                        <li key={bullet} className="flex items-center gap-2 text-sm text-gray-700">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                            {bullet}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="py-16 px-6 bg-gray-50">
                <div className="max-w-4xl mx-auto text-center">
                    <h2 className="text-2xl font-black tracking-tight mb-6">Payments your customers already use</h2>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        {PAYMENT_METHODS.map(({ name, tone }) => (
                            <span key={name} className={`px-4 py-2 rounded-xl text-sm font-bold ${tone}`}>
                                {name}
                            </span>
                        ))}
                    </div>
                </div>
            </section>

            <section id="testimonials" className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-4xl font-black tracking-tight text-center mb-16">Trusted by retailers across Bangladesh</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {TESTIMONIALS.map(({ name, role, quote, stars }) => (
                            <div key={name} className="bg-gray-50 p-8 rounded-2xl border border-gray-100 shadow-sm">
                                <div className="flex mb-4">
                                    {Array.from({ length: stars }).map((_, i) => (
                                        <Star key={i} className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                                    ))}
                                </div>
                                <p className="text-gray-700 italic mb-6">&ldquo;{quote}&rdquo;</p>
                                <div>
                                    <div className="font-bold text-sm">{name}</div>
                                    <div className="text-gray-400 text-xs">{role}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section id="pricing" className="py-24 px-6 bg-gray-50">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">Simple, transparent pricing</h2>
                        <p className="text-gray-500 text-lg">Start free on FREE. Upgrade when you need more stores, users, or accounting.</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
                        {MARKETING_PLANS.map((plan) => (
                            <div
                                key={plan.id}
                                className={`p-6 rounded-2xl border-2 flex flex-col ${
                                    plan.highlight
                                        ? 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-100'
                                        : 'border-gray-200 bg-white'
                                }`}
                            >
                                {plan.highlight && (
                                    <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3">Most popular</div>
                                )}
                                <h3 className="text-sm font-black tracking-widest text-gray-400 uppercase">{plan.name}</h3>
                                <p className="text-gray-500 text-sm mt-1 mb-4">{plan.tagline}</p>
                                <div className="flex items-baseline gap-1 mb-4">
                                    <span className="text-3xl font-black">
                                        {plan.monthlyPrice === 0 ? 'Free' : `৳${plan.monthlyPrice.toLocaleString()}`}
                                    </span>
                                    {plan.monthlyPrice > 0 && <span className="text-gray-400 text-sm">/mo</span>}
                                </div>
                                <ul className="space-y-2 mb-6 flex-1">
                                    {plan.features.slice(0, 4).map((feature) => (
                                        <li key={feature} className="flex items-start gap-2 text-sm text-gray-700">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                                            {feature}
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
                        ))}
                    </div>
                    <div className="text-center mt-8">
                        <Link
                            href="/pricing"
                            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 font-semibold text-sm transition-colors"
                        >
                            See full pricing &amp; feature comparison <ArrowRight className="w-4 h-4" />
                        </Link>
                    </div>
                </div>
            </section>

            <section className="py-24 px-6 bg-gray-900 text-white text-center">
                <div className="max-w-2xl mx-auto space-y-6">
                    <Shield className="w-12 h-12 text-blue-400 mx-auto" />
                    <h2 className="text-4xl font-black tracking-tight">Ready to modernise your store?</h2>
                    <p className="text-gray-400 text-lg">
                        Join hundreds of Bangladeshi retailers who have moved their business to RetailSaaS.
                    </p>
                    <Link
                        href="/signup"
                        className="inline-flex items-center gap-3 bg-blue-600 hover:bg-blue-700 font-bold py-4 px-10 rounded-2xl transition-colors"
                    >
                        Start your free trial <ArrowRight className="w-5 h-5" />
                    </Link>
                </div>
            </section>

            <MarketingFooter />
        </div>
    );
}