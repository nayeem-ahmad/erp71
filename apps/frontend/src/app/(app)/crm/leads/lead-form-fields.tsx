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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadForm(form: LeadFormState): string | null {
    if (!form.name.trim()) return 'NAME_REQUIRED';
    if (!form.mobile.trim()) return 'MOBILE_REQUIRED';
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) return 'INVALID_EMAIL';
    return null;
}

export function leadFormToPayload(form: LeadFormState) {
    const payload: Record<string, string> = {
        name: form.name.trim(),
        mobile: form.mobile.trim(),
    };
    const email = form.email.trim();
    if (email) payload.email = email;
    if (form.category) payload.category = form.category;
    if (form.priority) payload.priority = form.priority;
    const remarks = form.remarks.trim();
    if (remarks) payload.remarks = remarks;
    if (form.status) payload.status = form.status;
    if (form.source) payload.source = form.source;
    const linkedin = form.linkedin_url.trim();
    if (linkedin) payload.linkedin_url = linkedin;
    const fb = form.fb_url.trim();
    if (fb) payload.fb_url = fb;
    const x = form.x_url.trim();
    if (x) payload.x_url = x;
    const website = form.website_url.trim();
    if (website) payload.website_url = website;
    const nextStep = form.next_step.trim();
    if (nextStep) payload.next_step = nextStep;
    if (form.next_step_date) {
        payload.next_step_date = new Date(form.next_step_date).toISOString();
    }
    if (form.next_step_assigned_to) payload.next_step_assigned_to = form.next_step_assigned_to;
    return payload;
}

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm';
const labelClass = 'text-xs font-semibold text-gray-600';

type TeamMember = {
    userId?: string;
    user_id?: string;
    email?: string;
    name?: string | null;
    user?: { id: string; name: string; email: string };
};

function teamMemberId(member: TeamMember): string | undefined {
    return member.userId ?? member.user_id ?? member.user?.id;
}

function teamMemberLabel(member: TeamMember): string {
    return member.name ?? member.user?.name ?? member.email ?? member.user?.email ?? '';
}

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
                    {teamMembers.map((member) => {
                        const id = teamMemberId(member);
                        if (!id) return null;
                        return (
                            <option key={id} value={id}>
                                {teamMemberLabel(member)}
                            </option>
                        );
                    })}
                </select>
            </div>
        </div>
    );
}