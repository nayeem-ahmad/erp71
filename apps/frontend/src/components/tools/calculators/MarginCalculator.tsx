'use client';

import { useState } from 'react';
import { Alert, Checkbox } from '@/components/ui';
import { analysePrice, priceForMargin, priceForMarkup } from '@/lib/calculators/margin';
import { num } from '@/lib/calculators/money';
import { VAT_RATES } from '@/lib/calculators/vat';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CalculatorLayout, Choice, NumField, ResultList } from './shared';

type Mode = 'check' | 'margin' | 'markup';

export function MarginCalculator() {
    const { t, locale } = useI18n();
    const m = t.tools.calculators;
    const [mode, setMode] = useState<Mode>('check');
    const [cost, setCost] = useState('');
    const [price, setPrice] = useState('');
    const [target, setTarget] = useState('25');
    const [vatRate, setVatRate] = useState<number>(15);
    const [includesVat, setIncludesVat] = useState(true);

    const result =
        mode === 'check'
            ? analysePrice(num(cost), num(price), vatRate, includesVat)
            : mode === 'margin'
              ? priceForMargin(num(cost), num(target), vatRate)
              : priceForMarkup(num(cost), num(target), vatRate);
    const money = (value: number) => formatBDT(value, { locale });
    const ready = num(cost) > 0 && (mode !== 'check' || num(price) > 0);

    return (
        <CalculatorLayout
            inputs={
                <>
                    <Choice
                        label={m.margin.mode}
                        value={mode}
                        onChange={setMode}
                        options={[
                            { value: 'check', label: m.margin.modeCheck },
                            { value: 'margin', label: m.margin.modeMargin },
                            { value: 'markup', label: m.margin.modeMarkup },
                        ]}
                    />
                    <NumField id="margin-cost" label={m.margin.cost} value={cost} onChange={setCost} />
                    {mode === 'check' ? (
                        <>
                            <NumField id="margin-price" label={m.margin.price} value={price} onChange={setPrice} />
                            <label className="flex min-h-touch items-center gap-2 text-sm text-gray-700">
                                <Checkbox checked={includesVat} onChange={(e) => setIncludesVat(e.target.checked)} />
                                {m.margin.priceIncludesVat}
                            </label>
                        </>
                    ) : (
                        <NumField id="margin-target" label={mode === 'margin' ? m.margin.targetMargin : m.margin.targetMarkup} value={target} onChange={setTarget} />
                    )}
                    <Choice
                        label={m.common.vatRate}
                        value={vatRate}
                        onChange={setVatRate}
                        options={[...VAT_RATES.map((value) => ({ value: value as number, label: `${value}%` })), { value: 0, label: m.common.noVat }]}
                    />
                    <p className="text-xs text-gray-500">{m.margin.hint}</p>
                </>
            }
            result={
                !result ? (
                    <Alert tone="warning">{m.margin.impossible}</Alert>
                ) : ready ? (
                    <>
                        <ResultList
                            rows={[
                                { label: m.margin.netPrice, value: money(result.netPrice) },
                                { label: m.margin.shelfPrice, value: money(result.shelfPrice), strong: mode !== 'check' },
                                { label: m.margin.profit, value: money(result.profit), tone: result.profit < 0 ? 'negative' : 'positive' },
                                { label: m.margin.marginPct, value: `${result.marginPct}%`, strong: mode === 'check' },
                                { label: m.margin.markupPct, value: `${result.markupPct}%` },
                            ]}
                        />
                        {result.profit < 0 && <Alert tone="danger">{m.margin.loss}</Alert>}
                    </>
                ) : null
            }
        />
    );
}
