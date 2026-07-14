'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { PageShell, PageHeader, Button, FormFooter } from '@/components/ui';
import { nestedPageBreadcrumbs } from '@/lib/page-breadcrumbs';
import {
    LeadFormFields,
    emptyLeadForm,
    leadFormToPayload,
    validateLeadFormErrors,
    type LeadFormErrors,
} from '../lead-form-fields';

export default function NewLeadPage() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const c = t.common;
    const router = useRouter();

    const [form, setForm] = useState(emptyLeadForm());
    const [errors, setErrors] = useState<LeadFormErrors>({});
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);
    const [customFieldDefs, setCustomFieldDefs] = useState<{ key: string; label: string }[]>([]);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

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
            const created = await api.createLead(leadFormToPayload(form));
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

            <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-4">
                <LeadFormFields form={form} onChange={setForm} teamMembers={teamMembers} showStatus={false} customFieldDefs={customFieldDefs} errors={errors} />

                {saveError && <p role="alert" className="text-xs text-danger mt-3">{saveError}</p>}

                <FormFooter className="pt-6 mt-6">
                    <Link href={routes.crm.leads} className="px-4 py-2 text-sm border rounded-md hover:bg-gray-50">
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