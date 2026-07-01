'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, UserPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import {
    LeadFormFields,
    emptyLeadForm,
    leadFormToPayload,
    validateLeadForm,
} from '../lead-form-fields';

export default function NewLeadPage() {
    const { t } = useI18n();
    const m = t.crm.leads;
    const c = t.common;
    const router = useRouter();

    const [form, setForm] = useState(emptyLeadForm());
    const [saving, setSaving] = useState(false);
    const [teamMembers, setTeamMembers] = useState<any[]>([]);

    useEffect(() => {
        api.getTeamMembers().then((data) => setTeamMembers(Array.isArray(data) ? data : [])).catch(() => null);
    }, []);

    const formErrorMessage = (code: string | null) => {
        if (!code) return null;
        if (code === 'INVALID_EMAIL') return m.validation?.invalidEmail ?? 'Please enter a valid email address.';
        if (code === 'NAME_REQUIRED') return `${m.columns.name} is required.`;
        if (code === 'MOBILE_REQUIRED') return `${m.fields.mobile} is required.`;
        return m.createFailed;
    };

    const createLead = async () => {
        const validationError = validateLeadForm(form);
        if (validationError) {
            alert(formErrorMessage(validationError));
            return;
        }
        setSaving(true);
        try {
            const created = await api.createLead(leadFormToPayload(form));
            if (created?.id) {
                router.push(routes.crm.leadDetail(created.id));
            } else {
                router.push(routes.crm.leads);
            }
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : m.createFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="overflow-y-auto h-full p-8 bg-[#f9fafb] space-y-6">
            <Link href={routes.crm.leads} className="flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors w-fit">
                <ArrowLeft className="w-4 h-4 mr-2" /> {m.workspace.back}
            </Link>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 max-w-3xl">
                <div className="flex items-center gap-3 mb-6">
                    <div className="w-12 h-12 bg-violet-600 rounded-xl flex items-center justify-center text-white">
                        <UserPlus className="w-6 h-6" />
                    </div>
                    <h1 className="text-lg font-bold tracking-tight text-gray-950 text-gray-900">{m.newLead}</h1>
                </div>

                <LeadFormFields form={form} onChange={setForm} teamMembers={teamMembers} showStatus={false} />

                <div className="flex justify-end gap-2 pt-6 mt-6 border-t border-gray-100">
                    <Link href={routes.crm.leads} className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50">
                        {c.cancel}
                    </Link>
                    <button onClick={createLead} disabled={saving} className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg font-semibold disabled:opacity-50 hover:bg-violet-700">
                        {saving ? '...' : m.newLead}
                    </button>
                </div>
            </div>
        </div>
    );
}