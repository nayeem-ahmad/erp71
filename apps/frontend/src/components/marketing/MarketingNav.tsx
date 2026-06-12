import Link from 'next/link';

type MarketingNavProps = {
    active?: 'home' | 'pricing';
};

export default function MarketingNav({ active = 'home' }: MarketingNavProps) {
    return (
        <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
            <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                <Link href="/" className="text-xl font-black tracking-tight text-blue-600">
                    RetailSaaS
                </Link>
                <nav className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-600">
                    <Link href="/#features" className="hover:text-gray-900 transition-colors">Features</Link>
                    <Link
                        href="/pricing"
                        className={active === 'pricing' ? 'text-blue-600 font-semibold' : 'hover:text-gray-900 transition-colors'}
                    >
                        Pricing
                    </Link>
                    <Link href="/#testimonials" className="hover:text-gray-900 transition-colors">Reviews</Link>
                    <Link href="/contact" className="hover:text-gray-900 transition-colors">Contact</Link>
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
    );
}