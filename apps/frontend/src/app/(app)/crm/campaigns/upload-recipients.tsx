'use client';

import { useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import {
    validateCampaignRows,
    type CampaignRowIssue,
    type ValidCampaignRow,
} from '@erp71/shared-types';
import { parseSpreadsheetFile, autoMapHeaders } from '@/lib/spreadsheet';
import { useI18n } from '@/lib/i18n';
import { Button, Field, Select } from '@/components/ui';

interface UploadRecipientsProps {
    rows: ValidCampaignRow[];
    issues: CampaignRowIssue[];
    onChange: (rows: ValidCampaignRow[], issues: CampaignRowIssue[]) => void;
}

const TEMPLATE = 'Email,Name,Subject,Message\nrahim@example.com,Rahim Uddin,Eid offer,Hello Rahim\n';

export default function UploadRecipients({ rows, issues, onChange }: UploadRecipientsProps) {
    const { t } = useI18n();
    const m = t.crmCampaigns.upload;
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [headers, setHeaders] = useState<string[]>([]);
    const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
    const [mapping, setMapping] = useState<Record<string, string>>({});
    const [fileError, setFileError] = useState<string | null>(null);

    const FIELDS = [
        { key: 'email', label: m.fieldEmail, required: true },
        { key: 'name', label: m.fieldName, required: false },
        { key: 'subject', label: m.fieldSubject, required: true },
        { key: 'message', label: m.fieldMessage, required: true },
    ];

    const revalidate = (raw: Record<string, string>[], map: Record<string, string>) => {
        const mapped = raw.map((r) => ({
            email: map.email ? r[map.email] : '',
            name: map.name ? r[map.name] : '',
            subject: map.subject ? r[map.subject] : '',
            message: map.message ? r[map.message] : '',
        }));
        const result = validateCampaignRows(mapped);
        setFileError(result.fileError);
        onChange(result.rows, result.issues);
    };

    const handleFile = async (file: File) => {
        setFileError(null);
        try {
            const parsed = await parseSpreadsheetFile(file);
            const map = autoMapHeaders(parsed.headers, FIELDS);
            setHeaders(parsed.headers);
            setRawRows(parsed.rows);
            setMapping(map);
            revalidate(parsed.rows, map);
        } catch (e) {
            setHeaders([]);
            setRawRows([]);
            onChange([], []);
            setFileError(e instanceof Error ? e.message : 'Failed to read the file.');
        }
    };

    const handleMappingChange = (key: string, header: string) => {
        const next = { ...mapping, [key]: header };
        setMapping(next);
        revalidate(rawRows, next);
    };

    const downloadTemplate = () => {
        const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'campaign-recipients.csv';
        link.click();
        URL.revokeObjectURL(url);
    };

    if (rawRows.length === 0) {
        return (
            <div className="space-y-3">
                <div
                    onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-gray-200 rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 transition-colors min-h-touch"
                >
                    <Upload className="w-8 h-8 text-gray-300 mb-3" />
                    <p className="font-semibold text-gray-700 text-sm">{m.dropzone}</p>
                    <p className="text-xs text-gray-400 mt-1">{m.dropzoneHint}</p>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
                />
                <button
                    type="button"
                    onClick={downloadTemplate}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                    {m.downloadTemplate}
                </button>
                {fileError && (
                    <p className="text-xs text-danger font-semibold">{fileError}</p>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="space-y-3">
                <p className="text-xs text-gray-500">{m.mapHint}</p>
                {FIELDS.map((field) => (
                    <Field key={field.key} label={field.label} required={field.required}>
                        <Select
                            value={mapping[field.key] ?? ''}
                            onChange={(e) => handleMappingChange(field.key, e.target.value)}
                        >
                            <option value="">{m.skipColumn}</option>
                            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                        </Select>
                    </Field>
                ))}
                <p className="text-xs text-gray-400">{m.nameFallbackHint}</p>
            </div>

            {fileError && (
                <div className="flex items-start gap-2 p-3 bg-danger-light rounded-lg">
                    <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                    <p className="text-xs text-danger-text font-semibold">{fileError}</p>
                </div>
            )}

            {rows.length > 0 && (
                <div className="space-y-2">
                    <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        <p className="text-sm font-semibold text-gray-900">
                            {m.previewTitle.replace('{count}', String(rows.length))}
                        </p>
                    </div>
                    <p className="text-xs text-gray-400">
                        {m.previewHint
                            .replace('{shown}', String(Math.min(5, rows.length)))
                            .replace('{count}', String(rows.length))}
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-gray-200">
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-gray-50">
                                    <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.fieldEmail}</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.fieldName}</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-500">{m.fieldSubject}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.slice(0, 5).map((r) => (
                                    <tr key={r.email} className="border-t border-gray-100">
                                        <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{r.email}</td>
                                        <td className="px-3 py-2 text-gray-700 max-w-[120px] truncate">{r.name}</td>
                                        <td className="px-3 py-2 text-gray-700 max-w-[160px] truncate">{r.subject}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {issues.length > 0 && (
                <div className="p-3 bg-amber-50 rounded-lg">
                    <p className="text-xs font-semibold text-amber-700 mb-1.5">
                        {m.issuesTitle.replace('{count}', String(issues.length))}
                    </p>
                    <ul className="space-y-1 max-h-40 overflow-y-auto">
                        {issues.slice(0, 50).map((issue) => (
                            <li key={`${issue.line}-${issue.email}`} className="text-xs text-amber-800">
                                {m.issueLine
                                    .replace('{line}', String(issue.line))
                                    .replace('{email}', issue.email || '—')
                                    .replace('{reason}', issue.reason)}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <Button
                variant="secondary"
                onClick={() => { setRawRows([]); setHeaders([]); setFileError(null); onChange([], []); }}
            >
                {m.changeFile}
            </Button>
        </div>
    );
}
