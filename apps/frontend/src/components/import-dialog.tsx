'use client';

import { useRef, useState } from 'react';
import { Upload, X, ChevronRight, CheckCircle, AlertCircle, RotateCcw } from 'lucide-react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

export interface ImportField {
  key: string;
  label: string;
  required: boolean;
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  entityLabel: string;
  fields: ImportField[];
  importFn: (rows: Record<string, unknown>[], mode: 'skip' | 'upsert') => Promise<ImportResult>;
  onSuccess: () => void;
}

type Step = 'upload' | 'map' | 'preview' | 'result';

async function parseFile(file: File): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  if (!ext || !['csv', 'xlsx', 'xls'].includes(ext)) {
    throw new Error(`Unsupported file type ".${ext ?? ''}". Please upload a .csv or .xlsx file.`);
  }
  if (ext === 'csv' || file.type === 'text/csv') {
    return new Promise((resolve, reject) => {
      Papa.parse<Record<string, string>>(file, {
        header: true,
        skipEmptyLines: true,
        complete: (r) => resolve({ headers: r.meta.fields ?? [], rows: r.data }),
        error: (err) => reject(new Error(err.message)),
      });
    });
  }
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json<Record<string, string>>(ws, { defval: '' });
  const headers = json.length > 0 ? Object.keys(json[0]) : [];
  return { headers, rows: json };
}

function applyMapping(
  rawRows: Record<string, string>[],
  mapping: Record<string, string>,
): Record<string, unknown>[] {
  return rawRows.map((raw) => {
    const out: Record<string, unknown> = {};
    for (const [key, header] of Object.entries(mapping)) {
      if (header) out[key] = raw[header] ?? null;
    }
    return out;
  });
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'upload', label: 'Upload' },
  { key: 'map', label: 'Map Fields' },
  { key: 'preview', label: 'Preview' },
  { key: 'result', label: 'Result' },
];

