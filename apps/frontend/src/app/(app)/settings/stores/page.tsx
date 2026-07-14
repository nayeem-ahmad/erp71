'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Button, Field, Input, PageShell } from '@/components/ui';

type StoreRow = { id: string; name: string };

export default function StoreSettingsPage() {
    const { t } = useI18n();
    const copy = t.settings.storeSettings;
    const [stores, setStores] = useState<StoreRow[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);

    useEffect(() => {
        api.getStores()
            .then((rows: StoreRow[]) => setStores(Array.isArray(rows) ? rows.map((s) => ({ id: s.id, name: s.name })) : []))
            .catch(() => setStores([]));
    }, []);

    const handleName = (id: string, name: string) => {
        setStores((rows) => rows.map((s) => (s.id === id ? { ...s, name } : s)));
    };

    const handleSave = async (store: StoreRow) => {
        setSavingId(store.id);
        try {
            await api.updateStore(store.id, { name: store.name.trim() });
            toast.success(copy.saved);
        } catch {
            toast.error(copy.error);
        } finally {
            setSavingId(null);
        }
    };

    return (
        <PageShell maxWidth="narrow">
            <div className="mb-4">
                <h1 className="text-xl font-bold">{copy.title}</h1>
                <p className="text-sm text-gray-500">{copy.description}</p>
            </div>
            <div className="space-y-4">
                {stores.map((store) => (
                    <div key={store.id} className="flex items-end gap-3">
                        <Field label={copy.nameLabel} htmlFor={`store-${store.id}`} className="flex-1">
                            <Input
                                id={`store-${store.id}`}
                                value={store.name}
                                onChange={(e) => handleName(store.id, e.target.value)}
                            />
                        </Field>
                        <Button
                            onClick={() => handleSave(store)}
                            disabled={savingId === store.id || !store.name.trim()}
                        >
                            {copy.save}
                        </Button>
                    </div>
                ))}
            </div>
        </PageShell>
    );
}
