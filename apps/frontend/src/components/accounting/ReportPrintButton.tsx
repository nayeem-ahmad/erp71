'use client';

import { Printer } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

/**
 * Print action for the financial statements.
 *
 * Disabled rather than hidden when there is nothing to print, so the control
 * does not appear and disappear as a report loads — and it says why on hover
 * instead of failing silently on click.
 */
export default function ReportPrintButton({
    onPrint,
    disabled = false,
    disabledReason,
}: Readonly<{
    onPrint: () => void;
    disabled?: boolean;
    disabledReason?: string;
}>) {
    const { t } = useI18n();
    const label = t.accounting.reports.print.action;

    return (
        <button
            type="button"
            onClick={onPrint}
            disabled={disabled}
            title={disabled ? disabledReason : label}
            className="inline-flex min-h-touch items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:border-gray-300 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
            <Printer className="h-4 w-4" />
            {label}
        </button>
    );
}
