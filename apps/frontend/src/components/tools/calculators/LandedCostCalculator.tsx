'use client';

import { useState } from 'react';
import { FormGrid } from '@/components/ui';
import { computeLandedCost } from '@/lib/calculators/landed-cost';
import { num } from '@/lib/calculators/money';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CalculatorLayout, CopyButton, NumField, ResultList } from './shared';

/** The rates a typical general import starts from; every one is editable. */
const DEFAULTS = { landingCharge: '1', cd: '25', rd: '3', sd: '0', vat: '15', ait: '5', at: '5' };

export function LandedCostCalculator() {
    const { t, locale } = useI18n();
    const m = t.tools.calculators.landed;
    const c = t.tools.calculators.common;
    const [cif, setCif] = useState('');
    const [rate, setRate] = useState('');
    const [rates, setRates] = useState(DEFAULTS);
    const [other, setOther] = useState('');
    const [quantity, setQuantity] = useState('');
    const set = (key: keyof typeof DEFAULTS) => (value: string) => setRates((current) => ({ ...current, [key]: value }));

    const r = computeLandedCost({
        cifForeign: num(cif),
        exchangeRate: num(rate),
        landingChargePct: num(rates.landingCharge),
        cdPct: num(rates.cd),
        rdPct: num(rates.rd),
        sdPct: num(rates.sd),
        vatPct: num(rates.vat),
        aitPct: num(rates.ait),
        atPct: num(rates.at),
        otherCharges: num(other),
        quantity: num(quantity),
    });
    const money = (value: number) => formatBDT(value, { locale });
    const rows = [
        { label: m.cifBdt, value: money(r.cifBdt) },
        { label: m.assessable, value: money(r.assessableValue) },
        { label: 'CD', value: money(r.cd), tone: 'muted' as const },
        { label: 'RD', value: money(r.rd), tone: 'muted' as const },
        { label: 'SD', value: money(r.sd), tone: 'muted' as const },
        { label: 'VAT', value: money(r.vat), tone: 'muted' as const },
        { label: 'AIT', value: money(r.ait), tone: 'muted' as const },
        { label: 'AT', value: money(r.at), tone: 'muted' as const },
        { label: m.totalTaxes, value: money(r.totalTaxes) },
        { label: m.recoverable, value: money(r.recoverable), tone: 'positive' as const },
        { label: m.tti, value: `${r.totalTaxIncidencePct}%` },
        { label: m.landedCost, value: money(r.landedCost), strong: true },
        ...(r.perUnit !== null ? [{ label: m.perUnit, value: money(r.perUnit), strong: true }] : []),
    ];

    return (
        <CalculatorLayout
            inputs={
                <>
                    <FormGrid>
                        <NumField id="lc-cif" label={m.cif} value={cif} onChange={setCif} />
                        <NumField id="lc-rate" label={m.exchangeRate} value={rate} onChange={setRate} />
                        <NumField id="lc-landing" label={m.landingCharge} value={rates.landingCharge} onChange={set('landingCharge')} />
                        <NumField id="lc-cd" label={m.cd} value={rates.cd} onChange={set('cd')} />
                        <NumField id="lc-rd" label={m.rd} value={rates.rd} onChange={set('rd')} />
                        <NumField id="lc-sd" label={m.sd} value={rates.sd} onChange={set('sd')} />
                        <NumField id="lc-vat" label={m.vat} value={rates.vat} onChange={set('vat')} />
                        <NumField id="lc-ait" label={m.ait} value={rates.ait} onChange={set('ait')} />
                        <NumField id="lc-at" label={m.at} value={rates.at} onChange={set('at')} />
                        <NumField id="lc-other" label={m.otherCharges} value={other} onChange={setOther} />
                        <NumField id="lc-qty" label={m.quantity} value={quantity} onChange={setQuantity} />
                    </FormGrid>
                    <p className="text-xs text-gray-500">{m.hint}</p>
                </>
            }
            result={
                <>
                    <ResultList rows={rows} />
                    <CopyButton
                        text={r.cifBdt > 0 ? rows.map((row) => `${row.label}: ${row.value}`).join('\n') : ''}
                        label={c.copySummary}
                        copied={c.copied}
                        failed={c.copyFailed}
                    />
                </>
            }
        />
    );
}
