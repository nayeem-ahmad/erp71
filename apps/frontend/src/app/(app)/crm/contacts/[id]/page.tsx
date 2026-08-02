'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Mail, Phone, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { formatDate } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { PageShell, PageHeader, Button, FormFooter, ConfirmDialog, StatusBadge } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    ContactFormFields,
    contactFormToPayload,
    contactToFormState,
    emptyContactForm,
    validateContactForm,
    type ContactFormErrors,
} from '../contact-form-fields';

interface ContactAttachment {
    id: string;
    file_url: string;
    file_name: string;
    mime_type: string | null;
    file_size: number | null;
    created_at: string;
}

interface ContactRecord {
    id: string;
    name: string;
    company: string | null;
    mobile: string | null;
    phone: string | null;
    email: string | null;
    capture_source: string;
    created_at: string;
    creator: { id: string; name: string } | null;
    attachments?: ContactAttachment[];
}

export default function ContactDetailPage() {
    const { t } = useI18n();
    const m = t.crm.contacts;
    const c = t.common;
    const router = useRouter();
    const params = useParams<{ id: string }>();
    const id = params?.id as string;

    const [contact, setContact] = useState<ContactRecord | null>(null);
    const [form, setForm] = useState(emptyContactForm());
    const [errors, setErrors] = useState<ContactFormErrors>({});
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [cardToRemove, setCardToRemove] = useState<ContactAttachment | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await api.getContact(id);
            setContact(data);
            setForm(contactToFormState(data));
        } catch {
            setContact(null);
        } finally {
            setLoading(false);
        }
    }, [id]);

    useEffect(() => { void load(); }, [load]);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    const save = async () => {
        const validationErrors = validateContactForm(form, m.validation);
        setErrors(validationErrors);
        if (Object.keys(validationErrors).length > 0) return;
        setSaveError(null);
        setSaving(true);
        try {
            const updated = await api.updateContact(id, contactFormToPayload(form));
            setContact(updated);
            setForm(contactToFormState(updated));
            toast.success(m.saved);
        } catch (err: unknown) {
            setSaveError(err instanceof Error ? err.message : m.updateFailed);
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        try {
            await api.deleteContact(id);
            router.push(routes.crm.contacts);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.deleteFailed);
            setDeleteOpen(false);
        }
    };

    const removeCard = async (attachment: ContactAttachment) => {
        setCardToRemove(null);
        try {
            await api.deleteContactAttachment(id, attachment.id);
            // Reloaded rather than spliced out locally: the card is the evidence
            // behind a BUSINESS_CARD contact, so what the server holds is what
            // should be on screen.
            await load();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.scan.cardRemoveFailed);
        }
    };

    if (loading) {
        return (
            <PageShell maxWidth="narrow">
                <p className="text-sm text-gray-400">{m.loading}</p>
            </PageShell>
        );
    }

    if (!contact) {
        return (
            <PageShell maxWidth="narrow">
                <p className="text-sm text-gray-500">{m.notFound}</p>
                <Link href={routes.crm.contacts} className="text-sm text-primary hover:underline">
                    {m.back}
                </Link>
            </PageShell>
        );
    }

    const captureSourceLabel =
        (m.captureSources as Record<string, string>)[contact.capture_source] ?? contact.capture_source;
    const cards = contact.attachments ?? [];

    return (
        <PageShell maxWidth="narrow">
            <PageHeader
                title={contact.name}
                subtitle={[contact.company, contact.email].filter(Boolean).join(' · ')}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    'crm',
                    [{ label: m.title, href: routes.crm.contacts }],
                    contact.name,
                )}
                actions={
                    <>
                        <Link href={routes.crm.contacts} className="px-3 py-2 text-sm border rounded-md hover:bg-gray-50 inline-flex items-center gap-1.5">
                            <ArrowLeft className="w-4 h-4" /> {m.back}
                        </Link>
                        <Button
                            variant="danger"
                            onClick={() => setDeleteOpen(true)}
                            leftIcon={<Trash2 className="w-4 h-4" />}
                        >
                            {c.delete}
                        </Button>
                    </>
                }
            />

            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <StatusBadge tone={contact.capture_source === 'BUSINESS_CARD' ? 'info' : 'neutral'}>
                    {captureSourceLabel}
                </StatusBadge>
                <span>{m.fields.addedOn}: {formatDate(contact.created_at)}</span>
                {contact.mobile && (
                    <a href={`tel:${contact.mobile}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline min-h-touch">
                        <Phone className="w-3.5 h-3.5" /> {contact.mobile}
                    </a>
                )}
                {contact.email && (
                    <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-1 text-blue-600 hover:underline min-h-touch">
                        <Mail className="w-3.5 h-3.5" /> {contact.email}
                    </a>
                )}
            </div>

            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                <ContactFormFields
                    form={form}
                    onChange={setForm}
                    teamMembers={teamMembers}
                    errors={errors}
                />

                {saveError && <p role="alert" className="text-xs text-danger mt-3">{saveError}</p>}

                <FormFooter className="pt-6 mt-6">
                    <Button onClick={save} loading={saving}>
                        {c.saveChanges}
                    </Button>
                </FormFooter>
            </div>

            {cards.length > 0 && (
                <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4 space-y-3">
                    <h2 className="text-sm font-semibold text-gray-700">{m.scan.cardSection}</h2>
                    <p className="text-xs text-gray-500">{m.scan.cardSectionHint}</p>
                    <ul className="grid gap-3 sm:grid-cols-2">
                        {cards.map((card) => (
                            <li key={card.id} className="space-y-2">
                                {/* Opens full size: a card is read, not glanced at, and the
                                    thumbnail is deliberately too small for the fine print. */}
                                <a href={card.file_url} target="_blank" rel="noopener noreferrer">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={card.file_url}
                                        alt={m.scan.cardSection}
                                        className="w-full max-h-56 object-contain rounded-lg border border-gray-200 bg-gray-50"
                                    />
                                </a>
                                <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
                                    <span>{formatDate(card.created_at)}</span>
                                    <button
                                        type="button"
                                        onClick={() => setCardToRemove(card)}
                                        className="inline-flex items-center gap-1 text-danger hover:underline min-h-touch"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" /> {c.delete}
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <ConfirmDialog
                open={deleteOpen}
                title={c.delete}
                prompt={m.deleteConfirm}
                confirmLabel={c.delete}
                cancelLabel={c.cancel}
                danger
                onConfirm={() => void remove()}
                onCancel={() => setDeleteOpen(false)}
            />

            <ConfirmDialog
                open={!!cardToRemove}
                title={m.scan.cardRemoveTitle}
                prompt={m.scan.cardRemoveConfirm}
                confirmLabel={c.delete}
                cancelLabel={c.cancel}
                danger
                onConfirm={() => { if (cardToRemove) void removeCard(cardToRemove); }}
                onCancel={() => setCardToRemove(null)}
            />
        </PageShell>
    );
}
