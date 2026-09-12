'use client';

import { Check, X } from 'lucide-react';
import { evaluatePassword, type PasswordPolicy, type PasswordRuleId } from '@erp71/shared-types';
import { useI18n } from '@/lib/i18n';

export type PasswordRequirementsProps = {
    /** What the person has typed so far. */
    password: string;
    /** The workspace's policy; the platform default applies when it is still loading. */
    policy?: PasswordPolicy | null;
    /**
     * Until the field has been touched every rule reads as merely unmet, not
     * failed — a checklist that turns red before the first keystroke is scolding
     * someone for not having typed yet.
     */
    touched?: boolean;
    className?: string;
};

/**
 * Live checklist of the workspace's password rules, shown under every field
 * where somebody chooses a password.
 *
 * Scored by the same `evaluatePassword` the backend rejects with, so a ticked
 * list and a rejected submit cannot disagree. It renders only the rules the
 * policy actually turns on, which is what keeps a workspace that asks for
 * nothing beyond length from showing four permanently-grey lines.
 */
export function PasswordRequirements({
    password,
    policy,
    touched = true,
    className = '',
}: PasswordRequirementsProps) {
    const { t } = useI18n();
    const labels = t.settings.passwordPolicy.rules;
    const { rules } = evaluatePassword(password, policy ?? undefined);

    const labelFor = (id: PasswordRuleId, minLength?: number) =>
        id === 'minLength' ? labels.minLength.replace('{count}', String(minLength ?? 8)) : labels[id];

    return (
        <ul className={`space-y-1 ${className}`.trim()} aria-live="polite">
            {rules.map((rule) => {
                const unmet = !rule.ok;
                const tone = rule.ok
                    ? 'text-emerald-600'
                    : touched && password.length > 0
                        ? 'text-red-600'
                        : 'text-gray-500';

                return (
                    <li key={rule.id} className={`flex items-center gap-1.5 text-xs ${tone}`}>
                        {unmet ? (
                            <X className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                        ) : (
                            <Check className="h-3.5 w-3.5 flex-shrink-0" aria-hidden />
                        )}
                        <span>{labelFor(rule.id, rule.minLength)}</span>
                    </li>
                );
            })}
        </ul>
    );
}

export default PasswordRequirements;
