'use client';

import { useId } from 'react';
import type { PreferenceProfileSummary, TenantRoleSummary } from '@erp71/shared-types';
import { Field, Select } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

/**
 * The profile a role hands to members who start with it. "None" leaves the
 * role without one, so its members get the workspace default profile (if any).
 * The value is the profile id, or '' for None.
 */
export function RoleProfileSelect({
    value,
    profiles,
    current,
    onChange,
}: {
    value: string;
    profiles: PreferenceProfileSummary[];
    /** The role's saved profile: still offered when the profile list did not load, so the select never shows None for it. */
    current?: { id: string; name: string } | null;
    onChange: (profileId: string) => void;
}) {
    const { t } = useI18n();
    const copy = t.teamManagement.roles;
    const id = useId();
    const options = current && !profiles.some((profile) => profile.id === current.id)
        ? [{ id: current.id, name: current.name }, ...profiles]
        : profiles;
    return (
        <Field label={copy.defaultProfileLabel} htmlFor={id} hint={copy.defaultProfileHint}>
            <Select id={id} value={value} onChange={(event) => onChange(event.target.value)} className="w-full max-w-md">
                <option value="">{copy.defaultProfileNone}</option>
                {options.map((profile) => (
                    <option key={profile.id} value={profile.id}>{profile.name}</option>
                ))}
            </Select>
        </Field>
    );
}

/**
 * What the invited person will start with: the primary role's profile, else the
 * workspace default. Renders nothing when neither exists or no role is chosen.
 * The first role picked is the primary one.
 */
export function InviteProfileLine({
    roles,
    selectedRoleIds,
    profiles,
}: {
    roles: TenantRoleSummary[];
    selectedRoleIds: string[];
    profiles: PreferenceProfileSummary[];
}) {
    const { fmt, t } = useI18n();
    const copy = t.teamManagement.roles;
    const primary = roles.find((role) => role.id === selectedRoleIds[0]);
    if (!primary) return null;

    const own = primary.preference_profile?.name;
    const fallback = profiles.find((profile) => profile.is_default)?.name;
    const message = own
        ? fmt(copy.startsWith, { name: own })
        : fallback
            ? fmt(copy.startsWithDefault, { name: fallback })
            : null;
    if (!message) return null;
    return <p className="mt-1.5 text-xs text-gray-500">{message}</p>;
}
