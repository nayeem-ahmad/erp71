import Link from 'next/link';

export const metadata = {
    title: 'Terms of Service — RetailSaaS',
    description: 'Terms of Service governing use of the RetailSaaS platform',
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-white font-sans text-gray-900">

            {/* Nav */}
            <header className="fixed top-0 inset-x-0 z-50 bg-white/90 backdrop-blur border-b border-gray-100">
                <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="text-xl font-black tracking-tight text-blue-600">RetailSaaS</Link>
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

            {/* Content */}
            <main className="pt-28 pb-24 px-6">
                <div className="max-w-3xl mx-auto">

                    <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2">Terms of Service</h1>
                    <p className="text-sm text-gray-400 mb-12">Last updated: May 2026</p>

                    <div className="space-y-10 text-gray-700 leading-relaxed">

                        {/* 1 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Acceptance of Terms</h2>
                            <p>
                                By accessing or using the RetailSaaS platform (&ldquo;Service&rdquo;), you agree to be bound by
                                these Terms of Service (&ldquo;Terms&rdquo;). If you are entering into these Terms on behalf of a
                                business or organisation, you represent that you have the authority to bind that entity.
                                If you do not agree to these Terms, do not use the Service.
                            </p>
                        </section>

                        {/* 2 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Description of Service</h2>
                            <p>
                                RetailSaaS is a cloud-based retail management platform providing point-of-sale (POS),
                                inventory management, sales analytics, customer relationship management, and integrated
                                BDT payment processing for businesses operating in Bangladesh and internationally.
                                The Service is provided on a subscription basis as further described in Section 4.
                            </p>
                        </section>

                        {/* 3 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Account Registration</h2>
                            <p className="mb-3">
                                To use the Service you must create an account by providing accurate and complete
                                information including your legal name, business name, and a valid email address. You are
                                responsible for:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>Maintaining the confidentiality of your account credentials.</li>
                                <li>All activity that occurs under your account.</li>
                                <li>Notifying us immediately at <a href="mailto:support@retailsaas.app" className="text-blue-600 hover:underline">support@retailsaas.app</a> of any unauthorised access.</li>
                                <li>Ensuring that all staff accounts you create comply with these Terms.</li>
                            </ul>
                            <p className="mt-3">
                                You must be at least 18 years old and legally capable of entering into binding contracts
                                under the laws of Bangladesh to register for the Service.
                            </p>
                        </section>

                        {/* 4 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Subscription &amp; Billing</h2>
                            <p className="mb-3">
                                RetailSaaS offers the following subscription tiers, priced in Bangladeshi Taka (BDT):
                            </p>
                            <div className="bg-gray-50 rounded-xl p-4 text-sm mb-4 space-y-1">
                                <p><strong>Free</strong> — ৳ 0/month (single store, limited features)</p>
                                <p><strong>Basic</strong> — ৳ 1,499/month</p>
                                <p><strong>Standard</strong> — ৳ 2,999/month</p>
                                <p><strong>Premium</strong> — ৳ 3,999/month (unlimited stores and staff)</p>
                            </div>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Free trial.</strong> Paid plans include a 14-day free trial. No credit card is
                                    required to start a trial. At the end of the trial period your subscription will
                                    automatically commence unless you downgrade to the Free plan.
                                </li>
                                <li>
                                    <strong>Auto-renewal.</strong> Subscriptions renew automatically each calendar month on
                                    the anniversary of your start date. You authorise RetailSaaS to charge the applicable
                                    BDT amount to your payment method on file on each renewal date.
                                </li>
                                <li>
                                    <strong>Cancellation.</strong> You may cancel or downgrade your subscription at any time
                                    from Account Settings. Cancellation takes effect at the end of the current billing period;
                                    no partial-month refunds are issued unless required by applicable law.
                                </li>
                                <li>
                                    <strong>Taxes.</strong> All prices are exclusive of VAT and any other taxes imposed by
                                    the National Board of Revenue (NBR) of Bangladesh. You are responsible for remitting
                                    applicable taxes.
                                </li>
                                <li>
                                    <strong>Payment methods.</strong> We accept bKash, Nagad, SSL Wireless, and major
                                    debit/credit cards. All transactions are processed in BDT.
                                </li>
                            </ul>
                        </section>

                        {/* 5 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Acceptable Use</h2>
                            <p className="mb-3">You agree not to use the Service to:</p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>Violate any applicable law or regulation, including those of Bangladesh.</li>
                                <li>Process transactions for illegal goods or services.</li>
                                <li>Reverse-engineer, decompile, or attempt to extract the source code of the platform.</li>
                                <li>Introduce malicious code, conduct denial-of-service attacks, or scrape data at scale.</li>
                                <li>Resell or sublicense access to the Service without our express written consent.</li>
                                <li>Impersonate another person or entity.</li>
                            </ul>
                            <p className="mt-3">
                                We reserve the right to suspend or terminate accounts found to be in violation of this
                                section without prior notice.
                            </p>
                        </section>

                        {/* 6 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Data &amp; Privacy</h2>
                            <p>
                                Your use of the Service is also governed by our{' '}
                                <Link href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>,
                                which is incorporated into these Terms by reference. By using the Service you consent
                                to the collection and use of your data as described in that policy. All business and
                                transaction data you enter remains your property; RetailSaaS acts as a data processor
                                on your behalf.
                            </p>
                        </section>

                        {/* 7 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Intellectual Property</h2>
                            <p>
                                The Service, including all software, designs, trademarks, and documentation, is owned
                                by RetailSaaS Ltd. and protected by applicable intellectual property laws. These Terms
                                grant you a limited, non-exclusive, non-transferable licence to access and use the
                                Service for your internal business purposes. No other rights are granted.
                            </p>
                            <p className="mt-3">
                                Your business data, logos, and content remain your intellectual property. You grant
                                RetailSaaS a limited licence to store, display, and process that content solely for
                                the purpose of providing the Service.
                            </p>
                        </section>

                        {/* 8 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Limitation of Liability</h2>
                            <p className="mb-3">
                                To the maximum extent permitted by law:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    The Service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties of any kind,
                                    express or implied, including fitness for a particular purpose or uninterrupted availability.
                                </li>
                                <li>
                                    RetailSaaS&apos;s total aggregate liability arising from or related to these Terms shall not
                                    exceed the amount you paid for the Service in the three months preceding the claim.
                                </li>
                                <li>
                                    RetailSaaS shall not be liable for any indirect, incidental, special, or consequential
                                    damages, including lost profits or lost data, even if advised of the possibility.
                                </li>
                            </ul>
                        </section>

                        {/* 9 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">9. Termination</h2>
                            <p>
                                Either party may terminate these Terms at any time. You may do so by cancelling your
                                subscription and deleting your account. RetailSaaS may suspend or terminate your access
                                immediately for breach of these Terms, non-payment, or if required by law. Upon
                                termination, your right to use the Service ceases. You may export your data for 30 days
                                following termination, after which it will be deleted in accordance with our{' '}
                                <Link href="/privacy" className="text-blue-600 hover:underline">Privacy Policy</Link>.
                            </p>
                        </section>

                        {/* 10 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">10. Governing Law</h2>
                            <p>
                                These Terms are governed by and construed in accordance with the laws of the People&apos;s
                                Republic of Bangladesh. Any dispute arising from or in connection with these Terms shall
                                be subject to the exclusive jurisdiction of the courts of Dhaka, Bangladesh. Nothing in
                                this section limits any statutory consumer rights you may have under applicable
                                Bangladeshi law.
                            </p>
                        </section>

                        {/* 11 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">11. Contact</h2>
                            <p>
                                For questions about these Terms, please contact us:
                            </p>
                            <div className="mt-3 bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                <p><strong>RetailSaaS Ltd.</strong></p>
                                <p>Dhaka, Bangladesh</p>
                                <p>Email: <a href="mailto:legal@retailsaas.app" className="text-blue-600 hover:underline">legal@retailsaas.app</a></p>
                                <p>Support: <a href="mailto:support@retailsaas.app" className="text-blue-600 hover:underline">support@retailsaas.app</a></p>
                            </div>
                        </section>

                    </div>
                </div>
            </main>

            {/* Footer */}
            <footer className="py-10 px-6 border-t border-gray-100 bg-white">
                <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-gray-400">
                    <span className="font-black text-lg text-blue-600">RetailSaaS</span>
                    <div className="flex items-center gap-6">
                        <Link href="/terms" className="hover:text-gray-700 transition-colors">Terms of Service</Link>
                        <Link href="/privacy" className="hover:text-gray-700 transition-colors">Privacy Policy</Link>
                        <Link href="/login" className="hover:text-gray-700 transition-colors">Sign in</Link>
                        <Link href="/signup" className="hover:text-gray-700 transition-colors">Sign up</Link>
                    </div>
                    <span>&copy; {new Date().getFullYear()} RetailSaaS. All rights reserved.</span>
                </div>
            </footer>
        </div>
    );
}
