'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { directUpload, withServerFallback } from '@/lib/uploads/direct-upload';
import { useI18n } from '@/lib/i18n';
import { useBranding } from '@/lib/branding';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Button, ConfirmDialog, PageShell, Select } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import {
    DEFAULT_HEADER_CONFIG,
    isThermalPaper,
    OVERRIDE_PAPERS,
    PAPER_SIZES,
    paperSizeLabel,
    papersWithOverrides,
    resolveHeaderConfig,
} from '@/lib/print';
// Imported from the hook module directly: `@/lib/print` stays React-free so the
// printer libs can import it without pulling in a client component.
import { clearPrintTemplateCache } from '@/lib/print/use-print-header';
import type { DeepPartial, HeaderContext, PaperSize, PrintDocType, PrintHeaderConfig } from '@/lib/print';
import { formatDate } from '@/lib/format';
import BranchAssignments from './BranchAssignments';
import HeaderEditor from './HeaderEditor';
import HeaderPreview from './HeaderPreview';
import PaperSizeOverrides from './PaperSizeOverrides';
import { CheckboxRow } from './TemplateBlocks';

interface PrintTemplate {
    id: string;
    name: string;
    is_default: boolean;
    doc_types: PrintDocType[];
    config: DeepPartial<PrintHeaderConfig>;
}

const PAPER_LABELS: Record<PaperSize, string> = {
    A4: 'A4 (210 × 297 mm)',
    A5: 'A5 (148 × 210 mm)',
    Letter: 'Letter (8.5 × 11 in)',
    Thermal80: '80mm thermal',
    Thermal58: '58mm thermal',
};

/**
 * A stand-in QR code for the preview: three finder squares and a scatter of
 * modules, drawn as SVG. It encodes nothing — it only has to look like the code
 * a document prints, so its size and position can be judged on the page.
 */
function sampleQrDataUrl(): string {
    const size = 25;
    const finder = (x: number, y: number) =>
        `M${x} ${y}h7v7h-7zM${x + 1} ${y + 1}v5h5v-5zM${x + 2} ${y + 2}h3v3h-3z`;
    const nearFinder = (x: number, y: number) =>
        (x < 8 && y < 8) || (x >= size - 8 && y < 8) || (x < 8 && y >= size - 8);
    // An integer hash of the cell, so about half the modules fill, evenly.
    const filled = (x: number, y: number) => {
        let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
        h = Math.imul(h ^ (h >>> 13), 1274126177);
        return ((h ^ (h >>> 16)) & 1) === 1;
    };
    let modules = '';
    for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
            if (!nearFinder(x, y) && filled(x, y)) modules += `M${x} ${y}h1v1h-1z`;
        }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${size + 2} ${size + 2}">`
        + `<rect x="-1" y="-1" width="${size + 2}" height="${size + 2}" fill="#fff"/>`
        + `<path fill-rule="evenodd" d="${finder(0, 0)}${finder(size - 7, 0)}${finder(0, size - 7)}${modules}"/>`
        + '</svg>';
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const SAMPLE_QR = sampleQrDataUrl();

