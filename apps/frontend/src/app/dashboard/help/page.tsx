'use client';

import { useState } from 'react';
import { HelpCircle, ChevronDown, ChevronRight, ExternalLink, BookOpen, MessageCircle } from 'lucide-react';

interface FaqItem {
    q: string;
    a: string;
}

interface Section {
    title: string;
    icon: string;
    faqs: FaqItem[];
}

const SECTIONS: Section[] = [
    {
        title: 'Getting Started',
        icon: '🚀',
        faqs: [
            {
                q: 'How do I add my first product?',
                a: 'Go to Inventory → Products and click "Add Product". Fill in the name, SKU, price, and stock quantity. You can also bulk import products using a CSV file via the "Import CSV" button.',
            },
            {
                q: 'How do I create a store and start selling?',
                a: 'Go to Setup → Stores and create your store. Then navigate to POS (Point of Sale) to start ringing up sales. Select products, enter payment, and complete the transaction.',
            },
            {
                q: 'How do I invite staff members?',
                a: 'Go to Settings → Users and click "Invite". Enter the staff member\'s email and assign a role (Cashier, Manager, etc.). They\'ll receive an invitation email to join your account.',
            },
            {
                q: 'What subscription plans are available?',
                a: 'We offer FREE, BASIC, STANDARD, and PREMIUM plans. Visit /pricing to compare features. You can upgrade anytime from the Billing section in your dashboard.',
            },
        ],
    },
    {
        title: 'Point of Sale (POS)',
        icon: '🛒',
        faqs: [
            {
                q: 'How does the offline POS work?',
                a: 'The POS works offline automatically. When your internet connection drops, a yellow banner appears and sales are saved locally. When you reconnect, sales sync automatically to the server.',
            },
            {
                q: 'Can I accept multiple payment methods in one sale?',
                a: 'Yes! You can split payments across Cash, Card, bKash, Nagad, and other methods in a single transaction by adding multiple payment rows in the POS checkout screen.',
            },
            {
                q: 'How do I apply a discount to a sale?',
                a: 'In the POS checkout screen, there is a discount field where you can enter a percentage or fixed amount discount before completing the sale.',
            },
            {
                q: 'How do I print a receipt?',
                a: 'After completing a sale, a receipt preview appears with a Print button. Make sure your printer is configured and connected. Receipts include your business name, BIN (if set), VAT breakdown, and sale details.',
            },
        ],
    },
    {
        title: 'Inventory Management',
        icon: '📦',
        faqs: [
            {
                q: 'How do I track stock across multiple warehouses?',
                a: 'Go to Inventory → Warehouses to set up your warehouses. Stock is tracked per warehouse. Use Inventory → Transfers to move stock between warehouses.',
            },
            {
                q: 'How do I set up low-stock alerts?',
                a: 'On each product, set the "Reorder Level". When stock falls to or below this level, the system sends a daily low-stock alert email to your registered email address.',
            },
            {
                q: 'How do I import products in bulk?',
                a: 'Go to Inventory → Products and click "Import CSV". Download the template, fill it in with your products (name, SKU, price, stock), and upload. Products with matching SKUs are updated; new SKUs are created.',
            },
            {
                q: 'What is a stock take?',
                a: 'A stock take (stocktake) is a physical count of your inventory. Go to Inventory → Stock Takes to start a session. Count each item and the system will show variances between your count and recorded stock.',
            },
        ],
    },
    {
        title: 'Accounting',
        icon: '📊',
        faqs: [
            {
                q: 'How does double-entry accounting work in this system?',
                a: 'The system uses double-entry bookkeeping automatically. Sales create debit entries in Cash/Receivables and credit entries in Revenue. Purchases create debit entries in Inventory/Expense and credit entries in Payables.',
            },
            {
                q: 'How do I export to Tally or QuickBooks?',
                a: 'Go to Accounting → Overview and click "Export". Choose your format (Tally XML or QuickBooks IIF) and date range. The file downloads immediately and can be imported into your accounting software.',
            },
            {
                q: 'What is the Chart of Accounts?',
                a: 'The Chart of Accounts (COA) is a list of all accounts used in your business: assets, liabilities, equity, revenue, and expenses. Go to Accounting → Chart of Accounts to view and manage accounts.',
            },
        ],
    },
    {
        title: 'Billing & Subscription',
        icon: '💳',
        faqs: [
            {
                q: 'How do I upgrade my plan?',
                a: 'Go to Billing in the sidebar and click "Upgrade". Select your plan and billing cycle (monthly or yearly — yearly saves 20%). Pay via SSL Wireless using your preferred method (card, bKash, Nagad).',
            },
            {
                q: 'Can I cancel my subscription?',
                a: 'Yes. Go to Billing and click "Cancel Subscription". Your access continues until the end of the current billing period. See our Refund Policy at /refund for details.',
            },
            {
                q: 'What happens if my subscription expires?',
                a: 'You\'ll receive warning emails 7 days and 1 day before expiry. After expiry, your account is locked to read-only mode until you renew. Your data is never deleted.',
            },
        ],
    },
    {
        title: 'E-commerce Storefront',
        icon: '🌐',
        faqs: [
            {
                q: 'How do I enable my online store?',
                a: 'Go to Storefront → Settings, enable the toggle, set a URL slug (e.g. "my-shop"), and optionally add a banner message. Your public store will be at /store/your-slug.',
            },
            {
                q: 'How do customers place orders?',
                a: 'Customers visit your store URL, browse in-stock products, add to cart, and fill in their name, email, and phone. Orders appear in Storefront → Orders where you can confirm or cancel them.',
            },
            {
                q: 'Are storefront orders automatically added to inventory?',
                a: 'Currently, storefront orders need to be manually confirmed and fulfilled. Inventory deduction for storefront orders is on our roadmap for a future release.',
            },
        ],
    },
    {
        title: 'Security & Account',
        icon: '🔒',
        faqs: [
            {
                q: 'How do I enable two-factor authentication (2FA)?',
                a: 'Go to Settings → Account → 2FA tab. Click "Set Up 2FA", scan the QR code with Google Authenticator or Authy, enter the 6-digit code to verify, and save. From then on, logins require your phone.',
            },
            {
                q: 'What happens if I forget my password?',
                a: 'Click "Forgot Password" on the login page. Enter your email and you\'ll receive a password reset link valid for 1 hour. If you don\'t receive it, check your spam folder.',
            },
            {
                q: 'How do I download my data (GDPR/export)?',
                a: 'Go to Settings → Account and find "Export My Data". This generates a JSON file with all your account data. For data deletion requests, use the "Request Data Deletion" option.',
            },
        ],
    },
];

