'use client';

import { useI18n } from '@/lib/i18n';
import { Field, Input, Select, Textarea } from '@/components/ui';

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'QUALIFIED', 'LOST', 'CONVERTED'] as const;
export const LEAD_SOURCES = ['WALK_IN', 'PHONE', 'FACEBOOK', 'REFERRAL', 'WEBSITE', 'OTHER'] as const;
export const LEAD_CATEGORIES = ['RETAIL', 'WHOLESALE', 'CORPORATE', 'INDIVIDUAL', 'PARTNER', 'OTHER'] as const;
export const LEAD_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const LEAD_CONVERSATION_TYPES = ['CALL', 'SMS', 'WHATSAPP', 'EMAIL', 'VISIT', 'ONLINE_MEETING', 'NOTE'] as const;

export type NextStepState = {
    next_step: string;
    next_step_date: string;
    next_step_assigned_to: string;
};

export const emptyNextStep = (): NextStepState => ({
    next_step: '',
    next_step_date: '',
    next_step_assigned_to: '',
});

export function nextStepFromLead(lead: Record<string, unknown>): NextStepState {
    const nextStepDate = lead.next_step_date as string | null | undefined;
    return {
        next_step: String(lead.next_step ?? ''),
        next_step_date: nextStepDate ? nextStepDate.slice(0, 16) : '',
        next_step_assigned_to: String(lead.next_step_assigned_to ?? ''),
    };
}

export function nextStepToPayload(state: NextStepState): Record<string, string> {
    const payload: Record<string, string> = {};
    const step = state.next_step.trim();
    if (step) payload.next_step = step;
    if (state.next_step_date) {
        payload.next_step_date = new Date(state.next_step_date).toISOString();
    }
    if (state.next_step_assigned_to) payload.next_step_assigned_to = state.next_step_assigned_to;
    return payload;
}

export type LeadFormState = {
    name: string;
    mobile: string;
    email: string;
    category: string;
    priority: string;
    remarks: string;
    status: string;
    lost_reason: string;
    source: string;
    linkedin_url: string;
    fb_url: string;
    x_url: string;
    website_url: string;
    next_step: string;
    next_step_date: string;
    next_step_assigned_to: string;
    custom_fields: Record<string, string>;
};

export const emptyLeadForm = (): LeadFormState => ({
    name: '',
    mobile: '',
    email: '',
    category: 'OTHER',
    priority: 'MEDIUM',
    remarks: '',
    status: 'NEW',
    lost_reason: '',
    source: 'OTHER',
    linkedin_url: '',
    fb_url: '',
    x_url: '',
    website_url: '',
    next_step: '',
    next_step_date: '',
    next_step_assigned_to: '',
    custom_fields: {},
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
        lost_reason: String(lead.lost_reason ?? ''),
        source: String(lead.source ?? 'OTHER'),
        linkedin_url: String(lead.linkedin_url ?? ''),
        fb_url: String(lead.fb_url ?? ''),
        x_url: String(lead.x_url ?? ''),
        website_url: String(lead.website_url ?? ''),
        next_step: String(lead.next_step ?? ''),
        next_step_date: nextStepDate ? nextStepDate.slice(0, 16) : '',
        next_step_assigned_to: String((lead.next_step_assigned_to as string) ?? ''),
        custom_fields: (lead.custom_fields as Record<string, string>) ?? {},
    };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateLeadForm(form: LeadFormState): string | null {
    if (!form.name.trim()) return 'NAME_REQUIRED';
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) return 'INVALID_EMAIL';
    if (form.status === 'LOST' && !form.lost_reason.trim()) return 'LOST_REASON_REQUIRED';
    return null;
}

/**
 * Same validation rules as `validateLeadForm`, but returns a per-field error map
 * (using the provided i18n messages) for inline `Field` errors instead of a single code.
 */
export function validateLeadFormErrors(
    form: LeadFormState,
    messages: { nameRequired?: string; invalidEmail?: string; lostReasonRequired?: string },
): LeadFormErrors {
    const errors: LeadFormErrors = {};
    if (!form.name.trim()) errors.name = messages.nameRequired ?? 'Name is required.';
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) {
        errors.email = messages.invalidEmail ?? 'Please enter a valid email address.';
    }
    if (form.status === 'LOST' && !form.lost_reason.trim()) {
        errors.lost_reason = messages.lostReasonRequired ?? 'Please provide a reason for marking this lead as lost.';
    }
    return errors;
}

export function leadFormToPayload(form: LeadFormState) {
    const payload: Record<string, string> = {
        name: form.name.trim(),
    };
    const mobile = form.mobile.trim();
    if (mobile) payload.mobile = mobile;
    const email = form.email.trim();
    if (email) payload.email = email;
    if (form.category) payload.category = form.category;
    if (form.priority) payload.priority = form.priority;
    const remarks = form.remarks.trim();
    if (remarks) payload.remarks = remarks;
    if (form.status) payload.status = form.status;
    if (form.status === 'LOST') payload.lost_reason = form.lost_reason.trim();
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
    const customFields = Object.entries(form.custom_fields ?? {}).reduce<Record<string, string>>((acc, [k, v]) => {
        const val = String(v ?? '').trim();
        if (val) acc[k] = val;
        return acc;
    }, {});
    if (Object.keys(customFields).length) {
        (payload as Record<string, unknown>).custom_fields = customFields;
    }
    return payload;
}

export type LeadFormErrors = Partial<Record<keyof LeadFormState, string>>;

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
    customFieldDefs?: { key: string; label: string }[];
    errors?: LeadFormErrors;
};

