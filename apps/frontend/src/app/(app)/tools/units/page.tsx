'use client';

import { useState } from 'react';
import { Checkbox, Field, Input, PageHeader, PageShell, Select } from '@/components/ui';
import { Tabs } from '@/components/ui/compact/Tabs';
import { fromBanglaDigits } from '@/lib/bangla-words';
import { UNITS, convertPrice, convertUnit, findUnit, formatQuantity, type UnitCategory } from '@/lib/calculators/units';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

const CATEGORIES: UnitCategory[] = ['weight', 'gold', 'length', 'land'];
const DEFAULT_FROM: Record<UnitCategory, string> = { weight: 'maund', gold: 'vori', length: 'goj', land: 'kattha' };

/**
 * Tools → Unit converter: one quantity (or one price) shown in every unit of
 * its kind at once, the old Bangladeshi measures beside the metric ones.
 */
export default function UnitConverterPage() {
    const { t, fmt, locale } = useI18n();
    const m = t.tools.units;
    const [category, setCategory] = useState<UnitCategory>('weight');
    const [from, setFrom] = useState(DEFAULT_FROM.weight);
    const [value, setValue] = useState('1');
    const [priceMode, setPriceMode] = useState(false);

    const amount = Number(fromBanglaDigits(value).replace(/,/g, ''));
    const fromUnit = findUnit(category, from);
    const unitName = (id: string) => {
        const unit = findUnit(category, id);
        return unit ? `${unit.bn} · ${unit.en}` : id;
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
                    <Tabs<UnitCategory>
                        idPrefix="units"
                        label={m.title}
                        value={category}
                        onChange={(next) => {
                            const value = next ?? category;
                            setCategory(value);
                            setFrom(DEFAULT_FROM[value]);
                        }}
                        tabs={CATEGORIES.map((key) => ({ key, label: m.categories[key] }))}
                    />
                </div>
                <div className="space-y-3 p-3 md:p-4">
                    <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={priceMode ? m.price : m.value} htmlFor="unit-value">
                            <Input id="unit-value" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className="min-h-touch w-full text-base" />
                        </Field>
                        <Field label={m.from} htmlFor="unit-from">
                            <Select id="unit-from" value={from} onChange={(e) => setFrom(e.target.value)} className="min-h-touch w-full">
                                {UNITS[category].units.map((unit) => (
                                    <option key={unit.id} value={unit.id}>
                                        {unit.bn} · {unit.en}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                    </div>
                    <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                        <Checkbox checked={priceMode} onChange={(e) => setPriceMode(e.target.checked)} />
                        {m.priceMode}
                    </label>

                    <div>
                        <p className="text-xs font-medium text-gray-600">{m.allUnits}</p>
                        <ul className="mt-1 divide-y divide-gray-100 rounded-md border border-gray-200">
                            {UNITS[category].units
                                .filter((unit) => unit.id !== from)
                                .map((unit) => {
                                    const converted = priceMode ? convertPrice(category, amount, from, unit.id) : convertUnit(category, amount, from, unit.id);
                                    return (
                                        <li key={unit.id} className="flex items-baseline justify-between gap-3 px-3 py-2">
                                            <span className="text-sm text-gray-700">{priceMode ? fmt(m.pricePer, { unit: unitName(unit.id) }) : unitName(unit.id)}</span>
                                            <span className="text-end text-sm font-semibold tabular-nums text-gray-900">
                                                {Number.isFinite(converted) && value.trim() !== '' ? (priceMode ? formatBDT(converted, { locale }) : formatQuantity(converted)) : '—'}
                                            </span>
                                        </li>
                                    );
                                })}
                        </ul>
                        {fromUnit && <p className="mt-2 text-xs text-gray-500">{m.standardNote}</p>}
                    </div>
                </div>
            </div>
        </PageShell>
    );
}
