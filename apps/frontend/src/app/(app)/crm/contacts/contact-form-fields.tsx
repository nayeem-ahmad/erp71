'use client';

import { useI18n } from '@/lib/i18n';
import { Field, Input, Select, Textarea } from '@/components/ui';

export const CONTACT_CAPTURE_SOURCES = ['MANUAL', 'BUSINESS_CARD', 'IMPORT'] as const;

/**
 * Hand-off slot for a scan started somewhere with no form to fill — the list
 * page. The create form drains it on mount, so a scan always lands in front of
 * a human before it becomes a contact.
 */
export const SCANNED_CARD_STORAGE_KEY = 'erp71.crm.scannedCard';

export type ContactCaptureSource = (typeof CONTACT_CAPTURE_SOURCES)[number];

export type ContactFormState = {
    name: string;
    company: string;
    designation: string;
    mobile: string;
    phone: string;
    email: string;
    address: string;
    website_url: string;
    linkedin_url: string;
    notes: string;
    assigned_to: string;
};

export const emptyContactForm = (): ContactFormState => ({
    name: '',
    company: '',
    designation: '',
    mobile: '',
    phone: '',
    email: '',
    address: '',
    website_url: '',
    linkedin_url: '',
    notes: '',
    assigned_to: '',
});

export function contactToFormState(contact: Record<string, unknown>): ContactFormState {
    return {
        name: String(contact.name ?? ''),
        company: String(contact.company ?? ''),
        designation: String(contact.designation ?? ''),
        mobile: String(contact.mobile ?? ''),
        phone: String(contact.phone ?? ''),
        email: String(contact.email ?? ''),
        address: String(contact.address ?? ''),
        website_url: String(contact.website_url ?? ''),
        linkedin_url: String(contact.linkedin_url ?? ''),
        notes: String(contact.notes ?? ''),
        assigned_to: String(contact.assigned_to ?? ''),
    };
}

/**
 * Merge scanned card fields over a form the user may already have started.
 *
 * A scan never clears anything: the extractor omits what it could not read, and
 * a field the user typed by hand is better evidence than a blank from the model.
 * The card wins only where it actually has a value and the form does not.
 */
export function applyScannedCard(
    form: ContactFormState,
    scanned: Partial<Record<keyof ContactFormState, string>> & { raw_text?: string },
): ContactFormState {
    const merged = { ...form };
    for (const key of Object.keys(emptyContactForm()) as (keyof ContactFormState)[]) {
        const value = scanned[key];
        if (typeof value === 'string' && value.trim() && !merged[key].trim()) {
            merged[key] = value.trim();
        }
    }
    return merged;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactFormErrors = Partial<Record<keyof ContactFormState, string>>;

export function validateContactForm(
    form: ContactFormState,
    messages: { nameRequired?: string; invalidEmail?: string },
): ContactFormErrors {
    const errors: ContactFormErrors = {};
    if (!form.name.trim()) errors.name = messages.nameRequired ?? 'Name is required.';
    const email = form.email.trim();
    if (email && !EMAIL_RE.test(email)) {
        errors.email = messages.invalidEmail ?? 'Please enter a valid email address.';
    }
    return errors;
}

/**
 * Every field is sent, blanks included — a PATCH that omits a cleared field
 * would read as "leave it alone" and make it impossible to erase, say, a
 * designation the scanner got wrong. `name` is the exception the backend
 * rejects when empty, and the form validates it first.
 */
export function contactFormToPayload(form: ContactFormState): Record<string, string> {
    return {
        name: form.name.trim(),
        company: form.company.trim(),
        designation: form.designation.trim(),
        mobile: form.mobile.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        address: form.address.trim(),
        website_url: form.website_url.trim(),
        linkedin_url: form.linkedin_url.trim(),
        notes: form.notes.trim(),
        assigned_to: form.assigned_to,
    };
}

export type TeamMember = {
    userId?: string;
    user_id?: string;
    email?: string;
    name?: string | null;
    user?: { id: string; name: string; email: string };
};

export function teamMemberId(member: TeamMember): string | undefined {
    return member.userId ?? member.user_id ?? member.user?.id;
}

export function teamMemberLabel(member: TeamMember): string {
    return member.name ?? member.user?.name ?? member.email ?? member.user?.email ?? '';
}

type ContactFormFieldsProps = {
    form: ContactFormState;
    onChange: (form: ContactFormState) => void;
    teamMembers?: TeamMember[];
    errors?: ContactFormErrors;
};

export function ContactFormFields({
    form,
    onChange,
    teamMembers = [],
    errors = {},
}: Readonly<ContactFormFieldsProps>) {
    const { t } = useI18n();
    const m = t.crm.contacts;
    const set = (key: keyof ContactFormState, value: string) => onChange({ ...form, [key]: value });

    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <Field label={m.fields.name} required error={errors.name} className="sm:col-span-2">
                <Input
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    error={Boolean(errors.name)}
                />
            </Field>
            <Field label={m.fields.company}>
                <Input value={form.company} onChange={(e) => set('company', e.target.value)} />
            </Field>
            <Field label={m.fields.designation}>
                <Input value={form.designation} onChange={(e) => set('designation', e.target.value)} />
            </Field>
            <Field label={m.fields.mobile} error={errors.mobile}>
                <Input
                    value={form.mobile}
                    onChange={(e) => set('mobile', e.target.value)}
                    inputMode="tel"
                    error={Boolean(errors.mobile)}
                />
            </Field>
            <Field label={m.fields.phone}>
                <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
            </Field>
            <Field label={m.fields.email} error={errors.email} className="sm:col-span-2">
                <Input
                    type="email"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    error={Boolean(errors.email)}
                />
            </Field>
            <Field label={m.fields.address} className="sm:col-span-2">
                <Textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={2} />
            </Field>
            <Field label={m.fields.websiteUrl}>
                <Input
                    value={form.website_url}
                    onChange={(e) => set('website_url', e.target.value)}
                    placeholder="https://..."
                />
            </Field>
            <Field label={m.fields.linkedinUrl}>
                <Input
                    value={form.linkedin_url}
                    onChange={(e) => set('linkedin_url', e.target.value)}
                    placeholder="https://linkedin.com/in/..."
                />
            </Field>
            <Field label={m.fields.assignedTo}>
                <Select value={form.assigned_to} onChange={(e) => set('assigned_to', e.target.value)}>
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
            <Field label={m.fields.notes} className="sm:col-span-2">
                <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} />
            </Field>
        </div>
    );
}
