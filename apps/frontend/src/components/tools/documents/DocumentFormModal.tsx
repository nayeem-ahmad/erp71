'use client';

import { useRef, useState } from 'react';
import { FileText, Trash2 } from 'lucide-react';
import { BUSINESS_DOCUMENT_TYPES, DEFAULT_DOCUMENT_REMIND_DAYS, type BusinessDocumentType } from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Field, FormGrid, Input, Select, Textarea } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { fileToDataUrl, shrinkImage } from '../files';
import type { BusinessDocument } from '../types';

/** The server takes about 3.4 MB of file; a PDF has to fit as it is. */
export const MAX_DOCUMENT_BYTES = 3 * 1024 * 1024;
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const REMIND_OPTIONS = [7, 15, 30, 60, 90];

/**
 * Add or edit a document. The details save first; the scanned copy goes up
 * after, so a failed upload never loses what was typed.
 */
export function DocumentFormModal({
    document: existing,
    onClose,
    onSaved,
}: {
    document: BusinessDocument | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.tools.documents;
    const f = m.form;
    const fileRef = useRef<HTMLInputElement>(null);

    const [docType, setDocType] = useState<BusinessDocumentType>(existing?.doc_type ?? 'TRADE_LICENSE');
    const [title, setTitle] = useState(existing?.title ?? m.types.TRADE_LICENSE);
    const [titleTouched, setTitleTouched] = useState(!!existing);
    const [number, setNumber] = useState(existing?.number ?? '');
    const [issuingAuthority, setIssuingAuthority] = useState(existing?.issuing_authority ?? '');
    const [issueDate, setIssueDate] = useState(existing?.issue_date ?? '');
    const [expiryDate, setExpiryDate] = useState(existing?.expiry_date ?? '');
    const [remindDays, setRemindDays] = useState(existing?.remind_days_before ?? DEFAULT_DOCUMENT_REMIND_DAYS);
    const [notes, setNotes] = useState(existing?.notes ?? '');
    const [file, setFile] = useState<File | null>(null);
    const [fileError, setFileError] = useState<string | null>(null);
    const [removeFile, setRemoveFile] = useState(false);
    const [titleError, setTitleError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const pickType = (next: BusinessDocumentType) => {
        setDocType(next);
        // The name follows the type until someone types their own.
        if (!titleTouched) setTitle(next === 'OTHER' ? '' : m.types[next]);
    };

    const pickFile = (picked: File | undefined) => {
        setFileError(null);
        if (!picked) return setFile(null);
        if (!ACCEPTED.includes(picked.type)) {
            setFileError(f.fileType);
            return;
        }
        // Photos are shrunk before upload, so only a PDF has to fit as it is.
        if (picked.type === 'application/pdf' && picked.size > MAX_DOCUMENT_BYTES) {
            setFileError(f.fileTooLarge);
            return;
        }
        setFile(picked);
        setRemoveFile(false);
    };

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!title.trim()) {
            setTitleError(f.required);
            return;
        }
        setTitleError(null);
        const body = {
            docType,
            title: title.trim(),
            number: number.trim() || null,
            issuingAuthority: issuingAuthority.trim() || null,
            issueDate: issueDate || null,
            expiryDate: expiryDate || null,
            remindDaysBefore: remindDays,
            notes: notes.trim() || null,
        };
        setSaving(true);
        try {
            const saved = existing ? await api.updateBusinessDocument(existing.id, body) : await api.createBusinessDocument(body);
            if (file) {
                try {
                    const payload =
                        file.type === 'application/pdf'
                            ? { fileBase64: await fileToDataUrl(file), mimeType: file.type, fileName: file.name }
                            : await shrinkImage(file, 2000, 0.85).then((img) => ({ fileBase64: img.dataUrl, mimeType: img.mimeType, fileName: file.name }));
                    await api.uploadBusinessDocumentFile(saved.id, payload);
                } catch (error: unknown) {
                    toast.error(error instanceof Error && error.message ? `${f.uploadFailed} ${error.message}` : f.uploadFailed);
                }
            } else if (removeFile && existing?.file_url) {
                await api.removeBusinessDocumentFile(saved.id);
            }
            toast.success(m.saved);
            onSaved();
        } catch (error: unknown) {
            toast.error(error instanceof Error && error.message ? error.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="md" onBackdropClick={onClose} dismissOnBackdrop={false}>
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" noValidate>
                <ModalHeader title={existing ? m.editDocument : m.newDocument} onClose={onClose} />
                <div className="space-y-3 overflow-y-auto p-4">
                    <FormGrid>
                        <Field label={f.type} htmlFor="doc-type">
                            <Select id="doc-type" value={docType} onChange={(e) => pickType(e.target.value as BusinessDocumentType)} className="w-full">
                                {BUSINESS_DOCUMENT_TYPES.map((value) => (
                                    <option key={value} value={value}>
                                        {m.types[value]}
                                    </option>
                                ))}
                            </Select>
                        </Field>
                        <Field label={f.title} required error={titleError ?? undefined} htmlFor="doc-title">
                            <Input
                                id="doc-title"
                                value={title}
                                onChange={(e) => {
                                    setTitle(e.target.value);
                                    setTitleTouched(true);
                                }}
                                maxLength={200}
                                error={!!titleError}
                                className="w-full"
                            />
                        </Field>
                        <Field label={f.number} htmlFor="doc-number">
                            <Input id="doc-number" value={number} onChange={(e) => setNumber(e.target.value)} maxLength={100} className="w-full" />
                        </Field>
                        <Field label={f.issuingAuthority} htmlFor="doc-authority">
                            <Input id="doc-authority" value={issuingAuthority} onChange={(e) => setIssuingAuthority(e.target.value)} placeholder={f.issuingAuthorityPlaceholder} maxLength={200} className="w-full" />
                        </Field>
                        <Field label={f.issueDate} htmlFor="doc-issue">
                            <Input id="doc-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className="w-full" />
                        </Field>
                        <Field label={f.expiryDate} hint={f.expiryHint} htmlFor="doc-expiry">
                            <Input id="doc-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} className="w-full" />
                        </Field>
                        {expiryDate && (
                            <Field label={f.remindDaysBefore} hint={f.remindHint} htmlFor="doc-remind">
                                <Select id="doc-remind" value={remindDays} onChange={(e) => setRemindDays(Number(e.target.value))} className="w-full">
                                    {[...new Set([...REMIND_OPTIONS, remindDays])].sort((a, b) => a - b).map((days) => (
                                        <option key={days} value={days}>
                                            {fmt(f.remindOption, { days })}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                        )}
                    </FormGrid>

                    <Field label={f.file} hint={fileError ? undefined : f.fileHint} error={fileError ?? undefined} htmlFor="doc-file">
                        <div className="space-y-2">
                            {existing?.file_url && !removeFile && !file && (
                                <div className="flex items-center justify-between gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm">
                                    <a href={existing.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-blue-600 hover:underline">
                                        <FileText className="h-4 w-4 shrink-0" aria-hidden />
                                        <span className="truncate">{fmt(f.currentFile, { name: existing.file_name ?? '' })}</span>
                                    </a>
                                    <Button type="button" variant="ghost" size="sm" onClick={() => setRemoveFile(true)} aria-label={f.removeFile} title={f.removeFile}>
                                        <Trash2 className="h-4 w-4 text-red-600" aria-hidden />
                                    </Button>
                                </div>
                            )}
                            <input
                                ref={fileRef}
                                id="doc-file"
                                type="file"
                                accept={ACCEPTED.join(',')}
                                onChange={(e) => pickFile(e.target.files?.[0])}
                                className="block w-full text-sm text-gray-600 file:me-3 file:min-h-touch file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:text-sm file:text-gray-700 hover:file:bg-gray-200 md:file:min-h-0 md:file:py-1.5"
                            />
                        </div>
                    </Field>

                    <Field label={f.notes} htmlFor="doc-notes">
                        <Textarea id="doc-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} rows={2} className="w-full" />
                    </Field>
                </div>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" loading={saving} disabled={saving}>
                        {saving ? f.saving : f.save}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}
