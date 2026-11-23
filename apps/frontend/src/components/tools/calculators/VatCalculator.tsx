'use client';

import { useState } from 'react';
import { VAT_RATES, computeVat } from '@/lib/calculators/vat';
import { num } from '@/lib/calculators/money';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CalculatorLayout, Choice, CopyButton, NumField, ResultList } from './shared';

export function VatCalculator() {
    const { t, locale } = useI18n();
    const m = t.tools.calculators;
    const [amount, setAmount] = useState('');
    const [mode, setMode] = useState<'exclusive' | 'inclusive'>('exclusive');
    const [rate, setRate] = useState<number | 'other'>(15);
    const [otherRate, setOtherRate] = useState('');
    const [sd, setSd] = useState('');

    const vatRate = rate === 'other' ? num(otherRate) : rate;
    const r = computeVat(num(amount), vatRate, num(sd), mode);
    const money = (value: number) => formatBDT(value, { locale });
    const rows = [
        { label: m.vat.net, value: money(r.net) },
        ...(num(sd) > 0 ? [{ label: `${m.vat.sd} (${num(sd)}%)`, value: money(r.sd) }] : []),
        { label: `${m.vat.vat} (${vatRate}%)`, value: money(r.vat) },
        { label: m.vat.gross, value: money(r.gross), strong: true },
    ];

    return (
        <CalculatorLayout
            inputs={
                <>
                    <Choice
                        label={m.vat.mode}
                        value={mode}
                        onChange={setMode}
                        options={[
                            { value: 'exclusive', label: m.vat.exclusive },
                            { value: 'inclusive', label: m.vat.inclusive },
                        ]}
                    />
                    <NumField id="vat-amount" label={m.common.amount} value={amount} onChange={setAmount} />
                    <Choice
                        label={m.common.vatRate}
                        value={rate}
                        onChange={setRate}
                        options={[
                            ...VAT_RATES.map((value) => ({ value: value as number | 'other', label: `${value}%` })),
                            { value: 0, label: m.common.noVat },
                            { value: 'other', label: m.common.otherRate },
                        ]}
                    />
                    {rate === 'other' && <NumField id="vat-other" label={m.common.ratePct} value={otherRate} onChange={setOtherRate} />}
                    <NumField id="vat-sd" label={m.common.sdRate} value={sd} onChange={setSd} hint={m.vat.hint} />
                </>
            }
            result={
                <>
                    <ResultList rows={rows} />
                    <CopyButton
                        text={num(amount) ? rows.map((row) => `${row.label}: ${row.value}`).join('\n') : ''}
                        label={m.common.copySummary}
                        copied={m.common.copied}
                        failed={m.common.copyFailed}
                    />
                </>
            }
        />
    );
}
