'use client';

import { useEffect, useState } from 'react';
import { PageHeader, PageShell } from '@/components/ui';
import { Tabs, TabPanel } from '@/components/ui/compact/Tabs';
import { EmiCalculator } from '@/components/tools/calculators/EmiCalculator';
import { LandedCostCalculator } from '@/components/tools/calculators/LandedCostCalculator';
import { MarginCalculator } from '@/components/tools/calculators/MarginCalculator';
import { TapeCalculator } from '@/components/tools/calculators/TapeCalculator';
import { VatCalculator } from '@/components/tools/calculators/VatCalculator';
import { ZakatCalculator } from '@/components/tools/calculators/ZakatCalculator';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const TABS = ['vat', 'margin', 'landed', 'zakat', 'emi', 'tape'] as const;
type CalculatorTab = (typeof TABS)[number];
const TAB_KEY = 'erp71.tools.calculatorTab';

/** Tools → Calculators. Arithmetic only: nothing here is stored except a tape saved to Notes. */
export default function CalculatorsPage() {
    const { t } = useI18n();
    const m = t.tools.calculators;
    const [tab, setTab] = useState<CalculatorTab>('vat');

    // The last calculator used opens again: a per-device convenience.
    useEffect(() => {
        try {
            const saved = window.localStorage.getItem(TAB_KEY);
            if (saved && (TABS as readonly string[]).includes(saved)) setTab(saved as CalculatorTab);
        } catch {
            /* storage unavailable */
        }
    }, []);

    const choose = (next: CalculatorTab | null) => {
        const value = next ?? tab;
        setTab(value);
        try {
            window.localStorage.setItem(TAB_KEY, value);
        } catch {
            /* storage unavailable */
        }
    };

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
            />
            <div className="rounded-md border border-gray-200 bg-white">
                <div className="overflow-x-auto">
                    <Tabs<CalculatorTab> idPrefix="calculator" label={m.title} value={tab} onChange={choose} tabs={TABS.map((key) => ({ key, label: m.tabs[key] }))} />
                </div>
                <div className="p-3 md:p-4">
                    <TabPanel tabKey="vat" value={tab} idPrefix="calculator"><VatCalculator /></TabPanel>
                    <TabPanel tabKey="margin" value={tab} idPrefix="calculator"><MarginCalculator /></TabPanel>
                    <TabPanel tabKey="landed" value={tab} idPrefix="calculator"><LandedCostCalculator /></TabPanel>
                    <TabPanel tabKey="zakat" value={tab} idPrefix="calculator"><ZakatCalculator /></TabPanel>
                    <TabPanel tabKey="emi" value={tab} idPrefix="calculator"><EmiCalculator /></TabPanel>
                    <TabPanel tabKey="tape" value={tab} idPrefix="calculator"><TapeCalculator /></TabPanel>
                </div>
            </div>
        </PageShell>
    );
}