export default function HelpPage() {
    const [openSections, setOpenSections] = useState<Set<string>>(new Set(['Getting Started']));
    const [openFaqs, setOpenFaqs] = useState<Set<string>>(new Set());

    function toggleSection(title: string) {
        setOpenSections(prev => {
            const next = new Set(prev);
            if (next.has(title)) next.delete(title);
            else next.add(title);
            return next;
        });
    }

    function toggleFaq(key: string) {
        setOpenFaqs(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }

    return (
        <div className="p-6 max-w-3xl space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <HelpCircle className="h-7 w-7 text-blue-600" />
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Help Center</h1>
                    <p className="text-gray-500 text-sm">Frequently asked questions and guides</p>
                </div>
            </div>

            {/* Quick links */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <a
                    href="mailto:support@retailsaas.app"
                    className="flex items-center gap-3 p-4 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
                >
                    <MessageCircle className="h-5 w-5 text-blue-600 flex-shrink-0" />
                    <div>
                        <div className="font-medium text-sm text-blue-900">Email Support</div>
                        <div className="text-xs text-blue-600">support@retailsaas.app</div>
                    </div>
                </a>
                <a
                    href="/contact"
                    className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl hover:bg-green-100 transition-colors"
                >
                    <BookOpen className="h-5 w-5 text-green-600 flex-shrink-0" />
                    <div>
                        <div className="font-medium text-sm text-green-900">Contact Us</div>
                        <div className="text-xs text-green-600">Send a message</div>
                    </div>
                </a>
                <a
                    href="/status"
                    target="_blank"
                    className="flex items-center gap-3 p-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 transition-colors"
                >
                    <ExternalLink className="h-5 w-5 text-gray-600 flex-shrink-0" />
                    <div>
                        <div className="font-medium text-sm text-gray-900">System Status</div>
                        <div className="text-xs text-gray-500">Check uptime</div>
                    </div>
                </a>
            </div>

            {/* FAQ Sections */}
            <div className="space-y-3">
                {SECTIONS.map(section => {
                    const isOpen = openSections.has(section.title);
                    return (
                        <div key={section.title} className="border border-gray-200 rounded-xl overflow-hidden">
                            <button
                                onClick={() => toggleSection(section.title)}
                                className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-colors text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-lg">{section.icon}</span>
                                    <span className="font-semibold text-gray-800">{section.title}</span>
                                    <span className="text-xs text-gray-500 bg-gray-200 px-2 py-0.5 rounded-full">
                                        {section.faqs.length}
                                    </span>
                                </div>
                                {isOpen ? (
                                    <ChevronDown className="h-4 w-4 text-gray-500" />
                                ) : (
                                    <ChevronRight className="h-4 w-4 text-gray-500" />
                                )}
                            </button>

                            {isOpen && (
                                <div className="divide-y divide-gray-100">
                                    {section.faqs.map((faq, idx) => {
                                        const key = `${section.title}-${idx}`;
                                        const faqOpen = openFaqs.has(key);
                                        return (
                                            <div key={key} className="bg-white">
                                                <button
                                                    onClick={() => toggleFaq(key)}
                                                    className="w-full flex items-start justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors"
                                                >
                                                    <span className="font-medium text-gray-800 text-sm pr-4">{faq.q}</span>
                                                    {faqOpen ? (
                                                        <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                                    ) : (
                                                        <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0 mt-0.5" />
                                                    )}
                                                </button>
                                                {faqOpen && (
                                                    <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">
                                                        {faq.a}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Footer note */}
            <div className="text-center text-sm text-gray-400 py-4">
                Can&apos;t find what you&apos;re looking for?{' '}
                <a href="mailto:support@retailsaas.app" className="text-blue-600 hover:underline">
                    Contact our support team
                </a>
            </div>
        </div>
    );
}
