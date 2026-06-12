import Link from 'next/link';

export default function MarketingFooter() {
    return (
        <footer className="py-10 px-6 border-t border-gray-100 bg-white">
            <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                <span className="font-black text-lg text-blue-600">RetailSaaS</span>
                <div className="flex flex-wrap items-center justify-center gap-6">
                    <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms of Service</Link>
                    <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
                    <Link href="/refund" className="hover:text-gray-700 transition-colors">Refund Policy</Link>
                    <Link href="/sla" className="hover:text-gray-700 transition-colors">SLA</Link>
                    <Link href="/contact" className="hover:text-gray-700 transition-colors">Contact</Link>
                    <Link href="/status" className="hover:text-gray-700 transition-colors">Status</Link>
                    <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
                    <Link href="/signup" className="hover:text-gray-700 transition-colors">Sign up</Link>
                </div>
                <span>&copy; {new Date().getFullYear()} RetailSaaS. All rights reserved.</span>
            </div>
        </footer>
    );
}