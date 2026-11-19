'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbItem } from '@/lib/page-breadcrumbs';

type PageBreadcrumbProps = {
    items: BreadcrumbItem[];
    className?: string;
    /**
     * `default` sits at the end of the title row (CLASSIC). `compact` is the
     * small trail above the title, at its start, that the other styles use.
     */
    variant?: 'default' | 'compact';
};

export default function PageBreadcrumb({ items, className = '', variant = 'default' }: PageBreadcrumbProps) {
    if (items.length === 0) return null;
    const compact = variant === 'compact';

    return (
        <nav
            className={`flex flex-wrap items-center ${compact ? 'justify-start gap-1 text-xs' : 'justify-end gap-1.5 text-sm'} text-gray-500 ${className}`}
            aria-label="Breadcrumb"
        >
            {items.map((item, index) => {
                const isLast = index === items.length - 1;

                return (
                    <span key={`${item.label}-${index}`} className={`inline-flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
                        {index > 0 ? (
                            <ChevronRight className={`${compact ? 'h-3 w-3' : 'h-4 w-4'} shrink-0 text-gray-300`} aria-hidden />
                        ) : null}
                        {item.href && !isLast ? (
                            <Link
                                href={item.href}
                                className={`${compact ? 'font-medium' : 'font-semibold'} hover:text-gray-800 transition-colors`}
                            >
                                {item.label}
                            </Link>
                        ) : (
                            <span className={isLast ? `${compact ? 'font-medium' : 'font-bold'} text-gray-800` : compact ? 'font-medium' : 'font-semibold'}>
                                {item.label}
                            </span>
                        )}
                    </span>
                );
            })}
        </nav>
    );
}