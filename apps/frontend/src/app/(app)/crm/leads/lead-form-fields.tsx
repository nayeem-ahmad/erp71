'use client';

import { useI18n } from '@/lib/i18n';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED'] as const;
export const LEAD_SOURCES = ['WALK_IN', 'PHONE', 'FACEBOOK', 'REFERRAL', 'WEBSITE', 'OTHER'] as const;
export const LEAD_CATEGORIES = ['RETAIL', 'WHOLESALE', 'CORPORATE', 'INDIVIDUAL', 'PARTNER', 'OTHER'] as const;
export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export type LeadFormState = {
    name: string;
    mobile: string;
    email: string;
    category: string;
    priority: string;
    remarks: string;
    status: string;
    source: string;
    linkedin_url: string;
    fb_url: string;
    x_url: string;
    website_url: string;
    next_step: string;
    next_step_date: string;
    next_step_assigned_to: string;
};

export const emptyLeadForm = (): LeadFormState => ({
    name: '',
    mobile: '',
    email: '',
    category: 'OTHER',
    priority: 'MEDIUM',
    remarks: '',
    status: 'NEW',
    source: 'OTHER',
    linkedin_url: '',
    fb_url: '',
    x_url: '',
    website_url: '',
    next_step: '',
    next_step_date: '',
    next_step_assigned_to: '',
});

export function leadToFormState(lead: Record<string, unknown>): LeadFormState {
    const nextStepDate = lead.next_step_date as string | null | undefined;
    return {
        name: String(lead.name ?? ''),
        mobile: String(lead.mobile ?? lead.phone ?? ''),
        email: String(lead.email ?? ''),
        category: String(lead.category ?? 'OTHER'),
        priority: String(lead.priority ?? 'MEDIUM'),
        remarks: String(lead.remarks ?? lead.notes ?? ''),
        status: String(lead.status ?? 'NEW'),
        source: String(lead.source ?? 'OTHER'),
        linkedin_url: String(lead.linkedin_url ?? ''),
        fb_url: String(lead.fb_url ?? ''),
        x_url: String(lead.x_url ?? ''),
        website_url: String(lead.website_url ?? ''),
        next_step: String(lead.next_step ?? ''),
        next_step_date: nextStepDate ? nextStepDate.slice(0, 16) : '',
        next_step_assigned_to: String((lead.next_step_assigned_to as string) ?? ''),
    };
}

export function leadFormToPayload(form: LeadFormState) {
    return {
        name: form.name.trim(),
        mobile: form.mobile.trim(),
        email: form.email.trim() || undefined,
        category: form.category || undefined,
        priority: form.priority || undefined,
        remarks: form.remarks.trim() || undefined,
        status: form.status || undefined,
        source: form.source || undefined,
        linkedin_url: form.linkedin_url.trim() || undefined,
        fb_url: form.fb_url.trim() || undefined,
        x_url: form.x_url.trim() || undefined,
        website_url: form.website_url.trim() || undefined,
        next_step: form.next_step.trim() || undefined,
        next_step_date: form.next_step_date || undefined,
        next_step_assigned_to: form.next_step_assigned_to || undefined,
    };
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const labelClass = 'text-xs font-semibold text-gray-600';

type TeamMember = { user_id: string; user: { id: string; name: string; email: string } };

type LeadFormFieldsProps = {
    form: LeadFormState;
    onChange: (form: LeadFormState) => void;
    teamMembers?: TeamMember[];
    showStatus?: boolean;
};

export function LeadFormFields({ form, onChange, teamMembers = [], showStatus = true }: LeadFormFieldsProps) {
    const { t } = useI18n();
    const m = t.crm.leads;
    const set = (key: keyof LeadFormState, value: string) => onChange({ ...form, [key]: value });

    const statusLabel = (v: string) => (m.statuses as Record<string, string>)[v] ?? v;
    const sourceLabel = (v: string) => (m.sources as Record<string, string>)[v] ?? v;
    const categoryLabel = (v: string) => (m.categories as Record<string, string>)[v] ?? v;
    const priorityLabel = (v: string) => (m.priorities as Record<string, string>)[v] ?? v;

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
                <label className={labelClass}>{m.columns.name}</label>
                <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} />
            </div>
            <div>
                <label className={labelClass}>{m.fields.mobile}</label>
                <input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} className={inputClass} />
            </div>
            <div>
                <label className={labelClass}>{m.fields.email}</label>
                <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />
            </div>
            <div>
                <label className={labelClass}>{m.fields.category}</label>
                <select value={form.category} onChange={(e) => set('category', e.target.value)} className={inputClass}>
                    {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </select>
            </div>
            <div>
                <label className={labelClass}>{m.fields.priority}</label>
                <select value={form.priority} onChange={(e) => set('priority', e.target.value)} className={inputClass}>
                    {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                </select>
            </div>
            {showStatus && (
                <div>
                    <label className={labelClass}>{m.columns.status}</label>
                    <select value={form.status} onChange={(e) => set('status', e.target.value)} className={inputClass}>
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </select>
                </div>
            )}
            <div>
                <label className={labelClass}>{m.columns.source}</label>
                <select value={form.source} onChange={(e) => set('source', e.target.value)} className={inputClass}>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                </select>
            </div>
            <div className="sm:col-span-2">
                <label className={labelClass}>{m.fields.remarks}</label>
                <textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} className={inputClass} rows={3} />
            </div>
            <div>
                <label className={labelClass}>{m.fields.linkedinUrl}</label>
                <input value={form.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} className={inputClass} placeholder="https://linkedin.com/in/..." />
            </div>
            <div>
                <label className={labelClass}>{m.fields.fbUrl}</label>
                <input value={form.fb_url} onChange={(e) => set('fb_url', e.target.value)} className={inputClass} placeholder="https://facebook.com/..." />
            </div>
            <div>
                <label className={labelClass}>{m.fields.xUrl}</label>
                <input value={form.x_url} onChange={(e) => set('x_url', e.target.value)} className={inputClass} placeholder="https://x.com/..." />
            </div>
            <div>
                <label className={labelClass}>{m.fields.websiteUrl}</label>
                <input value={form.website_url} onChange={(e) => set('website_url', e.target.value)} className={inputClass} placeholder="https://..." />
            </div>
            <div className="sm:col-span-2 border-t border-gray-100 pt-3 mt-1">
                <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-2">{m.fields.nextStepSection}</p>
            </div>
            <div className="sm:col-span-2">
                <label className={labelClass}>{m.fields.nextStep}</label>
                <input value={form.next_step} onChange={(e) => set('next_step', e.target.value)} className={inputClass} />
            </div>
            <div>
                <label className={labelClass}>{m.fields.nextStepDate}</label>
                <input type="datetime-local" value={form.next_step_date} onChange={(e) => set('next_step_date', e.target.value)} className={inputClass} />
            </div>
            <div>
                <label className={labelClass}>{m.fields.nextStepAssignedTo}</label>
                <select value={form.next_step_assigned_to} onChange={(e) => set('next_step_assigned_to', e.target.value)} className={inputClass}>
                    <option value="">{m.fields.unassigned}</option>
                    {teamMembers.map((member) => (
                        <option key={member.user_id} value={member.user.id}>
                            {member.user.name || member.user.email}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}