'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Contact, ScanLine, Sparkles } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { PageShell, PageHeader, Button, FormFooter } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import BusinessCardScanner, { type ScannedCard, type ScannedCardImage } from '../BusinessCardScanner';
import {
    ContactFormFields,
    SCANNED_CARD_IMAGE_STORAGE_KEY,
    SCANNED_CARD_STORAGE_KEY,
    applyScannedCard,
    contactFormToPayload,
    emptyContactForm,
    validateContactForm,
    type ContactFormErrors,
} from '../contact-form-fields';

export default function NewContactPage() {
    const { t } = useI18n();
    const m = t.crm.contacts;
    const c = t.common;
    const router = useRouter();

    const [form, setForm] = useState(emptyContactForm());
    const [errors, setErrors] = useState<ContactFormErrors>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [scannerOpen, setScannerOpen] = useState(false);
    const [scannedNotice, setScannedNotice] = useState(false);
    const [fromCard, setFromCard] = useState(false);
    const [cardImage, setCardImage] = useState<ScannedCardImage | null>(null);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    // Drain a scan handed over from the contacts list. Removed immediately so a
    // later visit to this page does not resurrect a card the user walked away from.
    useEffect(() => {
        let stored: string | null = null;
        let storedImage: string | null = null;
        try {
            stored = sessionStorage.getItem(SCANNED_CARD_STORAGE_KEY);
            if (stored) sessionStorage.removeItem(SCANNED_CARD_STORAGE_KEY);
            storedImage = sessionStorage.getItem(SCANNED_CARD_IMAGE_STORAGE_KEY);
            if (storedImage) sessionStorage.removeItem(SCANNED_CARD_IMAGE_STORAGE_KEY);
        } catch {
            return;
        }
        if (!stored) return;
        try {
            const fields = JSON.parse(stored) as ScannedCard;
            setForm((prev) => applyScannedCard(prev, fields));
            setFromCard(true);
            setScannedNotice(true);
        } catch {
            // A malformed hand-off is not worth surfacing — the form stays empty.
        }
        try {
            if (storedImage) setCardImage(JSON.parse(storedImage) as ScannedCardImage);
        } catch {
            // Same: the contact is still creatable, just without its card.
        }
    }, []);

    const applyScan = (fields: ScannedCard, image: ScannedCardImage | null) => {
        setForm((prev) => applyScannedCard(prev, fields));
        setCardImage(image);
        setFromCard(true);
        setScannedNotice(true);
        setScannerOpen(false);
    };

    const createContact = async () => {
        const validationErrors = validateContactForm(form, m.validation);
        setErrors(validationErrors);
        if (Object.keys(validationErrors).length > 0) return;
        setSaveError(null);
        setSaving(true);
        try {
            const created = await api.createContact({
                ...contactFormToPayload(form),
                ...(fromCard ? { capture_source: 'BUSINESS_CARD' } : {}),
            });

            // The card is kept only now the contact exists, so a scan the user
            // walked away from never leaves a file behind. It is also allowed to
            // fail on its own: the contact is saved either way, and losing the
            // photo must not read as losing the contact.
            if (created?.id && cardImage) {
                try {
                    await api.addContactAttachment(created.id, {
                        imageBase64: cardImage.dataUrl,
                        mimeType: cardImage.mimeType,
                        fileName: `${form.name || 'business-card'}`,
                    });
                } catch {
                    toast.error(m.scan.cardNotKept);
                }
            }

            toast.success(m.saved);
            router.push(created?.id ? routes.crm.contactDetail(created.id) : routes.crm.contacts);
        } catch (err: unknown) {
            setSaveError(err instanceof Error ? err.message : m.createFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <PageShell maxWidth="narrow">
            <PageHeader
                title={(
                    <span className="inline-flex items-center gap-3">
                        <span className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white">
                            <Contact className="w-6 h-6" />
                        </span>
                        {m.newContact}
                    </span>
                )}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    'crm',
                    [{ label: m.title, href: routes.crm.contacts }],
                    m.newContact,
                )}
                actions={
                    <Button
                        variant="secondary"
                        onClick={() => setScannerOpen(true)}
                        leftIcon={<ScanLine className="w-4 h-4" />}
                    >
                        {m.scan.cta}
                    </Button>
                }
            />

            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                {scannedNotice && (
                    <p className="mb-3 flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                        <Sparkles className="w-4 h-4 shrink-0" />
                        {m.scan.applied}
                    </p>
                )}

                <ContactFormFields
                    form={form}
                    onChange={setForm}
                    teamMembers={teamMembers}
                    errors={errors}
                />

                {saveError && <p role="alert" className="text-xs text-danger mt-3">{saveError}</p>}

                <FormFooter className="pt-6 mt-6">
                    <Link href={routes.crm.contacts} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">
                        {c.cancel}
                    </Link>
                    <Button onClick={createContact} loading={saving}>
                        {m.newContact}
                    </Button>
                </FormFooter>
            </div>

            <BusinessCardScanner
                open={scannerOpen}
                onClose={() => setScannerOpen(false)}
                onApply={applyScan}
            />
        </PageShell>
    );
}
