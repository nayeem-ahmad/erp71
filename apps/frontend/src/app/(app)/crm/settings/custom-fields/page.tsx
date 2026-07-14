'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Trash2, Save } from 'lucide-react';
import { PageShell, PageHeader, Button, Input } from '@/components/ui';
import { toast } from '@/lib/toast';

const MAX_FIELDS = 10;
type Field = { key?: string; label: string };

export default function CustomFieldsSettingsPage() {
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
            toast.success('Custom fields saved.');
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Failed to save custom fields.');
        } finally {
            setSaving(false);
        }
    };

    if (!loaded) return <div className="p-4 text-sm text-gray-500">Loading…</div>;

    return (
        <PageShell maxWidth="narrow">
            <PageHeader title="Lead Custom Fields" subtitle={`Define up to ${MAX_FIELDS} extra fields for your leads. Text only.`} />
            <div className="space-y-2 max-w-lg">
                {fields.map((f, idx) => (
                    <div key={f.key ?? `new-${idx}`} className="flex items-center gap-2">
                        <Input
                            value={f.label}
                            onChange={(e) => setLabel(idx, e.target.value)}
                            maxLength={40}
                            placeholder={`Field ${idx + 1} name`}
                        />
                        <button onClick={() => removeField(idx)} className="p-2 text-gray-400 hover:text-danger">
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                ))}
                {fields.length < MAX_FIELDS && (
                    <button onClick={addField} className="inline-flex items-center gap-1 text-sm text-violet-600">
                        <Plus className="w-4 h-4" /> Add field
                    </button>
                )}
            </div>
            <Button onClick={save} loading={saving} icon={<Save className="w-4 h-4" />}>
                Save
            </Button>
        </PageShell>
    );
}
