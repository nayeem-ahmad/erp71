'use client';

import { useRef, useState } from 'react';
import { Upload, CheckCircle, AlertCircle, FileSpreadsheet } from 'lucide-react';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Alert } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { readOrgWorkbook, type OrgImportResult, type OrgSheetKind, type OrgWorkbook } from '@/lib/org-structure';

interface OrgImportDialogProps {
    open: boolean;
    onClose: () => void;
    onImported: () => void;
}

type Step = 'upload' | 'review' | 'done';

const KINDS: OrgSheetKind[] = ['levels', 'departments', 'designations'];

/**
 * Imports the designation master workbook in two steps. "Check file" sends it
 * as a dry run and shows what would be created, updated or left alone, plus
 * every problem by sheet and row; "Import now" appears only when there are
 * none, and runs the same file for real. The server refuses a file with errors
 * as a whole, so a half-imported org chart is never possible.
 */
export default function OrgImportDialog({ open, onClose, onImported }: OrgImportDialogProps) {
    const { t, fmt } = useI18n();
    const c = t.orgStructure.import;
    const fileInput = useRef<HTMLInputElement>(null);
    const [step, setStep] = useState<Step>('upload');
    const [fileName, setFileName] = useState('');
    const [workbook, setWorkbook] = useState<OrgWorkbook | null>(null);
    const [mode, setMode] = useState<'skip' | 'upsert'>('upsert');
    const [preview, setPreview] = useState<OrgImportResult | null>(null);
    const [result, setResult] = useState<OrgImportResult | null>(null);
    const [busy, setBusy] = useState(false);
    const [problem, setProblem] = useState('');

    if (!open) return null;

    const reset = () => {
        setStep('upload');
        setFileName('');
        setWorkbook(null);
        setPreview(null);
        setResult(null);
        setProblem('');
        if (fileInput.current) fileInput.current.value = '';
    };

    const close = () => {
        reset();
        onClose();
    };

    const payload = (wb: OrgWorkbook, dryRun: boolean) => ({
        levels: wb.levels,
        departments: wb.departments,
        designations: wb.designations,
        mode,
        dry_run: dryRun,
    });

    const check = async (wb: OrgWorkbook, nextMode = mode) => {
        setBusy(true);
        setProblem('');
        try {
            setPreview(await api.importOrgStructure({ ...payload(wb, true), mode: nextMode }));
            setStep('review');
        } catch (err) {
            setProblem(err instanceof Error ? err.message : c.parseFailed);
        } finally {
            setBusy(false);
        }
    };

    const handleFile = async (file: File) => {
        setProblem('');
        setFileName(file.name);
        try {
            const wb = await readOrgWorkbook(file);
            if (!wb.sheets.levels && !wb.sheets.departments && !wb.sheets.designations) {
                setProblem(c.noSheets);
                return;
            }
            setWorkbook(wb);
            await check(wb);
        } catch (err) {
            setProblem(err instanceof Error ? err.message : c.parseFailed);
        }
    };

    const changeMode = (next: 'skip' | 'upsert') => {
        setMode(next);
        if (workbook) void check(workbook, next);
    };

    const runImport = async () => {
        if (!workbook) return;
        setBusy(true);
        setProblem('');
        try {
            const res = await api.importOrgStructure(payload(workbook, false));
            if (res.applied) {
                setResult(res);
                setStep('done');
                onImported();
                toast.success(c.doneTitle);
            } else {
                // Someone changed the master between the check and now.
                setPreview(res);
            }
        } catch (err) {
            setProblem(err instanceof Error ? err.message : c.parseFailed);
        } finally {
            setBusy(false);
        }
    };

    const sheetLabel: Record<OrgSheetKind, string> = {
        levels: c.sheetLevels,
        departments: c.sheetDepartments,
        designations: c.sheetDesignations,
    };

    const counts = (r: OrgImportResult) => (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-xs text-gray-500 border-b border-gray-100">
                        <th className="py-1.5 text-start font-medium" />
                        <th className="py-1.5 text-end font-medium">{c.created}</th>
                        <th className="py-1.5 text-end font-medium">{c.updated}</th>
                        <th className="py-1.5 text-end font-medium">{c.unchanged}</th>
                        <th className="py-1.5 text-end font-medium">{c.skipped}</th>
                    </tr>
                </thead>
                <tbody>
                    {KINDS.map((kind) => (
                        <tr key={kind} className="border-b border-gray-50 last:border-0">
                            <td className="py-1.5 text-gray-700">{sheetLabel[kind]}</td>
                            <td className="py-1.5 text-end tabular-nums font-medium text-gray-900">{r[kind].created}</td>
                            <td className="py-1.5 text-end tabular-nums text-gray-700">{r[kind].updated}</td>
                            <td className="py-1.5 text-end tabular-nums text-gray-500">{r[kind].unchanged}</td>
                            <td className="py-1.5 text-end tabular-nums text-gray-500">{r[kind].skipped}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );

    const hasErrors = (preview?.errors.length ?? 0) > 0;

    return (
        <ModalShell size="lg" onBackdropClick={busy ? undefined : close}>
            <ModalHeader title={c.title} subtitle={c.subtitle} onClose={close} />

            <div className="p-4 space-y-4 overflow-y-auto">
                {problem && <Alert tone="danger">{problem}</Alert>}

                {step === 'upload' && (
                    <div className="space-y-3">
                        <button
                            type="button"
                            onClick={() => fileInput.current?.click()}
                            disabled={busy}
                            className="w-full min-h-touch flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 px-4 py-8 text-sm text-gray-600 hover:border-blue-300 hover:bg-blue-50 transition-colors disabled:opacity-60"
                        >
                            <Upload className="w-6 h-6 text-gray-400" />
                            <span className="font-medium text-gray-900">{busy ? c.checking : c.chooseFile}</span>
                            {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
                        </button>
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            aria-label={c.chooseFile}
                            onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) void handleFile(file);
                            }}
                        />
                        <p className="text-xs text-gray-500">{c.fileHelp}</p>
                    </div>
                )}

                {step === 'review' && workbook && preview && (
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <p className="text-xs font-medium text-gray-500">{fmt(c.sheetsFound, { file: fileName })}</p>
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                {KINDS.map((kind) => (
                                    <div key={kind} className="flex items-center gap-2 rounded-md border border-gray-100 px-3 py-2">
                                        <FileSpreadsheet className={`w-4 h-4 shrink-0 ${workbook.sheets[kind] ? 'text-emerald-600' : 'text-gray-300'}`} />
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium text-gray-900">{sheetLabel[kind]}</p>
                                            <p className="text-xs text-gray-500 truncate">
                                                {workbook.sheets[kind]
                                                    ? `${workbook.sheets[kind]} · ${fmt(c.rows, { count: workbook[kind].length })}`
                                                    : c.notInFile}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {workbook.ignored.length > 0 && (
                                <p className="text-xs text-gray-500">{fmt(c.ignoredSheets, { names: workbook.ignored.join(', ') })}</p>
                            )}
                        </div>

                        <fieldset className="space-y-1.5">
                            <legend className="text-xs font-medium text-gray-500">{c.modeLabel}</legend>
                            {(['upsert', 'skip'] as const).map((value) => (
                                <label key={value} className="flex items-center gap-2 text-sm text-gray-700 min-h-touch md:min-h-0">
                                    <input
                                        type="radio"
                                        name="org-import-mode"
                                        checked={mode === value}
                                        disabled={busy}
                                        onChange={() => changeMode(value)}
                                    />
                                    {value === 'upsert' ? c.modeUpsert : c.modeSkip}
                                </label>
                            ))}
                        </fieldset>

                        <div className="space-y-2">
                            <p className="text-xs font-medium text-gray-500">{c.previewTitle}</p>
                            {counts(preview)}
                        </div>

                        {hasErrors ? (
                            <div className="rounded-md border border-red-100 bg-red-50 p-3 space-y-2">
                                <p className="flex items-center gap-1.5 text-sm font-medium text-red-700">
                                    <AlertCircle className="w-4 h-4" /> {c.errorsTitle}
                                </p>
                                <ul className="list-disc ps-5 space-y-0.5 text-xs text-red-700 max-h-48 overflow-y-auto">
                                    {preview.errors.map((e) => <li key={e}>{e}</li>)}
                                </ul>
                                <p className="text-xs text-red-600">{c.errorsNote}</p>
                            </div>
                        ) : (
                            <Alert tone="info">{c.ready}</Alert>
                        )}
                    </div>
                )}

                {step === 'done' && result && (
                    <div className="space-y-3">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                            <CheckCircle className="w-4 h-4" /> {c.done}
                        </p>
                        {counts(result)}
                    </div>
                )}
            </div>

            <ModalFooter>
                {step === 'review' && (
                    <>
                        <Button variant="secondary" onClick={reset} disabled={busy}>{c.chooseAnother}</Button>
                        <Button variant="primary" onClick={() => void runImport()} loading={busy} disabled={hasErrors || busy}>
                            {busy ? c.importing : c.importNow}
                        </Button>
                    </>
                )}
                {step !== 'review' && (
                    <Button variant="secondary" onClick={close} disabled={busy}>{t.common.close}</Button>
                )}
            </ModalFooter>
        </ModalShell>
    );
}
