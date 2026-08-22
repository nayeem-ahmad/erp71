'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { useBranding } from '@/lib/branding';
import { toast } from '@/lib/toast';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Button, ConfirmDialog, PageShell, Select } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import { DEFAULT_HEADER_CONFIG, PAPER_SIZES, resolveHeaderConfig } from '@/lib/print';
// Imported from the hook module directly: `@/lib/print` stays React-free so the
// printer libs can import it without pulling in a client component.
import { clearPrintTemplateCache } from '@/lib/print/use-print-header';
import type { DeepPartial, HeaderContext, PaperSize, PrintDocType, PrintHeaderConfig } from '@/lib/print';
import HeaderEditor from './HeaderEditor';
import HeaderPreview from './HeaderPreview';

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

export default function PrintTemplatesPage() {
    const { t } = useI18n();
    const copy = t.settingsExtras.printTemplates;
    const branding = useBranding();

    const [templates, setTemplates] = useState<PrintTemplate[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [paperSize, setPaperSize] = useState<PaperSize>('A4');

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

    const handleUploadLogo = async (file: File) => {
        setUploading(true);
        try {
            const result = await api.uploadFile(file);
            if (result?.url) setConfig((current) => ({ ...current, logo: { ...current.logo, url: result.url } }));
        } catch {
            toast.error(copy.uploadFailed);
        } finally {
            setUploading(false);
        }
    };

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
        docDate: new Date().toLocaleDateString('en-BD'),
        companyName: branding.businessName ?? 'Your Business',
        storeName: branding.businessName ?? 'Main Store',
        address: '12 Motijheel C/A, Dhaka 1000',
        phone: '01711-000000',
        email: 'hello@example.com',
        website: 'example.com',
        vatRegNo: '000000000-0101',
        tin: '123456789012',
    }), [branding.businessName]);

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
                            onUploadLogo={handleUploadLogo}
                            uploading={uploading}
                        />

                        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4 lg:sticky lg:top-4 lg:self-start">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <h2 className="text-sm font-semibold text-gray-700">{copy.sections.preview}</h2>
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
