'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
    RECORD_HISTORY_DEFAULT_RETENTION_DAYS,
    RECORD_HISTORY_ENTITY_TYPES,
    RECORD_HISTORY_RETENTION_KEY,
    RECORD_HISTORY_SETTING_KEYS,
    type RecordHistoryEntityType,
} from '@erp71/shared-types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button, Field, Input, Switch } from '@/components/ui';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

type Switches = Record<RecordHistoryEntityType, boolean>;

const ALL_ON = Object.fromEntries(RECORD_HISTORY_ENTITY_TYPES.map((type) => [type, true])) as Switches;

/**
 * Which record types keep a history, and for how long. Reads and writes the
 * `record_history` platform-settings group; the backend caches it for a
 * minute, which is why the copy says changes land "within a minute".
 */
export default function RecordHistorySettingsModal({ onClose }: { onClose: () => void }) {
    const { t } = useI18n();
    const m = t.admin.recordHistory;
    const s = m.settingsPanel;

    const [switches, setSwitches] = useState<Switches>(ALL_ON);
    const [retention, setRetention] = useState(String(RECORD_HISTORY_DEFAULT_RETENTION_DAYS));
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [retentionError, setRetentionError] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.getRecordHistorySettings()
            .then((data: Record<string, string | null>) => {
                setSwitches(
                    Object.fromEntries(
                        RECORD_HISTORY_ENTITY_TYPES.map((type) => [
                            type,
                            data?.[RECORD_HISTORY_SETTING_KEYS[type]] !== 'false',
                        ]),
                    ) as Switches,
                );
                setRetention(data?.[RECORD_HISTORY_RETENTION_KEY] ?? String(RECORD_HISTORY_DEFAULT_RETENTION_DAYS));
            })
            .catch(() => setLoadError(s.loadFailed))
            .finally(() => setLoading(false));
    }, [s.loadFailed]);

    async function save() {
        const days = retention.trim();
        if (!/^\d+$/.test(days)) {
            setRetentionError(s.retentionInvalid);
            return;
        }
        setRetentionError('');
        setSaving(true);
        try {
            const settings: Record<string, string> = { [RECORD_HISTORY_RETENTION_KEY]: String(Number(days)) };
            for (const type of RECORD_HISTORY_ENTITY_TYPES) {
                settings[RECORD_HISTORY_SETTING_KEYS[type]] = String(switches[type]);
            }
            await api.updateRecordHistorySettings(settings);
            toast.success(s.saved);
            onClose();
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : s.saveFailed);
        } finally {
            setSaving(false);
        }
    }

    return (
        <ModalShell size="md" onBackdropClick={saving ? undefined : onClose} dismissOnBackdrop={false}>
            <ModalHeader title={s.title} subtitle={s.description} onClose={saving ? undefined : onClose} closeLabel={s.cancel} />

            <div className="space-y-4 overflow-y-auto p-4">
                {loadError && <Alert tone="danger">{loadError}</Alert>}
                {loading ? (
                    <div className="flex items-center justify-center py-8 text-sm text-gray-400">
                        <Loader2 className="me-2 h-5 w-5 animate-spin" />
                        {t.common.loading}
                    </div>
                ) : (
                    <>
                        <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
                            {RECORD_HISTORY_ENTITY_TYPES.map((type) => (
                                <li key={type}>
                                    <label className="flex min-h-touch cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm text-gray-800">
                                        {m.entities[type]}
                                        <Switch
                                            checked={switches[type]}
                                            onCheckedChange={(checked) =>
                                                setSwitches((current) => ({ ...current, [type]: checked }))
                                            }
                                        />
                                    </label>
                                </li>
                            ))}
                        </ul>

                        <Field label={s.retention} htmlFor="record-history-retention" hint={s.retentionHint} error={retentionError || undefined}>
                            <Input
                                id="record-history-retention"
                                inputMode="numeric"
                                className="w-32"
                                value={retention}
                                error={Boolean(retentionError)}
                                onChange={(event) => setRetention(event.target.value)}
                            />
                        </Field>
                    </>
                )}
            </div>

            <ModalFooter>
                <Button variant="secondary" onClick={onClose} disabled={saving}>
                    {s.cancel}
                </Button>
                <Button onClick={save} disabled={loading || saving || Boolean(loadError)}>
                    {saving ? s.saving : s.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}
