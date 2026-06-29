'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export default function RefundPage() {
    const { t } = useI18n();
    const m = t.marketing.legal;
    const p = m.refund;

    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            {/* Nav */}
            <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="text-xl font-black tracking-tight text-blue-600">ERP71</Link>
                    <div className="flex items-center gap-3">
                        <Link href="/login" className="text-sm font-semibold text-gray-700 hover:text-gray-900 px-4 py-2">
                            {m.signIn}
                        </Link>
                        <Link
                            href="/signup"
                            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold px-5 py-2 rounded-xl transition-colors"
                        >
                            {m.startFreeTrial}
                        </Link>
                    </div>
                </div>
            </header>

            {/* Content */}
            <main className="pt-28 pb-24 px-6">
                <div className="max-w-3xl mx-auto">

                    <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2">{p.title}</h1>
                    <p className="text-sm text-gray-400 mb-12">{m.lastUpdated}</p>

                    <div className="space-y-10 text-gray-700 leading-relaxed">

                        {/* 1 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Overview</h2>
                            <p>
                                All ERP71 subscriptions are prepaid on a monthly basis in Bangladeshi Taka (BDT).
                                When you subscribe or renew, you pay in advance for the upcoming billing period.
                                If a refund is approved, it will be prorated to the number of unused days remaining
                                in your current billing period at the time the refund is processed.
                            </p>
                        </section>

                        {/* 2 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Cancellation</h2>
                            <p className="mb-3">
                                You may cancel your subscription at any time with no cancellation fee. To cancel:
                            </p>
                            <ol className="list-decimal pl-6 space-y-2 text-sm">
                                <li>Log in to your ERP71 account.</li>
                                <li>Go to <strong>Dashboard &rarr; Billing &rarr; Cancel Subscription</strong>.</li>
                                <li>Confirm the cancellation when prompted.</li>
                            </ol>
                            <p className="mt-3">
                                Your access to all paid features will continue until the end of the current billing
                                period. After that date your account will revert to the Free plan. No data is deleted
                                automatically on cancellation — you retain full access to your data on the Free plan
                                and may export it at any time.
                            </p>
                            <div className="mt-4 bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
                                <strong>No cancellation fees.</strong> We do not charge any fee for cancelling your
                                subscription, regardless of how long you have been a customer.
                            </div>
                        </section>

                        {/* 3 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Refund Eligibility</h2>
                            <p className="mb-3">You may be eligible for a full or partial refund in the following circumstances:</p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>7-day satisfaction guarantee.</strong> If you are not satisfied with the
                                    Service, you may request a full refund within 7 calendar days of your first paid
                                    payment. This applies to new subscriptions only (not renewals).
                                </li>
                                <li>
                                    <strong>Technical issues preventing use.</strong> If a verified technical fault
                                    on our end rendered the platform substantially unusable for an extended period, we
                                    will issue a prorated credit or refund for the affected days upon investigation.
                                </li>
                                <li>
                                    <strong>Duplicate charges.</strong> If you were charged more than once for the same
                                    billing period due to a payment processing error, the duplicate amount will be
                                    refunded in full within 5 business days of our confirmation.
                                </li>
                            </ul>
                        </section>

                        {/* 4 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Non-Refundable Cases</h2>
                            <p className="mb-3">Refunds will <strong>not</strong> be issued in the following situations:</p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    Partial months used beyond the 7-day satisfaction window. Once the 7-day period has
                                    passed, the subscription fee for that billing cycle is non-refundable.
                                </li>
                                <li>
                                    Voluntary cancellations made after the 7-day satisfaction window has elapsed.
                                </li>
                                <li>
                                    Accounts on the Free (demo) plan. The Free plan carries no charge and therefore
                                    no refund is applicable.
                                </li>
                                <li>
                                    Fees charged for add-ons, SMS credits, or third-party integrations (bKash, Nagad,
                                    SSL Wireless) that have already been consumed or passed through to the provider.
                                </li>
                            </ul>
                        </section>

                        {/* 5 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">5. How to Request a Refund</h2>
                            <p className="mb-3">
                                To request a refund, email our billing team at{' '}
                                <a href="mailto:billing@erp71.com" className="text-blue-600 hover:underline">billing@erp71.com</a>{' '}
                                with the following information:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>Your registered email address and business name.</li>
                                <li>Your order or invoice ID (found in Dashboard &rarr; Billing &rarr; Invoices).</li>
                                <li>The reason for your refund request.</li>
                                <li>Any supporting screenshots or error details (for technical issues).</li>
                            </ul>
                            <div className="mt-4 bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                <p><strong>Processing time:</strong> Approved refunds are processed within <strong>5–7 business days</strong>.</p>
                                <p><strong>Refund method:</strong> Refunds are returned via the original payment method —
                                bKash, Nagad, or your bank account. We do not issue refunds to a different payment
                                instrument than the one used for the original transaction.</p>
                            </div>
                        </section>

                        {/* 6 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Subscription Changes</h2>
                            <ul className="list-disc pl-6 space-y-3 text-sm">
                                <li>
                                    <strong>Upgrades.</strong> When you upgrade to a higher-tier plan mid-cycle, the
                                    price difference is prorated immediately and charged to your payment method on file.
                                    Your new plan features are activated instantly.
                                </li>
                                <li>
                                    <strong>Downgrades.</strong> When you downgrade to a lower-tier plan, the change
                                    takes effect at the start of your next billing cycle. You retain access to your
                                    current plan&apos;s features until then. No partial refund is issued for the remaining
                                    days on the higher-tier plan.
                                </li>
                            </ul>
                        </section>

                        {/* 7 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Contact</h2>
                            <p>
                                For any questions about this policy or your specific situation, please reach out to
                                our billing team:
                            </p>
                            <div className="mt-3 bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                <p><strong>ERP71 Ltd.</strong></p>
                                <p>Dhaka, Bangladesh</p>
                                <p>Billing: <a href="mailto:billing@erp71.com" className="text-blue-600 hover:underline">billing@erp71.com</a></p>
                                <p>Support: <a href="mailto:support@erp71.com" className="text-blue-600 hover:underline">support@erp71.com</a></p>
                            </div>
                        </section>

                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="py-10 px-6 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                    <span className="font-black text-lg text-blue-600">ERP71</span>
                    <div className="flex items-center gap-6">
                        <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
                        <Link href="/refund" className="hover:text-gray-700 transition-colors">Refund Policy</Link>
                        <Link href="/sla" className="hover:text-gray-700 transition-colors">SLA</Link>
                        <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
                        <Link href="/signup" className="hover:text-gray-700 transition-colors">Sign up</Link>
                    </div>
                    <span>&copy; {new Date().getFullYear()} ERP71. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
}
