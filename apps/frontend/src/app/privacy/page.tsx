import Link from 'next/link';

export const metadata = {
    title: 'Privacy Policy — RetailSaaS',
    description: 'How RetailSaaS collects, uses, and protects your data',
};

export default function PrivacyPage() {
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

                    <h1 className="text-4xl font-black tracking-tight text-gray-900 mb-2">Privacy Policy</h1>
                    <p className="text-sm text-gray-400 mb-12">Last updated: May 2026</p>

                    <div className="space-y-10 text-gray-700 leading-relaxed">

                        {/* 1 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Information We Collect</h2>
                            <p className="mb-3">
                                We collect information you provide directly when you create an account or use the Service:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li><strong>Account data:</strong> your full name, email address, and password (stored as a bcrypt hash).</li>
                                <li><strong>Business data:</strong> organisation name, store name(s), and subscription plan selection.</li>
                                <li><strong>Transaction data:</strong> sales records, inventory movements, customer profiles, and payment references you enter while using the platform.</li>
                                <li><strong>Usage data:</strong> pages visited, features used, browser type, IP address, and timestamps — collected to improve reliability and performance.</li>
                                <li><strong>Communications:</strong> any messages you send to our support team.</li>
                            </ul>
                            <p className="mt-3 text-sm">
                                We do not collect payment card numbers directly. All payment processing is handled by
                                certified third-party processors (bKash, Nagad, SSL Wireless) under their own privacy policies.
                            </p>
                        </section>

                        {/* 2 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">2. How We Use Your Information</h2>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>To create and manage your account and workspace.</li>
                                <li>To provide and operate the RetailSaaS platform and all its features.</li>
                                <li>To send transactional emails: email verification, password resets, invoices, low-stock alerts, and staff invitations.</li>
                                <li>To calculate, collect, and remit subscription fees in BDT.</li>
                                <li>To detect, investigate, and prevent fraudulent transactions and abuse of the Service.</li>
                                <li>To comply with legal obligations, including NBR (National Board of Revenue) tax record-keeping requirements.</li>
                                <li>To analyse aggregate usage patterns and improve the platform (using anonymised data only).</li>
                            </ul>
                            <p className="mt-3 text-sm">
                                We will not use your data for advertising, sell it to data brokers, or share it with
                                third parties for their own marketing purposes.
                            </p>
                        </section>

                        {/* 3 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Data Sharing</h2>
                            <p className="mb-3">
                                We share personal data only in the following circumstances:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Service providers:</strong> hosting (cloud infrastructure), transactional email delivery,
                                    error monitoring, and analytics tools that process data on our behalf under strict data processing
                                    agreements.
                                </li>
                                <li>
                                    <strong>Payment processors:</strong> only the minimum data required to complete a transaction is
                                    shared with bKash, Nagad, or SSL Wireless.
                                </li>
                                <li>
                                    <strong>Legal compliance:</strong> if required by Bangladeshi law, court order, or regulatory
                                    authority (including NBR audit requests), we may disclose data to the extent mandated.
                                </li>
                                <li>
                                    <strong>Business transfers:</strong> in the event of a merger, acquisition, or sale of assets,
                                    your data may be transferred as part of that transaction. We will notify you in advance.
                                </li>
                            </ul>
                        </section>

                        {/* 4 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Data Retention</h2>
                            <div className="bg-gray-50 rounded-xl p-4 text-sm space-y-2">
                                <p><strong>Account &amp; business data:</strong> retained while your account is active and for 30 days after account deletion, after which it is permanently purged.</p>
                                <p><strong>Transaction records:</strong> retained for 7 years to comply with Bangladesh income tax and VAT record-keeping requirements under the NBR.</p>
                                <p><strong>Audit logs:</strong> retained for 90 days, then automatically deleted.</p>
                                <p><strong>Security tokens</strong> (email verification, password reset, staff invitations): purged after 7 days regardless of whether they have been used.</p>
                                <p><strong>Support communications:</strong> retained for 2 years.</p>
                            </div>
                            <p className="mt-3 text-sm">
                                After the applicable retention period, data is securely and irreversibly deleted from all
                                production systems and backups.
                            </p>
                        </section>

                        {/* 5 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Security</h2>
                            <p className="mb-3">
                                We implement industry-standard technical and organisational measures to protect your data:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>All data is transmitted over TLS 1.2 or higher — plain HTTP is rejected.</li>
                                <li>Passwords are hashed using bcrypt with a work factor of 12.</li>
                                <li>Sensitive tokens (email verification, password reset) are stored as SHA-256 hashes; plaintext is never persisted.</li>
                                <li>API endpoints are protected by JWT authentication and per-route role authorisation.</li>
                                <li>Rate limiting is applied to authentication endpoints to mitigate brute-force attacks.</li>
                                <li>All privileged actions are recorded in tamper-evident audit logs retained for 90 days.</li>
                                <li>Database access is restricted to application servers via private network; no public database ports are exposed.</li>
                            </ul>
                            <p className="mt-3 text-sm">
                                No security system is perfect. In the event of a data breach affecting your personal
                                information we will notify you within 72 hours of becoming aware of it.
                            </p>
                        </section>

                        {/* 6 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">6. Your Rights</h2>
                            <p className="mb-3">
                                You have the following rights regarding your personal data:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Access &amp; portability:</strong> export a copy of all personal data associated with your
                                    account in JSON format via{' '}
                                    <span className="font-mono bg-gray-100 px-1 rounded text-xs">Account Settings → Data &amp; Privacy → Export data</span>
                                    {' '}(API endpoint: <span className="font-mono bg-gray-100 px-1 rounded text-xs">/account/data-export</span>).
                                </li>
                                <li>
                                    <strong>Correction:</strong> update your name, email, and business information at any time from your profile settings.
                                </li>
                                <li>
                                    <strong>Deletion:</strong> request permanent deletion of your account and personal data via{' '}
                                    <span className="font-mono bg-gray-100 px-1 rounded text-xs">Account Settings → Data &amp; Privacy → Delete account</span>
                                    {' '}(API endpoint: <span className="font-mono bg-gray-100 px-1 rounded text-xs">/account/data-deletion-request</span>).
                                    Note that transaction records may be retained for the legally required 7-year period.
                                </li>
                                <li>
                                    <strong>Restriction of processing:</strong> you may object to certain uses of your data by contacting us at{' '}
                                    <a href="mailto:privacy@retailsaas.app" className="text-blue-600 hover:underline">privacy@retailsaas.app</a>.
                                </li>
                            </ul>
                            <p className="mt-3 text-sm">
                                We will respond to all data rights requests within 30 days. Identity verification may
                                be required before we process a request.
                            </p>
                        </section>

                        {/* 7 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Cookies</h2>
                            <p>
                                We use only essential session cookies required for authentication and CSRF protection.
                                We do not set any advertising, tracking, or analytics cookies. Third-party payment
                                widgets (bKash, Nagad) may set their own cookies when you interact with them; please
                                refer to their respective privacy policies.
                            </p>
                        </section>

                        {/* 8 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Bangladesh Data Protection</h2>
                            <p className="mb-3">
                                RetailSaaS is operated by RetailSaaS Ltd., a company registered in Bangladesh. We
                                comply with applicable Bangladeshi data protection requirements, including:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Digital Security Act 2018 / Cyber Security Act 2023:</strong> we maintain
                                    appropriate safeguards for digital personal data and report material security
                                    incidents to the relevant authorities as required.
                                </li>
                                <li>
                                    <strong>NBR compliance:</strong> financial transaction data is retained for the
                                    7-year period required by Bangladesh income tax and VAT regulations.
                                </li>
                                <li>
                                    <strong>Cross-border transfers:</strong> some service providers (e.g., cloud hosting,
                                    error monitoring) may process data outside Bangladesh. We ensure that such transfers
                                    are subject to adequate data protection safeguards.
                                </li>
                            </ul>
                        </section>

                        {/* 9 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">9. Contact</h2>
                            <p>
                                For questions, concerns, or to exercise your data rights, please contact our Data
                                Protection team:
                            </p>
                            <div className="mt-3 bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                <p><strong>RetailSaaS Ltd.</strong></p>
                                <p>Dhaka, Bangladesh</p>
                                <p>Email: <a href="mailto:privacy@retailsaas.app" className="text-blue-600 hover:underline">privacy@retailsaas.app</a></p>
                                <p>Support: <a href="mailto:support@retailsaas.app" className="text-blue-600 hover:underline">support@retailsaas.app</a></p>
                            </div>
                            <p className="mt-3 text-sm">
                                For terms of service questions, see our{' '}
                                <Link href="/terms" className="text-blue-600 hover:underline">Terms of Service</Link>.
                            </p>
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
