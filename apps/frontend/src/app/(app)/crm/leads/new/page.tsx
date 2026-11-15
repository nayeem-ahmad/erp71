'use client';

import { Suspense, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { fetchMe } from '@/hooks/use-me';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { PageShell, PageHeader, Button, FormFooter } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    LeadFormFields,
    emptyLeadForm,
    leadFormToPayload,
    prefillLeadFromContact,
    setLeadOwner,
    validateLeadFormErrors,
    type LeadFormErrors,
} from '@/components/crm/lead-form-fields';
import { defaultTaxonomyId, useLeadTaxonomy } from '@/lib/use-lead-taxonomy';

export default function NewLeadPage() {
    // useSearchParams needs a Suspense boundary to keep the route statically
    // renderable.
    return (
        <Suspense fallback={null}>
            <NewLeadForm />
        </Suspense>
    );
}

function NewLeadForm() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const c = t.common;
    const convert = t.crm.contacts.convert;
    const router = useRouter();
    // Set by "Convert to lead" on a contact: the form starts from that contact
    // and the lead is filed against it.
    const contactId = useSearchParams()?.get('contactId') ?? '';

    const [form, setForm] = useState(emptyLeadForm());
    const [errors, setErrors] = useState<LeadFormErrors>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);
    const [fromContact, setFromContact] = useState<{ id: string; name: string } | null>(null);
    const [contactLoadFailed, setContactLoadFailed] = useState(false);
    const { options: sourceOptions } = useLeadTaxonomy('sources');
    const { options: categoryOptions } = useLeadTaxonomy('categories');
    const { options: statusOptions } = useLeadTaxonomy('statuses');

    // Preselect the tenant's fallback source once the list arrives. Only while
    // the field is still untouched, so it never overwrites a real choice.
    useEffect(() => {
        setForm((prev) => (prev.source ? prev : { ...prev, source: defaultTaxonomyId(sourceOptions) }));
    }, [sourceOptions]);

    useEffect(() => {
        api.getCrmAssignees().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    // A lead belongs to whoever files it unless they say otherwise — the same
    // default the backend applies, surfaced so the picker is never blank. It also
    // seeds the opening activity's assignee, which is what stops that second
    // picker from reading as a duplicate of the owner one. Only while both are
    // still untouched, so it never overwrites a real choice.
    useEffect(() => {
        fetchMe()
            .then((me: any) => {
                if (!me?.id) return;
                setForm((prev) => (prev.assigned_to ? prev : setLeadOwner(prev, me.id)));
            })
            .catch(() => null);
    }, []);

    useEffect(() => {
        if (!contactId) return;
        let cancelled = false;
        api.getContact(contactId)
            .then((contact: any) => {
                if (cancelled || !contact?.id) return;
                setFromContact({ id: contact.id, name: String(contact.name ?? '') });
                setForm((prev) => prefillLeadFromContact(prev, contact));
            })
            .catch(() => {
                if (!cancelled) setContactLoadFailed(true);
            });
        return () => { cancelled = true; };
    }, [contactId]);

    useEffect(() => {
        api.getCustomFields('LEAD')
            .then((d: any[]) => setCustomFieldDefs(Array.isArray(d) ? d : []))
            .catch(() => setCustomFieldDefs([]));
    }, []);

    const createLead = async () => {
        const validationErrors = validateLeadFormErrors(form, m.validation ?? {});
        setErrors(validationErrors);
        if (Object.keys(validationErrors).length > 0) return;
        setSaveError(null);
        setSaving(true);
        try {
            const payload = leadFormToPayload(form);
            const created = await api.createLead(fromContact ? { ...payload, contact_id: fromContact.id } : payload);
            if (created?.id) {
                router.push(routes.crm.leadDetail(created.id));
            } else {
                router.push(routes.crm.leads);
            }
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
                            <UserPlus className="w-6 h-6" />
                        </span>
                        {m.newLead}
                    </span>
                )}
                breadcrumbs={nestedPageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.crm,
                    'crm',
                    [{ label: m.title, href: routes.crm.leads }],
                    m.newLead,
                )}
            />

            {fromContact && (
                <p className="text-xs text-gray-500">
                    {convert.linkedTo.split('{name}')[0]}
                    <Link href={routes.crm.contactDetail(fromContact.id)} className="text-blue-600 hover:underline">
                        {fromContact.name}
                    </Link>
                    {convert.linkedTo.split('{name}')[1] ?? ''}
                </p>
            )}
            {contactLoadFailed && (
                <p role="alert" className="text-xs text-amber-700">{convert.loadFailed}</p>
            )}

            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                <LeadFormFields
                    form={form}
                    onChange={setForm}
                    teamMembers={teamMembers}
                    customFieldDefs={customFieldDefs}
                    errors={errors}
                    sourceOptions={sourceOptions}
                    categoryOptions={categoryOptions}
                    statusOptions={statusOptions}
                />

                {saveError && <p role="alert" className="text-xs text-danger mt-3">{saveError}</p>}

                <FormFooter className="pt-6 mt-6">
                    <Link
                        href={fromContact ? routes.crm.contactDetail(fromContact.id) : routes.crm.leads}
                        className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50"
                    >
                        {c.cancel}
                    </Link>
                    <Button onClick={createLead} loading={saving}>
                        {m.newLead}
                    </Button>
                </FormFooter>
            </div>
        </PageShell>
    );
}