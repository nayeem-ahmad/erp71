'use client';

import { useId } from 'react';
import { Field, Select } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { formatDate } from '@/lib/format';
import {
    fillTemplate,
    useCrmMessageTemplates,
    useTemplateIdentity,
    type CrmMessageTemplate,
} from '@/lib/crm-message-templates';

/** A picked template with its `{{tokens}}` already resolved. */
export type PickedTemplate = {
    template: CrmMessageTemplate;
    body: string;
    /** Null when the template carries no subject of its own. */
    subject: string | null;
};

type Props = {
    usage: 'LOG' | 'SCHEDULE';
    /**
     * The channel the form is on, which narrows the list to the templates that
     * channel offers. Undefined asks for every template — the schedule form has
     * no channel field.
     */
    channelId?: string;
    /**
     * Who the activity is with, for `{{name}}` / `{{phone}}`. Either may be
     * missing; a token with no value is left standing — see `fillTemplate`.
     */
    recipient?: { name?: string | null; phone?: string | null };
    onPick: (picked: PickedTemplate) => void;
};

/**
 * "Use a template…" above an activity form: the Log and Schedule dialogs in
 * `CrmActivityComposer` and the Complete dialog in `CrmActivityPanel`.
 *
 * Renders nothing while the tenant has no templates for this form — not an
 * empty select to squint at. Mounted only while its dialog is open, so the
 * lead page does not fetch templates for a dialog nobody opened. What a pick
 * does with the text is the caller's: each form puts it in different fields.
 */
export default function CrmMessageTemplatePicker({
    usage,
    channelId,
    recipient,
    onPick,
}: Readonly<Props>) {
    const { t, locale } = useI18n();
    const m = t.crm.activities;
    const selectId = useId();

    const { templates } = useCrmMessageTemplates(usage, channelId);
    const identity = useTemplateIdentity();

    if (templates.length === 0) return null;

    const pick = (template: CrmMessageTemplate) => {
        const vars = {
            name: recipient?.name ?? null,
            phone: recipient?.phone ?? null,
            user: identity.user,
            business: identity.business,
            date: formatDate(new Date(), locale),
        };
        onPick({
            template,
            body: fillTemplate(template.body, vars),
            subject: template.subject ? fillTemplate(template.subject, vars) : null,
        });
    };

    // The value stays on the placeholder after each pick so the same template
    // can be re-applied — a rep who has edited the text into a corner wants the
    // original back, and a `<select>` that keeps its value fires no change
    // event the second time.
    return (
        <Field label={m.fields.template} hint={m.fields.templateHint} htmlFor={selectId}>
            <Select
                id={selectId}
                value=""
                onChange={(e) => {
                    const picked = templates.find((tpl) => tpl.id === e.target.value);
                    if (picked) pick(picked);
                }}
            >
                <option value="">{m.fields.templatePlaceholder}</option>
                {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>{tpl.name}</option>
                ))}
            </Select>
        </Field>
    );
}
