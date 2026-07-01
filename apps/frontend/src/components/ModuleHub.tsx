'use client';

import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import CompactLinkGrid, { type CompactLinkItem } from '@/components/ui/compact/CompactLinkGrid';
import PageShell from '@/components/ui/compact/PageShell';

export interface HubLinkConfig {
    href: string;
    key: string;
    icon: LucideIcon;
    accent: string;
    advancedOnly?: boolean;
}

export interface HubSectionConfig {
    sectionKey: string;
    advancedOnly?: boolean;
    links: HubLinkConfig[];
}

interface HubLinkCopy {
    title: string;
    description: string;
}

interface ModuleHubProps {
    moduleLabel: string;
    title: string;
    subtitle: string;
    sections: HubSectionConfig[];
    sectionLabels: Record<string, string>;
    linkCopy: Record<string, HubLinkCopy>;
    openSectionLabel: string;
    viewReportLabel: string;
    canAccessAdvanced?: boolean;
}

export default function ModuleHub({
    title,
    subtitle,
    sections,
    sectionLabels,
    linkCopy,
    canAccessAdvanced = true,
}: ModuleHubProps) {
    const sectionGrids = useMemo(() => {
        return sections
            .filter((section) => !section.advancedOnly || canAccessAdvanced)
            .map((section) => {
                const links: CompactLinkItem[] = section.links
                    .filter((link) => !link.advancedOnly || canAccessAdvanced)
                    .flatMap(({ href, key, icon, accent }) => {
                        const copy = linkCopy[key];
                        if (!copy) return [];
                        return [{ href, title: copy.title, icon, accent }];
                    });

                return {
                    label: sectionLabels[section.sectionKey] ?? section.sectionKey,
                    links,
                };
            })
            .filter((section) => section.links.length > 0);
    }, [canAccessAdvanced, linkCopy, sectionLabels, sections]);

    return (
        <PageShell maxWidth="wide">
            <div className="space-y-1">
                <h1 className="text-lg font-bold tracking-tight text-gray-950">{title}</h1>
                <p className="text-xs text-gray-500 max-w-3xl">{subtitle}</p>
            </div>

            {sectionGrids.map((section) => (
                <CompactLinkGrid key={section.label} label={section.label} links={section.links} />
            ))}
        </PageShell>
    );
}