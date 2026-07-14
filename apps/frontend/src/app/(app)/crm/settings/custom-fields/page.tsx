'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { Plus, Trash2, Save } from 'lucide-react';

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
            alert('Custom fields saved.');
        } catch (err: unknown) {
            alert(err instanceof Error ? err.message : 'Failed to save custom fields.');
        } finally {
            setSaving(false);
        }
    };

    if (!loaded) return <div className="p-4 text-sm text-gray-500">Loading…</div>;

    return (
        <div className="overflow-y-auto h-full bg-canvas p-3 md:p-4 font-sans text-gray-900 text-[13px] space-y-4">
            <h1 className="text-lg font-semibold">Lead Custom Fields</h1>
            <p className="text-xs text-gray-500">Define up to {MAX_FIELDS} extra fields for your leads. Text only.</p>
            <div className="space-y-2 max-w-lg">
                {fields.map((f, idx) => (
                    <div key={f.key ?? `new-${idx}`} className="flex items-center gap-2">
                        <input
                            value={f.label}
                            onChange={(e) => setLabel(idx, e.target.value)}
                            maxLength={40}
                            placeholder={`Field ${idx + 1} name`}
                            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"
                        />
                        <button onClick={() => removeField(idx)} className="p-2 text-gray-400 hover:text-rose-600">
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
            <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 bg-violet-600 text-white rounded-lg px-4 py-2 text-sm disabled:opacity-50"
            >
                <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save'}
            </button>
        </div>
    );
}
