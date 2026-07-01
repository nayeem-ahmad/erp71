'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import { compactDensity } from '@/lib/ui/compact-density';

export type CompactLinkItem = {
    href: string;
    title: string;
    icon: LucideIcon;
    accent: string;
};

type CompactLinkGridProps = {
    label?: string;
    links: CompactLinkItem[];
};

/** Dense icon + label grid — no descriptions or CTAs. */
export default function CompactLinkGrid({ label, links }: CompactLinkGridProps) {
    return (
        <div className="space-y-2">
            {label ? <p className={compactDensity.sectionLabel}>{label}</p> : null}
            <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
                {links.map(({ href, title, icon: Icon, accent }) => (
                    <Link
                        key={href}
                        href={href}
                        className="group flex items-center gap-2.5 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                    >
                        <span className={`inline-flex shrink-0 rounded-md border p-1.5 ${accent}`}>
                            <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-sm font-semibold text-gray-900 leading-tight">{title}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}