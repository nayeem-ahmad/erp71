'use client';

import { useMemo, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import CompactLinkGrid, { type CompactLinkItem } from '@/components/ui/compact/CompactLinkGrid';
import PageHeader from '@/components/ui/compact/PageHeader';
import PageShell from '@/components/ui/compact/PageShell';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs, type ModuleKey } from '@/lib/page-breadcrumbs';

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
    module: ModuleKey;
    moduleLabel: string;
    title: string;
    subtitle: string;
    sections: HubSectionConfig[];
    sectionLabels: Record<string, string>;
    linkCopy: Record<string, HubLinkCopy>;
    openSectionLabel: string;
    viewReportLabel: string;
    canAccessAdvanced?: boolean;
    children?: ReactNode;
}

export default function ModuleHub({
    module,
    moduleLabel,
    title,
    subtitle,
    sections,
    sectionLabels,
    linkCopy,
    canAccessAdvanced = true,
    children,
}: ModuleHubProps) {
    const { t } = useI18n();
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

    const breadcrumbs = modulePageBreadcrumbs(
        t.dashboardHome.breadcrumbHome,
        moduleLabel,
        title,
        module,
    );

    return (
        <PageShell maxWidth="wide">
            <PageHeader title={title} subtitle={subtitle} breadcrumbs={breadcrumbs} />

            {children}

            {sectionGrids.map((section) => (
                <CompactLinkGrid key={section.label} label={section.label} links={section.links} />
            ))}
        </PageShell>
    );
}