export default function PrintTemplatesPage() {
    const { t, fmt } = useI18n();
    const copy = t.settingsExtras.printTemplates;
    const branding = useBranding();

    const [templates, setTemplates] = useState<PrintTemplate[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [paperSize, setPaperSize] = useState<PaperSize>('A4');
    const [previewQr, setPreviewQr] = useState(true);

    const [name, setName] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [docTypes, setDocTypes] = useState<PrintDocType[]>([]);
    const [config, setConfig] = useState<PrintHeaderConfig>(DEFAULT_HEADER_CONFIG);

    /** Loads a template into the editor, or resets it for a new one. */
    const openTemplate = useCallback((template: PrintTemplate | null, isFirst: boolean) => {
        setSelectedId(template?.id ?? null);
        setName(template?.name ?? '');
        setIsDefault(template?.is_default ?? isFirst);
        setDocTypes(template?.doc_types ?? []);
        // Merge over the defaults so a partial stored config still fills the form.
        setConfig(resolveHeaderConfig(template?.config, 'A4'));
    }, []);

    const loadTemplates = useCallback(async (selectId?: string) => {
        setLoading(true);
        try {
            const data: PrintTemplate[] = (await api.getPrintTemplates()) ?? [];
            setTemplates(data);
            const target = selectId ? data.find((item) => item.id === selectId) : data[0];
            openTemplate(target ?? null, data.length === 0);
        } catch {
            setTemplates([]);
            openTemplate(null, true);
        } finally {
            setLoading(false);
        }
    }, [openTemplate]);

    useEffect(() => {
        void loadTemplates();
    }, [loadTemplates]);

    /**
     * Shared by the logo slot and every header/footer image — returns the URL
     * so each caller decides which part of the config it lands in.
     */
    const uploadImage = useCallback(async (file: File): Promise<string | null> => {
        setUploading(true);
        try {
            const result: { url?: string } | null = await withServerFallback(
                async () => ({ url: (await directUpload(file, 'print-template-image')).secure_url }),
                () => api.uploadFile(file),
            );
            return result?.url ?? null;
        } catch {
            toast.error(copy.uploadFailed);
            return null;
        } finally {
            setUploading(false);
        }
    }, [copy.uploadFailed]);

    const handleSave = async () => {
        setSaving(true);
        try {
            const payload = {
                name: name.trim() || copy.newTemplate,
                is_default: isDefault,
                doc_types: docTypes,
                config,
            };
            const saved = selectedId
                ? await api.updatePrintTemplate(selectedId, payload)
                : await api.createPrintTemplate(payload);

            // Printers cache the resolved template — drop it so the next print
            // picks up what was just saved.
            clearPrintTemplateCache();
            toast.success(copy.saved);
            await loadTemplates(saved?.id ?? selectedId ?? undefined);
        } catch (error: any) {
            toast.error(error?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!selectedId) return;
        setConfirmDelete(false);
        try {
            await api.deletePrintTemplate(selectedId);
            clearPrintTemplateCache();
            toast.success(copy.deleted);
            await loadTemplates();
        } catch (error: any) {
            toast.error(error?.message || copy.deleteFailed);
        }
    };

    const previewContext: HeaderContext = useMemo(() => ({
        docTitle: 'Invoice',
        docNumber: 'INV-000123',
        docDate: formatDate(new Date()),
        companyName: branding.businessName ?? 'Your Business',
        storeName: branding.businessName ?? 'Main Store',
        address: '12 Motijheel C/A, Dhaka 1000',
        phone: '01711-000000',
        email: 'hello@example.com',
        website: 'example.com',
        vatRegNo: '000000000-0101',
        tin: '123456789012',
        // The documents that print a QR code print it in place of the number
        // and date, so the preview does the same. They only do on sheet paper:
        // no roll carries the code in its letterhead.
        ...(previewQr && !isThermalPaper(paperSize) ? { docQr: SAMPLE_QR, hideDocMeta: true } : {}),
    }), [branding.businessName, previewQr, paperSize]);

    // Papers that print sizes of their own, named on the main design's view so
    // nobody edits a size on A4 and wonders why A5 did not follow.
    const papersDiffering = papersWithOverrides(config).filter((paper) => paper !== paperSize);

    return (
        <PageShell>
            <PageHeader
                title={copy.title}
                subtitle={copy.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    copy.title,
                    'settings',
                )}
                actions={
                    <div className="flex items-center gap-2">
                        {selectedId ? (
                            <Button variant="secondary" onClick={() => setConfirmDelete(true)}>
                                <Trash2 className="h-4 w-4" />
                                {copy.delete}
                            </Button>
                        ) : null}
                        <Button variant="secondary" onClick={() => openTemplate(null, templates.length === 0)}>
                            <Plus className="h-4 w-4" />
                            {copy.newTemplate}
                        </Button>
                        <Button onClick={handleSave} disabled={saving}>
                            {saving ? copy.saving : copy.save}
                        </Button>
                    </div>
                }
            />

            {loading ? (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-400">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {copy.loading}
                </div>
            ) : (
                <div className="mt-4 space-y-4">
                    <BranchAssignments templates={templates} />

                    {templates.length === 0 ? (
                        <p className="rounded-lg border border-gray-200 bg-white p-3 text-xs text-gray-500 md:p-4">
                            {copy.empty}
                        </p>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            {templates.map((template) => (
                                <button
                                    key={template.id}
                                    type="button"
                                    onClick={() => openTemplate(template, false)}
                                    className={`rounded-md border px-3 py-2 text-xs max-md:min-h-touch ${
                                        template.id === selectedId
                                            ? 'border-blue-600 bg-blue-50 text-blue-700'
                                            : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    {template.name}
                                    {template.is_default ? (
                                        <span className="ms-2 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">
                                            {copy.defaultBadge}
                                        </span>
                                    ) : null}
                                </button>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <HeaderEditor
                            name={name}
                            onNameChange={setName}
                            isDefault={isDefault}
                            onIsDefaultChange={setIsDefault}
                            docTypes={docTypes}
                            onDocTypesChange={setDocTypes}
                            config={config}
                            onConfigChange={setConfig}
                            onUpload={uploadImage}
                            uploading={uploading}
                        />

                        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4 lg:sticky lg:top-4 lg:self-start">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h2 className="text-sm font-semibold text-gray-700">{copy.sections.preview}</h2>
                                <div className="flex flex-wrap items-center gap-3">
                                    <CheckboxRow
                                        label={copy.fields.previewQr}
                                        checked={previewQr}
                                        onChange={setPreviewQr}
                                    />
                                    <Select
                                        aria-label={copy.fields.paperSize}
                                        className="w-auto"
                                        value={paperSize}
                                        onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                                    >
                                        {PAPER_SIZES.map((size) => (
                                            <option key={size} value={size}>{PAPER_LABELS[size]}</option>
                                        ))}
                                    </Select>
                                </div>
                            </div>

                            {OVERRIDE_PAPERS.includes(paperSize) ? (
                                <PaperSizeOverrides
                                    config={config}
                                    paperSize={paperSize}
                                    onConfigChange={setConfig}
                                />
                            ) : papersDiffering.length ? (
                                <p className="text-xs text-gray-500">
                                    {fmt(copy.paperSizes.othersDiffer, {
                                        papers: papersDiffering.map(paperSizeLabel).join(', '),
                                    })}
                                </p>
                            ) : null}

                            <HeaderPreview
                                config={config}
                                paperSize={paperSize}
                                context={previewContext}
                                bodyLabel={copy.previewBody}
                            />
                        </section>
                    </div>
                </div>
            )}

            <ConfirmDialog
                open={confirmDelete}
                title={copy.deleteConfirmTitle}
                prompt={copy.deleteConfirmBody}
                confirmLabel={copy.delete}
                cancelLabel={t.common.cancel}
                danger
                onConfirm={handleDelete}
                onCancel={() => setConfirmDelete(false)}
            />
        </PageShell>
    );
}
