'use client';

import { useEffect, useState } from 'react';
import {
    PERSON_SECTIONS,
    type PersonSectionKey,
    type PreferenceProfileDetail,
    type PreferenceProfileSummary,
} from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Checkbox } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';

/** The fields of a `/team/members` row this needs. */
interface MemberRow {
    userId: string;
    /** The primary role — the one whose profile a member follows. */
    tenantRoleId: string | null;
    isSelf: boolean;
}

type ProfileRoles = Pick<PreferenceProfileSummary, 'id' | 'is_default' | 'roles'>;

/**
 * How many members an apply without `user_ids` reaches, by the server's own
 * rule (`PreferenceProfilesService.apply`): members whose primary role uses the
 * profile and, for the workspace default, members with no role or a role with
 * no profile of its own — never the admin applying it.
 *
 * Counted here because the server only says how many it changed once it has.
 */
export function membersFollowing(members: MemberRow[], profile: ProfileRoles, profiles: ProfileRoles[]): number {
    const own = new Set(profile.roles.map((role) => role.id));
    const profiled = new Set([...own, ...profiles.flatMap((entry) => entry.roles.map((role) => role.id))]);
    return members.filter((member) => {
        if (member.isSelf) return false;
        if (member.tenantRoleId && own.has(member.tenantRoleId)) return true;
        return profile.is_default && (!member.tenantRoleId || !profiled.has(member.tenantRoleId));
    }).length;
}

function hasAnswers(value: unknown): boolean {
    return !!value && typeof value === 'object' && Object.keys(value).length > 0;
}

export interface ApplyProfileModalProps {
    /** The saved profile. */
    profile: PreferenceProfileDetail;
    profiles: PreferenceProfileSummary[];
    onClose: () => void;
}

/**
 * The confirmation before a profile overrides what members chose themselves.
 *
 * Applying discards the members' own answers in the chosen sections, so it
 * names those sections and how many members it reaches before anything
 * happens. Only person sections are offered: the till's print setup is never a
 * member's answer, so there is nothing of theirs to discard. The ones this
 * profile sets start ticked.
 */
export default function ApplyProfileModal({ profile, profiles, onClose }: ApplyProfileModalProps) {
    const { t, fmt } = useI18n();
    const copy = t.teamManagement.profiles;
    const [chosen, setChosen] = useState<PersonSectionKey[]>(() =>
        PERSON_SECTIONS.filter((key) => hasAnswers(profile.sections[key])),
    );
    /** `undefined` while the member list loads, `null` when it could not be read. */
    const [count, setCount] = useState<number | null | undefined>(undefined);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getTeamMembers()
            .then((members: MemberRow[]) => {
                if (!cancelled) setCount(membersFollowing(members ?? [], profile, profiles));
            })
            .catch(() => {
                if (!cancelled) setCount(null);
            });
        return () => {
            cancelled = true;
        };
    }, [profile, profiles]);

    const ordered = PERSON_SECTIONS.filter((key) => chosen.includes(key));
    const toggle = (key: PersonSectionKey, on: boolean) =>
        setChosen((current) => (on ? [...current, key] : current.filter((k) => k !== key)));

    const apply = async () => {
        setApplying(true);
        try {
            const { updated } = await api.applyPreferenceProfile(profile.id, { sections: ordered });
            toast.success(fmt(copy.applied, { count: updated }));
            onClose();
        } catch (error) {
            const message = (error as { message?: unknown } | null)?.message;
            toast.error(typeof message === 'string' && message ? message : copy.applyFailed);
            setApplying(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={copy.applyTitle} subtitle={profile.name} onClose={onClose} closeLabel={t.common.close} />
            <div className="space-y-3 overflow-y-auto p-4">
                <p className="text-sm text-gray-600">{copy.applyIntro}</p>
                <fieldset className="space-y-1">
                    <legend className="text-xs font-medium text-gray-600">{copy.applySections}</legend>
                    {PERSON_SECTIONS.map((key) => (
                        <label key={key} className="flex min-h-touch cursor-pointer items-center gap-2 sm:min-h-0">
                            <Checkbox checked={chosen.includes(key)} onChange={(event) => toggle(key, event.target.checked)} />
                            <span className="text-sm text-gray-700">{copy.sections[key]}</span>
                        </label>
                    ))}
                </fieldset>
                <div className="space-y-1 rounded-md bg-gray-50 p-3">
                    <p className="text-sm font-semibold text-gray-900">
                        {ordered.length > 0
                            ? ordered.map((key) => copy.sections[key]).join(copy.listSeparator)
                            : copy.chooseSection}
                    </p>
                    <p className="text-sm text-gray-700">
                        {count === undefined
                            ? t.teamManagement.loading
                            : count === null
                              ? copy.applyCountUnknown
                              : fmt(copy.applyCount, { count })}
                    </p>
                    <p className="text-xs text-gray-500">{copy.applyNotYou}</p>
                </div>
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button
                    loading={applying}
                    disabled={ordered.length === 0 || count === undefined}
                    onClick={() => void apply()}
                >
                    {copy.apply}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
