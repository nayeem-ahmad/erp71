'use client';

import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ChevronRight, Loader2 } from 'lucide-react';
import type { PreferenceProfileDetail, PreferenceProfileSummary } from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Button, Field, Input, StatusBadge } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import ProfileEditorModal, { isNameTaken } from './ProfileEditorModal';

/** Names a new profile; the editor opens on it once it exists. */
function CreateProfileModal({
    onClose,
    onCreated,
}: {
    onClose: () => void;
    onCreated: (profile: PreferenceProfileDetail) => void;
}) {
    const { t } = useI18n();
    const copy = t.teamManagement.profiles;
    const inputId = useId();
    const [name, setName] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const submit = async (event: FormEvent) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
            setError(copy.nameRequired);
            return;
        }
        setSaving(true);
        try {
            onCreated(await api.createPreferenceProfile({ name: trimmed }));
        } catch (err) {
            if (isNameTaken(err)) setError(copy.nameTaken);
            else {
                const message = (err as { message?: unknown } | null)?.message;
                toast.error(typeof message === 'string' && message ? message : copy.createFailed);
            }
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose} dismissOnBackdrop={false}>
            <form onSubmit={(event) => void submit(event)} noValidate className="flex min-h-0 flex-col">
                <ModalHeader title={copy.createTitle} onClose={onClose} closeLabel={t.common.close} />
                <div className="p-4">
                    <Field label={copy.nameLabel} htmlFor={inputId} error={error ?? undefined}>
                        <Input
                            id={inputId}
                            value={name}
                            maxLength={60}
                            placeholder={copy.namePlaceholder}
                            autoFocus
                            aria-invalid={error ? true : undefined}
                            error={Boolean(error)}
                            className="w-full"
                            onChange={(event) => {
                                setName(event.target.value);
                                setError(null);
                            }}
                        />
                    </Field>
                </div>
                <ModalFooter>
                    <Button variant="secondary" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" loading={saving}>
                        {copy.create}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}

export interface ProfilesPanelProps {
    /** "New profile" lives in the page header; the page says when it was pressed. */
    createOpen: boolean;
    onCreateClose: () => void;
}

/**
 * Team → Default profiles: the workspace's preference profiles, which one is
 * the default, and the roles using each. A row opens the editor.
 */
export default function ProfilesPanel({ createOpen, onCreateClose }: ProfilesPanelProps) {
    const { t, fmt } = useI18n();
    const copy = t.teamManagement.profiles;
    const [profiles, setProfiles] = useState<PreferenceProfileSummary[]>([]);
    const [loading, setLoading] = useState(true);
    const [editingId, setEditingId] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            setProfiles((await api.getPreferenceProfiles()) ?? []);
        } catch (err) {
            const message = (err as { message?: unknown } | null)?.message;
            toast.error(typeof message === 'string' && message ? message : copy.loadFailed);
        } finally {
            setLoading(false);
        }
    }, [copy.loadFailed]);

    useEffect(() => {
        void load();
    }, [load]);

    return (
        <div className="space-y-4">
            <p className="text-xs text-gray-500">{copy.intro}</p>

            {loading ? (
                <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-8 text-sm text-gray-400">
                    <Loader2 className="me-2 h-4 w-4 animate-spin" /> {copy.loading}
                </div>
            ) : profiles.length === 0 ? (
                <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-400">
                    {copy.empty}
                </div>
            ) : (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
                    {profiles.map((profile) => (
                        <li key={profile.id}>
                            <button
                                type="button"
                                onClick={() => setEditingId(profile.id)}
                                className="flex min-h-touch w-full items-center justify-between gap-3 px-3 py-2.5 text-start hover:bg-gray-50 md:px-4"
                            >
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="truncate text-sm font-semibold text-gray-900">{profile.name}</span>
                                        {profile.is_default ? <StatusBadge tone="info">{copy.defaultBadge}</StatusBadge> : null}
                                    </div>
                                    <p className="truncate text-xs text-gray-500">
                                        {profile.roles.length > 0
                                            ? fmt(copy.roles, {
                                                  roles: profile.roles.map((role) => role.name).join(copy.listSeparator),
                                              })
                                            : copy.noRoles}
                                    </p>
                                </div>
                                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 rtl:rotate-180" aria-hidden="true" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {createOpen ? (
                <CreateProfileModal
                    onClose={onCreateClose}
                    onCreated={(created) => {
                        onCreateClose();
                        void load();
                        setEditingId(created.id);
                    }}
                />
            ) : null}
            {editingId ? (
                <ProfileEditorModal
                    profileId={editingId}
                    profiles={profiles}
                    onChanged={() => void load()}
                    onClose={() => setEditingId(null)}
                />
            ) : null}
        </div>
    );
}
