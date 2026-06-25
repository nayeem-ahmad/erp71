'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useI18n } from '@/lib/i18n';

type QuickLink = {
    key: string;
    href: string;
    label: string;
    imageUrl: string;
};

const QUICK_LINK_IMAGES: Record<QuickLink['key'], string> = {
    'sales-entry': 'https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&q=80&w=480',
    sales: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&q=80&w=480',
    'customer-payment': 'https://images.unsplash.com/photo-1563013544-824ae1b704d3?auto=format&fit=crop&q=80&w=480',
    'supplier-payment': 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&q=80&w=480',
    'customer-ledger': 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&q=80&w=480',
    'expense-entry': 'https://images.unsplash.com/photo-1554224155-6726b3ff858f?auto=format&fit=crop&q=80&w=480',
};

export default function FrequentQuickLinks() {
    const { t } = useI18n();
    const copy = t.dashboardHome;

    const links: QuickLink[] = [
        { key: 'sales-entry', href: '/dashboard/sales/new', label: copy.quickLinks.salesEntry, imageUrl: QUICK_LINK_IMAGES['sales-entry'] },
        { key: 'sales', href: '/dashboard/sales', label: copy.quickLinks.sales, imageUrl: QUICK_LINK_IMAGES.sales },
        { key: 'customer-payment', href: '/dashboard/sales/customer-payments', label: copy.quickLinks.customerPayment, imageUrl: QUICK_LINK_IMAGES['customer-payment'] },
        { key: 'supplier-payment', href: '/dashboard/purchases/supplier-payments', label: copy.quickLinks.supplierPayment, imageUrl: QUICK_LINK_IMAGES['supplier-payment'] },
        { key: 'customer-ledger', href: '/dashboard/sales/customer-ledger', label: copy.quickLinks.customerLedger, imageUrl: QUICK_LINK_IMAGES['customer-ledger'] },
        { key: 'expense-entry', href: '/dashboard/expenses?new=1', label: copy.quickLinks.expenseEntry, imageUrl: QUICK_LINK_IMAGES['expense-entry'] },
    ];

    return (
        <div className="grid w-full grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {links.map(({ key, href, label, imageUrl }) => (
                <Link
                    key={key}
                    href={href}
                    className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-shadow hover:shadow-md"
                >
                    <div className="relative aspect-[5/4] w-full overflow-hidden bg-gray-100">
                        <Image
                            src={imageUrl}
                            alt=""
                            fill
                            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 16vw"
                            className="object-cover transition-transform duration-300 group-hover:scale-105"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-transparent" aria-hidden />
                    </div>
                    <div className="border-t border-gray-100 px-2 py-2.5 text-center">
                        <span className="text-xs font-bold leading-tight tracking-tight text-gray-900">{label}</span>
                    </div>
                </Link>
            ))}
        </div>
    );
}