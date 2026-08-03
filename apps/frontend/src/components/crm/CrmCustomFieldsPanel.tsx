'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Trash2, Save } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';

const MAX_FIELDS = 10;
type Field = { key?: string; label: string };

/**
 * The extra text fields captured on every lead. Unlike the three lookup lists this
 * is a save-the-whole-set form rather than per-row CRUD, which is why it stays its
 * own component rather than another `CrmListPanel` kind.
 */
export default function CrmCustomFieldsPanel({ canManage }: Readonly<{ canManage: boolean }>) {
    const { t } = useI18n();
    const m = t.crm.setup.customFields;

    const [fields, setFields] = useState<Field[]>([]);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        api.getCustomFields('LEAD')
            .then((data: any[]) => setFields(Array.isArray(data) ? data.map((d) => ({ key: d.key, label: d.label })) : []))
            .catch(() => setFields([]))
            .finally(() => setLoaded(true));
    }, []);

    const addField = () => {
        if (fields.length >= MAX_FIELDS) return;
        setFields([...fields, { label: '' }]);
    };
    const removeField = (idx: number) => setFields(fields.filter((_, i) => i !== idx));
    const setLabel = (idx: number, label: string) =>
        setFields(fields.map((f, i) => (i === idx ? { ...f, label } : f)));

    const save = async () => {
        const cleaned = fields.map((f) => ({ key: f.key, label: f.label.trim() })).filter((f) => f.label);
        setSaving(true);
        try {
            const result = await api.saveCustomFields('LEAD', cleaned);
            setFields(Array.isArray(result) ? result.map((d: any) => ({ key: d.key, label: d.label })) : []);
            toast.success(m.saved);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : m.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    if (!loaded) return <p className="text-sm text-gray-500">{t.common.loading}</p>;

    return (
        <div className="space-y-3">
            <p className="text-sm text-gray-500">{m.hint.replace('{max}', String(MAX_FIELDS))}</p>
            <div className="space-y-2 max-w-lg">
                {fields.map((f, idx) => (
                    <div key={f.key ?? `new-${idx}`} className="flex items-center gap-2">
                        <Input
                            value={f.label}
                            onChange={(e) => setLabel(idx, e.target.value)}
                            maxLength={40}
                            placeholder={m.fieldPlaceholder.replace('{n}', String(idx + 1))}
                            disabled={!canManage}
                        />
                        {canManage && (
                            <button
                                onClick={() => removeField(idx)}
                                aria-label={m.removeField}
                                className="p-2 min-h-touch text-gray-400 hover:text-danger"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                ))}
                {canManage && fields.length < MAX_FIELDS && (
                    <button onClick={addField} className="inline-flex items-center gap-1 min-h-touch text-sm text-primary">
                        <Plus className="w-4 h-4" /> {m.addField}
                    </button>
                )}
            </div>
            {canManage && (
                <Button onClick={save} loading={saving} icon={<Save className="w-4 h-4" />}>
                    {m.save}
                </Button>
            )}
        </div>
    );
}