export function LeadFormFields({ form, onChange, teamMembers = [], showStatus = true, customFieldDefs = [], errors = {} }: LeadFormFieldsProps) {
    const { t } = useI18n();
    const m = t.crm.leads;
    const set = (key: keyof LeadFormState, value: string) => onChange({ ...form, [key]: value });

    const statusLabel = (v: string) => (m.statuses as Record<string, string>)[v] ?? v;
    const sourceLabel = (v: string) => (m.sources as Record<string, string>)[v] ?? v;
    const categoryLabel = (v: string) => (m.categories as Record<string, string>)[v] ?? v;
    const priorityLabel = (v: string) => (m.priorities as Record<string, string>)[v] ?? v;

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <Field label={m.columns.name} required error={errors.name} className="sm:col-span-2">
                <Input value={form.name} onChange={(e) => set('name', e.target.value)} error={Boolean(errors.name)} />
            </Field>
            <Field label={m.fields.mobile} error={errors.mobile}>
                <Input value={form.mobile} onChange={(e) => set('mobile', e.target.value)} error={Boolean(errors.mobile)} />
            </Field>
            <Field label={m.fields.email} error={errors.email}>
                <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} error={Boolean(errors.email)} />
            </Field>
            <Field label={m.fields.category}>
                <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
                    {LEAD_CATEGORIES.map((c) => <option key={c} value={c}>{categoryLabel(c)}</option>)}
                </Select>
            </Field>
            <Field label={m.fields.priority}>
                <Select value={form.priority} onChange={(e) => set('priority', e.target.value)}>
                    {LEAD_PRIORITIES.map((p) => <option key={p} value={p}>{priorityLabel(p)}</option>)}
                </Select>
            </Field>
            {showStatus && (
                <Field label={m.columns.status}>
                    <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
                        {LEAD_STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
                    </Select>
                </Field>
            )}
            {showStatus && form.status === 'LOST' && (
                <Field label={m.fields.lostReason} error={errors.lost_reason} className="sm:col-span-2">
                    <Textarea
                        value={form.lost_reason}
                        onChange={(e) => set('lost_reason', e.target.value)}
                        rows={2}
                        placeholder={m.fields.lostReasonPlaceholder}
                        error={Boolean(errors.lost_reason)}
                    />
                </Field>
            )}
            <Field label={m.columns.source}>
                <Select value={form.source} onChange={(e) => set('source', e.target.value)}>
                    {LEAD_SOURCES.map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
                </Select>
            </Field>
            <Field label={m.fields.remarks} className="sm:col-span-2">
                <Textarea value={form.remarks} onChange={(e) => set('remarks', e.target.value)} rows={3} />
            </Field>
            <Field label={m.fields.linkedinUrl}>
                <Input value={form.linkedin_url} onChange={(e) => set('linkedin_url', e.target.value)} placeholder="https://linkedin.com/in/..." />
            </Field>
            <Field label={m.fields.fbUrl}>
                <Input value={form.fb_url} onChange={(e) => set('fb_url', e.target.value)} placeholder="https://facebook.com/..." />
            </Field>
            <Field label={m.fields.xUrl}>
                <Input value={form.x_url} onChange={(e) => set('x_url', e.target.value)} placeholder="https://x.com/..." />
            </Field>
            <Field label={m.fields.websiteUrl}>
                <Input value={form.website_url} onChange={(e) => set('website_url', e.target.value)} placeholder="https://..." />
            </Field>
            <NextStepFields
                state={{ next_step: form.next_step, next_step_date: form.next_step_date, next_step_assigned_to: form.next_step_assigned_to }}
                onChange={(next) => onChange({ ...form, ...next })}
                teamMembers={teamMembers}
            />
            {customFieldDefs.map((def) => (
                <Field label={def.label} key={def.key}>
                    <Input
                        value={form.custom_fields?.[def.key] ?? ''}
                        onChange={(e) => onChange({ ...form, custom_fields: { ...form.custom_fields, [def.key]: e.target.value } })}
                        maxLength={500}
                    />
                </Field>
            ))}
        </div>
    );
}

type NextStepFieldsProps = {
    state: NextStepState;
    onChange: (state: NextStepState) => void;
    teamMembers?: TeamMember[];
    showSectionHeader?: boolean;
};

export function NextStepFields({ state, onChange, teamMembers = [], showSectionHeader = true }: NextStepFieldsProps) {
    const { t } = useI18n();
    const m = t.crm.leads;
    const set = (key: keyof NextStepState, value: string) => onChange({ ...state, [key]: value });

    return (
        <>
            {showSectionHeader && (
                <div className="sm:col-span-2 border-t border-gray-100 pt-3 mt-1">
                    <p className="text-xs font-semibold uppercase text-gray-400 mb-2">{m.fields.nextStepSection}</p>
                </div>
            )}
            <Field label={m.fields.nextStep} className="sm:col-span-2">
                <Input value={state.next_step} onChange={(e) => set('next_step', e.target.value)} />
            </Field>
            <Field label={m.fields.nextStepDate}>
                <Input type="datetime-local" value={state.next_step_date} onChange={(e) => set('next_step_date', e.target.value)} />
            </Field>
            <Field label={m.fields.nextStepAssignedTo}>
                <Select value={state.next_step_assigned_to} onChange={(e) => set('next_step_assigned_to', e.target.value)}>
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
                </Select>
            </Field>
        </>
    );
}