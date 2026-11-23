'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowDownUp, Copy, Download, FileUp, Eraser } from 'lucide-react';
import { Alert, Button, PageHeader, PageShell, Textarea } from '@/components/ui';
import { bijoyToUnicode, containsBanglaUnicode, looksLikeBijoy, unicodeToBijoy } from '@/lib/bijoy/bijoy-unicode';
import { convertCsvText } from '@/lib/bijoy/csv';
import { convertedFileName, decodeTextBytes, downloadBytes, encodeUtf8WithBom, encodeWindows1252 } from '@/lib/bijoy/text-files';
import { useI18n } from '@/lib/i18n';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { toast } from '@/lib/toast';

type Direction = 'toUnicode' | 'toBijoy';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Tools → Bijoy ↔ Unicode. Everything happens in the browser: nothing typed
 * or uploaded here leaves the device.
 */
export default function BijoyConverterPage() {
    const { t, fmt } = useI18n();
    const m = t.tools.bijoy;
    const fileRef = useRef<HTMLInputElement>(null);
    const [direction, setDirection] = useState<Direction>('toUnicode');
    const [input, setInput] = useState('');

    const convert = direction === 'toUnicode' ? bijoyToUnicode : unicodeToBijoy;
    const output = useMemo(() => (input ? convert(input) : ''), [input, convert]);

    // Nudge toward the right direction when the paste is plainly the other kind.
    const detected = useMemo(() => {
        if (!input.trim()) return null;
        if (containsBanglaUnicode(input)) return 'unicode' as const;
        if (looksLikeBijoy(input)) return 'bijoy' as const;
        return null;
    }, [input]);
    const mismatch = (direction === 'toUnicode' && detected === 'unicode') || (direction === 'toBijoy' && detected === 'bijoy');

    const flip = () => setDirection((current) => (current === 'toUnicode' ? 'toBijoy' : 'toUnicode'));

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(output);
            toast.success(m.copied);
        } catch {
            toast.error(m.copyFailed);
        }
    };

    const saveText = (text: string, name: string) => {
        if (direction === 'toBijoy') downloadBytes(encodeWindows1252(text), name, 'text/plain;charset=windows-1252');
        else downloadBytes(encodeUtf8WithBom(text), name, 'text/plain;charset=utf-8');
    };

    const convertFile = async (file: File | undefined) => {
        if (!file) return;
        if (file.size > MAX_FILE_BYTES) {
            toast.error(m.fileTooLarge);
            return;
        }
        try {
            const { text } = decodeTextBytes(new Uint8Array(await file.arrayBuffer()));
            const isCsv = /\.(csv|tsv)$/i.test(file.name) || file.type === 'text/csv';
            const converted = isCsv ? convertCsvText(text, convert) : convert(text);
            const suffix = direction === 'toUnicode' ? 'unicode' : 'bijoy';
            const name = convertedFileName(file.name, suffix);
            const mime = isCsv ? 'text/csv' : 'text/plain';
            if (direction === 'toBijoy') downloadBytes(encodeWindows1252(converted), name, `${mime};charset=windows-1252`);
            else downloadBytes(encodeUtf8WithBom(converted), name, `${mime};charset=utf-8`);
            toast.success(fmt(m.fileDone, { name: file.name }));
        } catch {
            toast.error(m.fileFailed);
        } finally {
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const fromLabel = direction === 'toUnicode' ? 'Bijoy' : 'Unicode';
    const toLabel = direction === 'toUnicode' ? 'Unicode' : 'Bijoy';

    return (
        <PageShell>
            <PageHeader
                title={m.title}
                subtitle={m.subtitle}
                breadcrumbs={modulePageBreadcrumbs(t.dashboardHome.breadcrumbHome, t.sidebar.modules.tools, m.title, 'tools')}
            />

            <div role="radiogroup" aria-label={m.switchDirection} className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
                {(['toUnicode', 'toBijoy'] as const).map((value) => (
                    <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={direction === value}
                        onClick={() => setDirection(value)}
                        className={`min-h-touch rounded px-3 text-sm md:min-h-0 md:py-1.5 ${direction === value ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                    >
                        {m[value]}
                    </button>
                ))}
            </div>

            {mismatch && (
                <Alert tone="info">
                    <span className="me-2">{detected === 'unicode' ? m.detectedUnicode : m.detectedBijoy}</span>
                    <button type="button" onClick={flip} className="font-medium text-blue-600 hover:underline">
                        {m.switchDirection}
                    </button>
                </Alert>
            )}

            <div className="grid gap-3 lg:grid-cols-2">
                <section className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <label htmlFor="bijoy-input" className="text-xs font-medium text-gray-600">
                            {m.input} · {fromLabel}
                        </label>
                        <span className="text-xs text-gray-400">{fmt(m.characters, { count: input.length })}</span>
                    </div>
                    <Textarea
                        id="bijoy-input"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder={direction === 'toUnicode' ? m.inputPlaceholderBijoy : m.inputPlaceholderUnicode}
                        rows={12}
                        spellCheck={false}
                        className="w-full font-mono"
                    />
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => setInput('')} disabled={!input}>
                            <Eraser className="h-4 w-4" aria-hidden /> {m.clear}
                        </Button>
                    </div>
                </section>

                <section className="space-y-1.5">
                    <label htmlFor="bijoy-output" className="text-xs font-medium text-gray-600">
                        {m.output} · {toLabel}
                    </label>
                    <Textarea id="bijoy-output" value={output} readOnly rows={12} className="w-full bg-white" />
                    <div className="flex flex-wrap gap-2">
                        <Button onClick={() => void copy()} disabled={!output}>
                            <Copy className="h-4 w-4" aria-hidden /> {m.copy}
                        </Button>
                        <Button variant="secondary" onClick={() => saveText(output, `converted-${direction === 'toUnicode' ? 'unicode' : 'bijoy'}.txt`)} disabled={!output}>
                            <Download className="h-4 w-4" aria-hidden /> {m.download}
                        </Button>
                        <Button
                            variant="secondary"
                            onClick={() => {
                                setInput(output);
                                flip();
                            }}
                            disabled={!output}
                        >
                            <ArrowDownUp className="h-4 w-4" aria-hidden /> {m.swap}
                        </Button>
                    </div>
                    {direction === 'toBijoy' && output && <p className="text-xs text-gray-500">{m.bijoyFontNote}</p>}
                </section>
            </div>

            <section className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
                <h2 className="text-sm font-medium text-gray-900">{m.fileTitle}</h2>
                <p className="text-xs text-gray-500">{m.fileHint}</p>
                <input ref={fileRef} type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" className="hidden" onChange={(e) => void convertFile(e.target.files?.[0])} />
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                    <FileUp className="h-4 w-4" aria-hidden /> {m.pickFile} ({m[direction]})
                </Button>
            </section>

            <p className="text-xs text-gray-400">{m.limits}</p>
        </PageShell>
    );
}
