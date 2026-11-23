'use client';

import { useState } from 'react';
import { Alert, Button, FormGrid } from '@/components/ui';
import { computeEmi } from '@/lib/calculators/emi';
import { num } from '@/lib/calculators/money';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { CalculatorLayout, Choice, NumField, ResultList } from './shared';

export function EmiCalculator() {
    const { t, locale } = useI18n();
    const m = t.tools.calculators.emi;
    const [principal, setPrincipal] = useState('');
    const [rate, setRate] = useState('');
    const [months, setMonths] = useState('12');
    const [method, setMethod] = useState<'reducing' | 'flat'>('reducing');
    const [showSchedule, setShowSchedule] = useState(false);

    const r = computeEmi(num(principal), num(rate), num(months), method);
    const money = (value: number) => formatBDT(value, { locale });
    const touched = principal !== '' || rate !== '';

    return (
        <CalculatorLayout
            inputs={
                <>
                    <FormGrid>
                        <NumField id="emi-principal" label={m.principal} value={principal} onChange={setPrincipal} />
                        <NumField id="emi-rate" label={m.rate} value={rate} onChange={setRate} />
                        <NumField id="emi-months" label={m.months} value={months} onChange={setMonths} step="1" />
                    </FormGrid>
                    <Choice
                        label={m.method}
                        value={method}
                        onChange={setMethod}
                        options={[
                            { value: 'reducing', label: m.reducing },
                            { value: 'flat', label: m.flat },
                        ]}
                    />
                    {method === 'flat' && <p className="text-xs text-amber-700">{m.flatHint}</p>}
                </>
            }
            result={
                r ? (
                    <ResultList
                        rows={[
                            { label: m.emi, value: money(r.emi), strong: true },
                            { label: m.totalInterest, value: money(r.totalInterest), tone: 'negative' },
                            { label: m.totalPayment, value: money(r.totalPayment) },
                        ]}
                    />
                ) : touched ? (
                    <Alert tone="info">{m.invalid}</Alert>
                ) : null
            }
            footer={
                r && (
                    <div className="space-y-2">
                        <Button variant="secondary" onClick={() => setShowSchedule((value) => !value)}>
                            {showSchedule ? m.hideSchedule : m.showSchedule}
                        </Button>
                        {showSchedule && (
                            <div className="max-h-96 overflow-auto rounded-md border border-gray-200">
                                <table className="w-full text-sm">
                                    <caption className="sr-only">{m.schedule}</caption>
                                    <thead className="sticky top-0 bg-gray-50 text-xs text-gray-500">
                                        <tr>
                                            <th className="px-3 py-1.5 text-start font-medium">{m.month}</th>
                                            <th className="px-3 py-1.5 text-end font-medium">{m.payment}</th>
                                            <th className="hidden px-3 py-1.5 text-end font-medium sm:table-cell">{m.interest}</th>
                                            <th className="hidden px-3 py-1.5 text-end font-medium sm:table-cell">{m.principalPart}</th>
                                            <th className="px-3 py-1.5 text-end font-medium">{m.balance}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100 tabular-nums">
                                        {r.schedule.map((row) => (
                                            <tr key={row.month}>
                                                <td className="px-3 py-1.5">{row.month}</td>
                                                <td className="px-3 py-1.5 text-end">{money(row.payment)}</td>
                                                <td className="hidden px-3 py-1.5 text-end sm:table-cell">{money(row.interest)}</td>
                                                <td className="hidden px-3 py-1.5 text-end sm:table-cell">{money(row.principal)}</td>
                                                <td className="px-3 py-1.5 text-end">{money(row.balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )
            }
        />
    );
}
