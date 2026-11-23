'use client';

import { useState } from 'react';
import { Field, Input, PageHeader, PageShell } from '@/components/ui';
import { CopyButton } from '@/components/tools/calculators/shared';
import { takaInWords } from '@/lib/amount-in-words';
import { formatBanglaAmount, fromBanglaDigits, takaInBanglaWords } from '@/lib/bangla-words';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';

/** Tools → Amount in words: English, Bangla and Bangla digits, ready to copy. */
export default function AmountInWordsPage() {
    const { t } = useI18n();
    const m = t.tools.amountWords;
    const [value, setValue] = useState('');

    const amount = Number(fromBanglaDigits(value).replace(/[,\s]/g, ''));
    const valid = value.trim() !== '' && Number.isFinite(amount) && Math.abs(amount) < 1e15;
    const outputs = valid
        ? [
              { key: 'english', label: m.english, text: takaInWords(amount) },
              { key: 'bangla', label: m.bangla, text: takaInBanglaWords(amount) },
              { key: 'digits', label: m.banglaDigits, text: `৳${formatBanglaAmount(amount)}` },
          ]
        : [];

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
            />
            <div className="space-y-3 rounded-md border border-gray-200 bg-white p-3 md:p-4">
                <Field label={m.amount} hint={m.amountHint} htmlFor="words-amount">
                    <Input id="words-amount" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} autoFocus className="min-h-touch w-full text-base sm:max-w-xs" />
                </Field>
                {outputs.length === 0 ? (
                    <p className="text-sm text-gray-500">{m.empty}</p>
                ) : (
                    <ul className="space-y-2">
                        {outputs.map((output) => (
                            <li key={output.key} className="rounded-md border border-gray-200 p-3">
                                <p className="text-xs font-medium text-gray-500">{output.label}</p>
                                <p className="mt-1 text-base text-gray-900">{output.text}</p>
                                <div className="mt-2">
                                    <CopyButton text={output.text} label={m.copy} copied={m.copied} failed={m.copyFailed} />
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </PageShell>
    );
}