export function ImportDialog({
  open,
  onClose,
  entityLabel,
  fields,
  importFn,
  onSuccess,
}: ImportDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('upload');
  const [rawHeaders, setRawHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<'skip' | 'upsert'>('skip');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  if (!open) return null;

  const reset = () => {
    setStep('upload');
    setRawHeaders([]);
    setRawRows([]);
    setMapping({});
    setMode('skip');
    setResult(null);
    setParseError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleFile = async (file: File) => {
    setParseError(null);
    try {
      const { headers, rows } = await parseFile(file);
      if (rows.length === 0) { setParseError('File has no data rows.'); return; }
      setRawHeaders(headers);
      setRawRows(rows);
      const auto: Record<string, string> = {};
      for (const field of fields) {
        const match = headers.find(
          (h) =>
            h.trim().toLowerCase() === field.label.toLowerCase() ||
            h.trim().toLowerCase() === field.key.toLowerCase(),
        );
        auto[field.key] = match ?? '';
      }
      setMapping(auto);
      setStep('map');
    } catch (e: any) {
      setParseError(`Failed to parse file: ${e?.message ?? 'unknown error'}`);
    }
  };

  const handleImport = async () => {
    setSubmitting(true);
    try {
      const mapped = applyMapping(rawRows, mapping);
      const res = await importFn(mapped, mode);
      setResult(res);
      setStep('result');
      if (res.created > 0 || res.updated > 0) onSuccess();
    } catch (e: any) {
      setResult({ created: 0, updated: 0, skipped: 0, errors: [`Import failed: ${e?.message ?? 'unknown error'}`] });
      setStep('result');
    } finally {
      setSubmitting(false);
    }
  };

  const canProceedFromMap = fields.filter((f) => f.required).every((f) => mapping[f.key]);
  const mappedFields = fields.filter((f) => mapping[f.key]);
  const previewRows = applyMapping(rawRows.slice(0, 5), mapping);
  const stepIndex = STEPS.findIndex((s) => s.key === step);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-6 border-b border-gray-100 flex items-start justify-between shrink-0">
          <div>
            <h2 className="text-lg font-black tracking-tight">Import {entityLabel}</h2>
            <div className="flex items-center gap-2 mt-2">
              {STEPS.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1.5">
                  <span className={`text-xs font-black uppercase tracking-widest ${i <= stepIndex ? 'text-blue-600' : 'text-gray-300'}`}>
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && <ChevronRight className="w-3 h-3 text-gray-300" />}
                </div>
              ))}
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto flex-1">
          {step === 'upload' && (
            <div>
              <div
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-200 rounded-2xl p-12 flex flex-col items-center justify-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition-colors"
              >
                <Upload className="w-10 h-10 text-gray-300 mb-4" />
                <p className="font-black text-gray-700 text-sm">Drag & drop or click to browse</p>
                <p className="text-xs text-gray-400 mt-1">Supports .csv and .xlsx</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
              />
              {parseError && (
                <div className="mt-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold">{parseError}</div>
              )}
            </div>
          )}

          {step === 'map' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">
                Map your spreadsheet columns to system fields. Required fields are marked <span className="text-red-500">*</span>.
              </p>
              <div className="space-y-3">
                {fields.map((field) => (
                  <div key={field.key} className="flex items-center gap-3">
                    <label className="text-xs font-black uppercase tracking-widest text-gray-700 w-44 shrink-0">
                      {field.label}
                      {field.required && <span className="text-red-500 ml-0.5">*</span>}
                    </label>
                    <select
                      value={mapping[field.key] ?? ''}
                      onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value })}
                      className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-medium focus:ring-2 focus:ring-blue-500/20 focus:border-blue-300 outline-none"
                    >
                      <option value="">— skip —</option>
                      {rawHeaders.map((h) => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 pt-4">
                <p className="text-xs font-black uppercase tracking-widest text-gray-500 mb-2">Duplicate handling</p>
                <div className="flex gap-6">
                  {(['skip', 'upsert'] as const).map((m) => (
                    <label key={m} className="flex items-center gap-2 cursor-pointer">
                      <input type="radio" value={m} checked={mode === m} onChange={() => setMode(m)} className="accent-blue-600" />
                      <span className="text-sm font-bold text-gray-700">
                        {m === 'skip' ? 'Skip duplicates' : 'Update existing'}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div>
              <p className="text-xs text-gray-500 mb-3">
                Showing first {previewRows.length} of {rawRows.length} rows after mapping.
              </p>
              <div className="overflow-x-auto rounded-xl border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {mappedFields.map((f) => (
                        <th key={f.key} className="px-3 py-2 text-left font-black uppercase tracking-widest text-gray-500 whitespace-nowrap">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {mappedFields.map((f) => (
                          <td key={f.key} className="px-3 py-2 text-gray-700 font-medium max-w-[160px] truncate">{String(row[f.key] ?? '')}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {step === 'result' && result && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 bg-green-50 rounded-2xl">
                <CheckCircle className="w-6 h-6 text-green-500 shrink-0" />
                <p className="text-sm">
                  <span className="font-black text-green-700">{result.created}</span> created ·{' '}
                  <span className="font-black text-blue-700">{result.updated}</span> updated ·{' '}
                  <span className="font-black text-gray-500">{result.skipped}</span> skipped
                </p>
              </div>
              {result.errors.length > 0 && (
                <div className="p-4 bg-red-50 rounded-2xl">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertCircle className="w-4 h-4 text-red-500" />
                    <span className="text-xs font-black uppercase tracking-widest text-red-600">
                      {result.errors.length} row{result.errors.length !== 1 ? 's' : ''} skipped due to errors
                    </span>
                  </div>
                  <ul className="space-y-1 max-h-48 overflow-y-auto">
                    {result.errors.map((e, i) => (
                      <li key={i} className="text-xs text-red-600 font-medium">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 flex justify-between items-center shrink-0">
          <div>
            {step === 'map' && (
              <button onClick={() => setStep('upload')} className="text-sm font-black text-gray-400 hover:text-gray-600">
                ← Back
              </button>
            )}
            {step === 'preview' && (
              <button onClick={() => setStep('map')} className="text-sm font-black text-gray-400 hover:text-gray-600">
                ← Back
              </button>
            )}
            {step === 'result' && (
              <button onClick={reset} className="flex items-center gap-2 text-sm font-black text-gray-500 hover:text-gray-700">
                <RotateCcw className="w-4 h-4" />
                Import another file
              </button>
            )}
          </div>
          <div className="flex gap-3">
            {step !== 'result' && (
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-white border border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-50"
              >
                Cancel
              </button>
            )}
            {step === 'map' && (
              <button
                onClick={() => setStep('preview')}
                disabled={!canProceedFromMap}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Preview
              </button>
            )}
            {step === 'preview' && (
              <button
                onClick={() => void handleImport()}
                disabled={submitting}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md disabled:opacity-50"
              >
                {submitting ? 'Importing…' : `Import ${rawRows.length} rows`}
              </button>
            )}
            {step === 'result' && (
              <button
                onClick={onClose}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-md"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
