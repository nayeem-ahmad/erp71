'use client';

import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

export default function SlaPage() {
    const { t } = useI18n();
    const m = t.marketing.legal;
    const p = m.sla;

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
                            <h2 className="text-xl font-bold text-gray-900 mb-3">1. Service Availability</h2>
                            <p className="mb-3">
                                ERP71 commits to a monthly uptime of <strong>99.9%</strong> for all paid subscription
                                tiers. This corresponds to a maximum of approximately <strong>43.8 minutes of unplanned
                                downtime per calendar month</strong>.
                            </p>
                            <p className="mb-3">
                                Uptime is measured as the percentage of minutes in a calendar month during which the
                                core platform (POS, inventory, billing) is accessible and operational, excluding the
                                following:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>Scheduled maintenance windows (see Section 2).</li>
                                <li>
                                    Outages caused by force majeure events, including natural disasters, government
                                    actions, civil unrest, or widespread internet infrastructure failures in Bangladesh.
                                </li>
                                <li>
                                    Downtime attributable to third-party services outside our direct control (see
                                    Section 5).
                                </li>
                                <li>
                                    Issues caused by customer-side factors such as local network outages, browser
                                    incompatibility, or misconfigured devices.
                                </li>
                            </ul>
                            <div className="mt-4 bg-blue-50 rounded-xl p-4 text-sm text-blue-800">
                                Platform administrators can view live system health in the ERP71 app after signing in.
                                Affected customers are notified by email during confirmed incidents.
                            </div>
                        </section>

                        {/* 2 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">2. Scheduled Maintenance</h2>
                            <p className="mb-3">
                                Routine maintenance is performed during the following standard window to minimise
                                disruption to retail operations:
                            </p>
                            <div className="bg-gray-50 rounded-xl p-4 text-sm mb-4 space-y-1">
                                <p><strong>Day:</strong> Every Sunday</p>
                                <p><strong>Time:</strong> 02:00 – 04:00 BST (Bangladesh Standard Time, UTC+6)</p>
                                <p><strong>Duration:</strong> Up to 2 hours (typically less)</p>
                            </div>
                            <p>
                                We will provide at least <strong>24 hours&apos; advance notice</strong> of any scheduled
                                maintenance via email to the primary account holder and via an in-app banner.
                                Scheduled maintenance time does not count against the 99.9% uptime commitment.
                            </p>
                        </section>

                        {/* 3 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">3. Support Response Times</h2>
                            <p className="mb-4">
                                Our support team is reachable at{' '}
                                <a href="mailto:support@erp71.com" className="text-blue-600 hover:underline">support@erp71.com</a>.
                                We target the following first-response times based on issue priority:
                            </p>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50">
                                            <th className="text-left font-bold text-gray-900 px-4 py-3 border border-gray-200 rounded-tl-lg">Priority</th>
                                            <th className="text-left font-bold text-gray-900 px-4 py-3 border border-gray-200">Examples</th>
                                            <th className="text-left font-bold text-gray-900 px-4 py-3 border border-gray-200 rounded-tr-lg">First Response</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold text-red-700 bg-red-50">Critical (P1)</td>
                                            <td className="px-4 py-3 border border-gray-200">Data loss, payment processing failure, complete platform outage</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">2 hours</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold text-orange-700 bg-orange-50">High (P2)</td>
                                            <td className="px-4 py-3 border border-gray-200">Core feature broken (POS, inventory, reports), no workaround</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">8 hours</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold text-yellow-700 bg-yellow-50">Medium (P3)</td>
                                            <td className="px-4 py-3 border border-gray-200">Feature degraded or slow, workaround available</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">24 hours</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold text-gray-700">Low (P4)</td>
                                            <td className="px-4 py-3 border border-gray-200">General questions, how-to requests, feature feedback</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">48 hours</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <p className="mt-3 text-sm text-gray-500">
                                Response times are measured during Bangladesh business hours (Sunday–Thursday, 09:00–18:00 BST)
                                unless otherwise noted. P1 incidents are handled around the clock.
                            </p>
                        </section>

                        {/* 4 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">4. Incident Response Process</h2>
                            <p className="mb-3">When a service incident is detected, we follow this process:</p>
                            <ol className="list-decimal pl-6 space-y-3 text-sm">
                                <li>
                                    <strong>Detection.</strong> Automated monitoring alerts trigger within minutes of
                                    a service degradation or outage being detected.
                                </li>
                                <li>
                                    <strong>On-call page.</strong> The on-call engineer is paged immediately and begins
                                    investigation.
                                </li>
                                <li>
                                    <strong>Customer notification.</strong> Affected customers are notified by email{' '}
                                    <strong>within 15 minutes</strong> of confirmation, with a summary of impact and
                                    expected resolution time.
                                </li>
                                <li>
                                    <strong>Resolution.</strong> Once the issue is resolved, affected customers receive
                                    a follow-up email confirming service restoration.
                                </li>
                                <li>
                                    <strong>Post-mortem.</strong> For all P1 (Critical) incidents, we publish a written
                                    post-mortem within 5 business days detailing the root cause, timeline, and steps
                                    taken to prevent recurrence.
                                </li>
                            </ol>
                        </section>

                        {/* 5 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">5. Exclusions</h2>
                            <p className="mb-3">
                                The uptime commitment and support response targets in this SLA do not apply to outages
                                or degradation caused by:
                            </p>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    <strong>Third-party payment services</strong> — bKash, Nagad, SSL Wireless, and any
                                    other payment gateway. Their availability is governed by their own service agreements.
                                </li>
                                <li>
                                    <strong>Infrastructure providers</strong> — cloud hosting
                                    providers, or CDN services.
                                </li>
                                <li>
                                    <strong>Customer-side issues</strong> — ISP outages, local network failures,
                                    end-user hardware or browser problems, or actions taken by the customer or their
                                    staff that affect platform access.
                                </li>
                                <li>
                                    <strong>Force majeure</strong> — events beyond our reasonable control, including
                                    natural disasters, acts of government, war, civil unrest, or nationwide internet
                                    disruptions in Bangladesh.
                                </li>
                            </ul>
                        </section>

                        {/* 6 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">6. SLA Credits</h2>
                            <p className="mb-4">
                                If monthly uptime falls below the 99.9% commitment due to causes within our control,
                                eligible customers on paid plans may request a service credit applied to their next invoice:
                            </p>
                            <div className="overflow-x-auto mb-4">
                                <table className="w-full text-sm border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50">
                                            <th className="text-left font-bold text-gray-900 px-4 py-3 border border-gray-200 rounded-tl-lg">Monthly Uptime</th>
                                            <th className="text-left font-bold text-gray-900 px-4 py-3 border border-gray-200 rounded-tr-lg">Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200">99.0% – &lt; 99.9%</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">10% of monthly fee</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200">95.0% – &lt; 99.0%</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">25% of monthly fee</td>
                                        </tr>
                                        <tr>
                                            <td className="px-4 py-3 border border-gray-200">&lt; 95.0%</td>
                                            <td className="px-4 py-3 border border-gray-200 font-semibold">50% of monthly fee</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                            <ul className="list-disc pl-6 space-y-2 text-sm">
                                <li>
                                    Credits are applied to the next invoice and cannot be redeemed for cash or used
                                    against outstanding balances.
                                </li>
                                <li>
                                    Credit requests must be submitted to{' '}
                                    <a href="mailto:support@erp71.com" className="text-blue-600 hover:underline">support@erp71.com</a>{' '}
                                    within <strong>30 calendar days</strong> of the end of the affected month.
                                </li>
                                <li>
                                    Maximum credit in any single month is capped at 50% of that month&apos;s subscription fee.
                                </li>
                            </ul>
                        </section>

                        {/* 7 */}
                        <section>
                            <h2 className="text-xl font-bold text-gray-900 mb-3">7. Contact</h2>
                            <p>
                                For SLA credit requests, incident inquiries, or questions about this agreement, please
                                contact our support team:
                            </p>
                            <div className="mt-3 bg-gray-50 rounded-xl p-4 text-sm space-y-1">
                                <p><strong>ERP71 Ltd.</strong></p>
                                <p>Dhaka, Bangladesh</p>
                                <p>Support: <a href="mailto:support@erp71.com" className="text-blue-600 hover:underline">support@erp71.com</a></p>
                                <p>Incidents: email updates to affected account holders</p>
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
