'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { getWorkspaceItem } from '@/lib/session-store';

/** Which composer a template is offered in. */
export type TemplateUsage = 'LOG' | 'SCHEDULE' | 'BOTH';

export type CrmMessageTemplate = {
    id: string;
    name: string;
    usage: TemplateUsage;
    subject: string | null;
    body: string;
    sort_order: number;
    is_active: boolean;
    channel: { id: string; name: string; icon: string | null } | null;
    purpose: { id: string; name: string; icon: string | null } | null;
};

/**
 * What a `{{token}}` can stand for. Every value is optional: the composer knows
 * the customer's name on a lead page but not always on the activities list, and
 * a token whose value is missing is deliberately left standing rather than
 * silently blanked — "Dear {{name}}" in the box is a prompt to finish the
 * sentence, "Dear ," is a message that goes out broken.
 */
export type TemplateVars = {
    name?: string | null;
    phone?: string | null;
    user?: string | null;
    business?: string | null;
    date?: string | null;
};

/**
 * The tokens a template body may carry, in the order the Setup screen lists
 * them. Kept here rather than in the translation files: these are literal text a
 * tenant types into a template, so translating them would break every template
 * written in another locale.
 */
export const TEMPLATE_TOKENS: readonly (keyof TemplateVars)[] = [
    'name',
    'phone',
    'user',
    'business',
    'date',
];

/**
 * Substitute `{{token}}` placeholders in a template body.
 *
 * Whitespace inside the braces is tolerated (`{{ name }}`) because people type
 * it, and matching is case-insensitive for the same reason. An unknown token, or
 * a known one with no value to hand, is left exactly as written — see
 * `TemplateVars`.
 */
export function fillTemplate(text: string, vars: TemplateVars): string {
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, token: string) => {
        const value = vars[token.toLowerCase() as keyof TemplateVars];
        return value ? String(value) : whole;
    });
}

/**
 * The tenant's message templates for one composer.
 *
 * `usage` is sent to the server rather than filtered here so the picker and the
 * Setup list cannot disagree about what "offered when logging" means.
 * `channelId` narrows further to the channel the form is currently on; passing
 * it as undefined (the schedule dialog, where no channel is chosen yet) returns
 * every template.
 */
export function useCrmMessageTemplates(usage: 'LOG' | 'SCHEDULE', channelId?: string) {
    const [templates, setTemplates] = useState<CrmMessageTemplate[]>([]);
    const [loading, setLoading] = useState(true);

    const reload = useCallback(() => {
        setLoading(true);
        return api
            .getCrmMessageTemplates({ usage, channelId })
            .then((rows: CrmMessageTemplate[]) => {
                setTemplates(Array.isArray(rows) ? rows : []);
                return rows;
            })
            .catch(() => {
                // A tenant with no templates yet, or one whose plan cannot reach
                // the endpoint, should see the dialog without a picker — not an
                // error over a form that works perfectly well without one.
                setTemplates([]);
                return [] as CrmMessageTemplate[];
            })
            .finally(() => setLoading(false));
    }, [usage, channelId]);

    useEffect(() => {
        reload();
    }, [reload]);

    return { templates, loading, reload };
}

/**
 * The `{{user}}` and `{{business}}` values, resolved from the signed-in session.
 *
 * Separate from `useTeamMemberOptions`, which relabels the current user as "Me"
 * for its picker — a template signed off "— Me" would be worse than one signed
 * off with an unreplaced token.
 */
export function useTemplateIdentity() {
    const [identity, setIdentity] = useState<{ user: string | null; business: string | null }>({
        user: null,
        business: null,
    });

    useEffect(() => {
        let cancelled = false;
        api.getMe()
            .then((me: { name?: string | null; tenants?: { id: string; name?: string | null }[] }) => {
                if (cancelled) return;
                // Same tenant resolution CRM Setup uses: the workspace this tab
                // is looking at, falling back to the only one most people have.
                const tenant =
                    me?.tenants?.find((entry) => entry.id === getWorkspaceItem('tenant_id'))
                    ?? me?.tenants?.[0];
                setIdentity({ user: me?.name ?? null, business: tenant?.name ?? null });
            })
            .catch(() => {
                // Both tokens are then left standing in the text, which is the
                // documented fallback — no reason to fail the dialog over it.
                if (!cancelled) setIdentity({ user: null, business: null });
            });
        return () => { cancelled = true; };
    }, []);

    return identity;
}
