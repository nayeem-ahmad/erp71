'use client';

import { useState } from 'react';
import { NUMBERING_DOC_TYPES, NUMBERING_DOC_TYPE_INFO, type NumberingDocType } from '@erp71/shared-types';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { Tabs } from '@/components/ui/compact/Tabs';
import NumberingEditor from './NumberingEditor';

const TABS = NUMBERING_DOC_TYPES.map((key) => ({ key, label: NUMBERING_DOC_TYPE_INFO[key].label }));

export default function DocumentNumberingPage() {
    const { t } = useI18n();
    const pageTitle = t.settings.hub.links.documentNumbering;
    const [active, setActive] = useState<NumberingDocType>('SALE');
    // Every tab opened so far stays mounted (hidden when not shown), so moving
    // between tabs keeps what was typed in each until it is saved.
    const [opened, setOpened] = useState<NumberingDocType[]>(['SALE']);

    const open = (next: NumberingDocType | null) => {
        // Clicking the open tab again would close the strip; a page of tabs
        // always shows one.
        if (!next) return;
        setActive(next);
        setOpened((list) => (list.includes(next) ? list : [...list, next]));
    };

    return (
        <PageShell maxWidth="narrow">
            <PageHeader
                title={pageTitle}
                subtitle="Choose how new documents are numbered"
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    pageTitle,
                    'settings',
                )}
            />

            <div className="mt-4 space-y-4">
                <Tabs tabs={TABS} value={active} onChange={open} idPrefix="numbering" label="Document type" />
                {opened.map((docType) => (
                    <div
                        key={docType}
                        id={`numbering-panel-${docType}`}
                        role="tabpanel"
                        aria-labelledby={`numbering-tab-${docType}`}
                        hidden={docType !== active}
                    >
                        <NumberingEditor docType={docType} />
                    </div>
                ))}
            </div>
        </PageShell>
    );
}
