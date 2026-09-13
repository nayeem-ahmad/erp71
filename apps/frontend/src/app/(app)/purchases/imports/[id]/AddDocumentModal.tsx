'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Input, Select, Field, Button } from '@/components/ui';

/** Mirrors IMPORT_DOC_TYPES in the backend. */
const DOC_TYPES = [
    'BL',
    'COMMERCIAL_INVOICE',
    'PACKING_LIST',
    'BILL_OF_ENTRY',
    'LC_COPY',
    'COO',
    'INSURANCE',
    'RELEASE_ORDER',
    'OTHER',
] as const;

/** Matches ATTACHMENT_MIME_TYPES on the server, which rejects anything else. */
const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Attaching a BL, Bill of Entry or LC copy.
 *
 * `ImportDocument` has had a table and an API since the module shipped and no
 * way to put a file in either: the DTO asked for a storage key that no endpoint
 * produced. The file goes up as base64 and the server keeps Cloudinary's
 * public_id, so deleting the row can delete the file.
 */
export default function AddDocumentModal({
    shipmentId,
    onClose,
    onUploaded,
}: {
    shipmentId: string;
    onClose: () => void;
    onUploaded: () => void;
}) {
    const { t } = useI18n();
    const copy = t.imports.documents;

    const [docType, setDocType] = useState<string>('BL');
    const [file, setFile] = useState<File | null>(null);
    const [saving, setSaving] = useState(false);

    const pick = (picked: File | null) => {
        if (!picked) {
            setFile(null);
            return;
        }
        // Checked here as well as on the server, so the person who picked a
        // 40 MB scan is told before waiting for the upload to fail.
        if (!ACCEPTED.includes(picked.type)) {
            toast.error(copy.wrongType);
            return;
        }
        if (picked.size > MAX_BYTES) {
            toast.error(formatMessage(copy.tooLarge, { limit: '5 MB' }));
            return;
        }
        setFile(picked);
    };

    const submit = async () => {
        if (!file) {
            toast.error(copy.file);
            return;
        }

        setSaving(true);
        try {
            const fileBase64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(file);
            });

            await api.addImportDocument(shipmentId, {
                docType,
                fileBase64,
                fileName: file.name,
                mimeType: file.type,
            });
            toast.success(copy.uploaded);
            onUploaded();
        } catch (error: any) {
            toast.error(error.message || copy.uploadFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={t.imports.detail.addDocument} onClose={onClose} />

            <div className="space-y-3 overflow-y-auto p-4">
                <Field label={copy.docType} htmlFor="doc-type">
                    <Select id="doc-type" value={docType} onChange={(e) => setDocType(e.target.value)}>
                        {DOC_TYPES.map((value) => (
                            <option key={value} value={value}>
                                {t.imports.docTypes[value]}
                            </option>
                        ))}
                    </Select>
                </Field>

                <Field label={copy.file} htmlFor="doc-file">
                    <Input
                        id="doc-file"
                        type="file"
                        accept={ACCEPTED.join(',')}
                        onChange={(e) => pick(e.target.files?.[0] ?? null)}
                    />
                </Field>
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button onClick={submit} disabled={saving || !file}>
                    {t.common.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
