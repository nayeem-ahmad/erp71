'use client';

import { useRef, useState } from 'react';
import { Download, ChevronDown } from 'lucide-react';
import { compactDensity } from '@/lib/ui/compact-density';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';

type ExportFormat = 'tally' | 'quickbooks';

function getDefaultDateRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const from = `${year}-${month}-01`;
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    return { from, to };
}

function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

/** Tally / QuickBooks ledger export — belongs under Accounting Setup. */
export default function AccountingLedgerExport() {
    const { t } = useI18n();
    const defaults = getDefaultDateRange();

    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showDateModal, setShowDateModal] = useState(false);
    const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
    const [from, setFrom] = useState(defaults.from);
    const [to, setTo] = useState(defaults.to);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const exportMenuRef = useRef<HTMLDivElement>(null);

    function openExportModal(format: ExportFormat) {
        setPendingFormat(format);
        setShowExportMenu(false);
        setExportError(null);
        setShowDateModal(true);
    }

    async function handleExport() {
        if (!pendingFormat) return;
        setExporting(true);
        setExportError(null);
        try {
            const { blob, filename } = await api.exportAccountingLedger({
                format: pendingFormat,
                from: from || undefined,
                to: to || undefined,
            });
            triggerBlobDownload(blob, filename);
            setShowDateModal(false);
        } catch (err: any) {
            setExportError(err?.message ?? t.accountingShared.exportFailed);
        } finally {
            setExporting(false);
        }
    }

    return (
        <>
            <div className="relative inline-block" ref={exportMenuRef}>
                <button
                    type="button"
                    onClick={() => setShowExportMenu((v) => !v)}
                    className={compactDensity.btnSecondary}
                >
                    <Download className="h-3.5 w-3.5" />
                    {t.accounting.export}
                    <ChevronDown className="h-3 w-3 text-gray-400" />
                </button>
                {showExportMenu && (
                    <div
                        className="absolute left-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
                        onMouseLeave={() => setShowExportMenu(false)}
                    >
                        <button
                            type="button"
                            onClick={() => openExportModal('tally')}
                            className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                            {t.accounting.tallyXml}
                        </button>
                        <button
                            type="button"
                            onClick={() => openExportModal('quickbooks')}
                            className="w-full px-3 py-1.5 text-left text-sm text-gray-700 hover:bg-gray-50"
                        >
                            {t.accounting.quickbooksIif}
                        </button>
                    </div>
                )}
            </div>

            {showDateModal && (
                <div
                    className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowDateModal(false); }}
                >
                    <div className={`${compactDensity.modal} max-w-sm`}>
                        <div className={`${compactDensity.modalPadding} border-b border-gray-100`}>
                            <h2 className={compactDensity.modalTitle}>
                                {formatMessage(t.accounting.exportModalTitle, {
                                    format: pendingFormat === 'tally' ? t.accounting.tallyXml : t.accounting.quickbooksIif,
                                })}
                            </h2>
                            <p className="text-xs text-gray-500 mt-1">{t.accounting.exportModalDescription}</p>
                        </div>

                        <div className={`${compactDensity.modalPadding} ${compactDensity.formStack}`}>
                            <div>
                                <label className={`${compactDensity.formLabel} block mb-1`}>
                                    {t.accountingShared.from}
                                </label>
                                <input
                                    type="date"
                                    value={from}
                                    onChange={(e) => setFrom(e.target.value)}
                                    className={compactDensity.formField}
                                />
                            </div>
                            <div>
                                <label className={`${compactDensity.formLabel} block mb-1`}>
                                    {t.accountingShared.to}
                                </label>
                                <input
                                    type="date"
                                    value={to}
                                    onChange={(e) => setTo(e.target.value)}
                                    className={compactDensity.formField}
                                />
                            </div>
                            {exportError && <p className="text-sm text-red-600">{exportError}</p>}
                        </div>

                        <div className={`${compactDensity.modalPadding} flex gap-2 justify-end border-t border-gray-100`}>
                            <button
                                type="button"
                                onClick={() => setShowDateModal(false)}
                                className={compactDensity.btnSecondary}
                            >
                                {t.common.cancel}
                            </button>
                            <button
                                type="button"
                                onClick={handleExport}
                                disabled={exporting}
                                className={`${compactDensity.btnPrimary} bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-60`}
                            >
                                <Download className="h-3.5 w-3.5" />
                                {exporting ? t.accountingShared.downloading : t.accountingShared.download}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}