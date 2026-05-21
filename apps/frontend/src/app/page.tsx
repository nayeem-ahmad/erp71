import Link from 'next/link';
import {
    ArrowRight, BarChart3, ShoppingCart, Package, Users,
    CreditCard, Globe, Shield, Zap, CheckCircle2, Star,
} from 'lucide-react';

const FEATURES = [
    {
        icon: ShoppingCart,
        title: 'Point of Sale',
        desc: 'Fast, reliable POS with barcode scanning, split payments, and real-time inventory sync.',
    },
    {
        icon: Package,
        title: 'Inventory Control',
        desc: 'Multi-warehouse stock tracking, reorder alerts, and full movement history.',
    },
    {
        icon: BarChart3,
        title: 'Sales Analytics',
        desc: 'Revenue reports, top-selling products, and cashier performance — all in real time.',
    },
    {
        icon: Users,
        title: 'Customer Management',
        desc: 'Build customer profiles, track purchase history, and run targeted promotions.',
    },
    {
        icon: CreditCard,
        title: 'Integrated Payments',
        desc: 'Accept bKash, Nagad, SSL Wireless, and cash — reconciled automatically.',
    },
    {
        icon: Globe,
        title: 'Multi-Tenant SaaS',
        desc: 'Each business gets an isolated workspace. Scale from one store to a nationwide chain.',
    },
];

const PLANS = [
    {
        name: 'Basic',
        price: 1499,
        period: 'month',
        highlight: false,
        features: [
            '1 store location',
            'Up to 5 staff accounts',
            'Inventory & POS',
            'Basic sales reports',
            'Email support',
        ],
    },
    {
        name: 'Premium',
        price: 3999,
        period: 'month',
        highlight: true,
        features: [
            'Unlimited stores',
            'Unlimited staff accounts',
            'Everything in Basic',
            'Advanced analytics',
            'Accounting module',
            'Priority support',
        ],
    },
];

const TESTIMONIALS = [
    {
        name: 'Rahim Uddin',
        role: 'Owner, Rahim Electronics, Dhaka',
        quote: 'Switched from paper ledgers to Retail SaaS in a week. Our stock accuracy improved overnight.',
        stars: 5,
    },
    {
        name: 'Nasrin Begum',
        role: 'Manager, Fashion House, Chittagong',
        quote: 'The POS is incredibly fast. During Eid rush we processed hundreds of sales without a single hiccup.',
        stars: 5,
    },
    {
        name: 'Kamal Hossain',
        role: 'Director, KH Supermart, Sylhet',
        quote: 'Multi-location inventory was our biggest headache. Now we can see every branch from one dashboard.',
        stars: 5,
    },
];

export default function HomePage() {
    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            {/* Nav */}
            <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <span className="text-xl font-black tracking-tight text-blue-600">RetailSaaS</span>
                    <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
                        <a href="#features" className="hover:text-gray-900 transition-colors">Features</a>
                        <a href="#pricing" className="hover:text-gray-900 transition-colors">Pricing</a>
                        <a href="#testimonials" className="hover:text-gray-900 transition-colors">Reviews</a>
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

            {/* Hero */}
            <section className="pt-32 pb-24 px-6 bg-gradient-to-b from-blue-50 to-white">
                <div className="max-w-4xl mx-auto text-center space-y-8">
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
                        All-in-one retail management platform — POS, inventory, sales analytics, customer
                        management, and integrated BDT payments. Start in minutes, scale without limits.
                    </p>
                    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
                        <Link
                            href="/signup"
                            className="group bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-10 rounded-2xl shadow-lg shadow-blue-200 transition-all flex items-center gap-3 w-full sm:w-auto justify-center"
                        >
                            Start your free trial
                            <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                        </Link>
                        <Link
                            href="/login"
                            className="bg-white hover:bg-gray-50 text-gray-700 font-bold py-4 px-10 rounded-2xl border border-gray-200 transition-colors w-full sm:w-auto text-center"
                        >
                            Sign in to dashboard
                        </Link>
                    </div>
                    <p className="text-sm text-gray-400">No credit card required &bull; 14-day free trial &bull; Cancel anytime</p>
                </div>
            </section>

            {/* Features */}
            <section id="features" className="py-24 px-6 bg-white">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">Everything your store needs</h2>
                        <p className="text-gray-500 text-lg max-w-xl mx-auto">
                            One platform to replace your spreadsheets, paper ledgers, and disconnected tools.
                        </p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {FEATURES.map(({ icon: Icon, title, desc }) => (
                            <div key={title} className="p-6 rounded-2xl border border-gray-100 hover:border-blue-100 hover:shadow-md transition-all group">
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

            {/* Stats */}
            <section className="py-16 px-6 bg-blue-600">
                <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center text-white">
                    {[
                        { value: '500+', label: 'Active stores' },
                        { value: '৳ 2Cr+', label: 'Sales processed daily' },
                        { value: '99.9%', label: 'Uptime SLA' },
                        { value: '< 1s', label: 'POS transaction time' },
                    ].map(({ value, label }) => (
                        <div key={label}>
                            <div className="text-4xl font-black mb-1">{value}</div>
                            <div className="text-blue-200 text-sm font-medium">{label}</div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Testimonials */}
            <section id="testimonials" className="py-24 px-6 bg-gray-50">
                <div className="max-w-6xl mx-auto">
                    <h2 className="text-4xl font-black tracking-tight text-center mb-16">Trusted by retailers across Bangladesh</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                        {TESTIMONIALS.map(({ name, role, quote, stars }) => (
                            <div key={name} className="bg-white p-8 rounded-2xl border border-gray-100 shadow-sm">
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

            {/* Pricing */}
            <section id="pricing" className="py-24 px-6 bg-white">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="text-4xl font-black tracking-tight mb-4">Simple, transparent pricing</h2>
                        <p className="text-gray-500 text-lg">All plans include a 14-day free trial. No setup fees.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-2xl mx-auto">
                        {PLANS.map((plan) => (
                            <div
                                key={plan.name}
                                className={`p-8 rounded-2xl border-2 ${plan.highlight
                                    ? 'border-blue-600 bg-blue-50 shadow-xl shadow-blue-100'
                                    : 'border-gray-200 bg-white'
                                }`}
                            >
                                {plan.highlight && (
                                    <div className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3">Most popular</div>
                                )}
                                <h3 className="text-2xl font-black mb-1">{plan.name}</h3>
                                <div className="flex items-baseline gap-1 mb-6">
                                    <span className="text-4xl font-black">৳ {plan.price.toLocaleString()}</span>
                                    <span className="text-gray-400 text-sm">/ {plan.period}</span>
                                </div>
                                <ul className="space-y-3 mb-8">
                                    {plan.features.map((f) => (
                                        <li key={f} className="flex items-center gap-3 text-sm">
                                            <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                                            {f}
                                        </li>
                                    ))}
                                </ul>
                                <Link
                                    href="/signup"
                                    className={`block text-center font-bold py-3 rounded-xl transition-colors ${plan.highlight
                                        ? 'bg-blue-600 hover:bg-blue-700 text-white'
                                        : 'bg-gray-900 hover:bg-gray-700 text-white'
                                    }`}
                                >
                                    Get started
                                </Link>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* CTA */}
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

            {/* Footer */}
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
