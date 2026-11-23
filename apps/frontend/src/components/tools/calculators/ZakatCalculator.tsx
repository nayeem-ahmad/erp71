'use client';

import { useState } from 'react';
import { Alert, FormGrid } from '@/components/ui';
import { num } from '@/lib/calculators/money';
import { computeZakat } from '@/lib/calculators/zakat';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CalculatorLayout, Choice, NumField, ResultList } from './shared';

const EMPTY = { cash: '', bank: '', stock: '', receivables: '', gold: '', silver: '', other: '', liabilities: '' };

export function ZakatCalculator() {
    const { t, locale } = useI18n();
    const m = t.tools.calculators.zakat;
    const [values, setValues] = useState(EMPTY);
    const [basis, setBasis] = useState<'gold' | 'silver'>('silver');
    const [goldPrice, setGoldPrice] = useState('');
    const [silverPrice, setSilverPrice] = useState('');
    const set = (key: keyof typeof EMPTY) => (value: string) => setValues((current) => ({ ...current, [key]: value }));

    const r = computeZakat({
        cash: num(values.cash),
        bank: num(values.bank),
        stock: num(values.stock),
        receivables: num(values.receivables),
        goldValue: num(values.gold),
        silverValue: num(values.silver),
        otherAssets: num(values.other),
        liabilities: num(values.liabilities),
        goldPricePerVori: num(goldPrice),
        silverPricePerVori: num(silverPrice),
        nisabBasis: basis,
    });
    const money = (value: number) => formatBDT(value, { locale });

    return (
        <CalculatorLayout
            inputs={
                <>
                    <p className="text-sm font-medium text-gray-900">{m.assets}</p>
                    <FormGrid>
                        <NumField id="zk-cash" label={m.cash} value={values.cash} onChange={set('cash')} />
                        <NumField id="zk-bank" label={m.bank} value={values.bank} onChange={set('bank')} />
                        <NumField id="zk-stock" label={m.stock} value={values.stock} onChange={set('stock')} />
                        <NumField id="zk-recv" label={m.receivables} value={values.receivables} onChange={set('receivables')} />
                        <NumField id="zk-gold" label={m.gold} value={values.gold} onChange={set('gold')} />
                        <NumField id="zk-silver" label={m.silver} value={values.silver} onChange={set('silver')} />
                        <NumField id="zk-other" label={m.other} value={values.other} onChange={set('other')} />
                        <NumField id="zk-liab" label={m.liabilities} value={values.liabilities} onChange={set('liabilities')} hint={m.liabilitiesHint} />
                    </FormGrid>
                    <p className="pt-1 text-sm font-medium text-gray-900">{m.nisab}</p>
                    <Choice
                        label={m.nisabBasis}
                        value={basis}
                        onChange={setBasis}
                        options={[
                            { value: 'silver', label: m.nisabSilver },
                            { value: 'gold', label: m.nisabGold },
                        ]}
                    />
                    {basis === 'gold' ? (
                        <NumField id="zk-gold-price" label={m.goldPrice} value={goldPrice} onChange={setGoldPrice} hint={m.priceHint} />
                    ) : (
                        <NumField id="zk-silver-price" label={m.silverPrice} value={silverPrice} onChange={setSilverPrice} hint={m.priceHint} />
                    )}
                </>
            }
            result={
                <>
                    <ResultList
                        rows={[
                            { label: m.totalAssets, value: money(r.totalAssets) },
                            { label: m.netWealth, value: money(r.netWealth) },
                            { label: m.nisabValue, value: r.nisab > 0 ? money(r.nisab) : '—', tone: 'muted' },
                            { label: m.due, value: money(r.zakat), strong: true, tone: r.due ? 'positive' : 'default' },
                        ]}
                    />
                    {r.nisab > 0 && !r.due && r.totalAssets > 0 && <Alert tone="info">{m.notDue}</Alert>}
                    <p className="text-xs text-gray-500">{m.disclaimer}</p>
                </>
            }
        />
    );
}
