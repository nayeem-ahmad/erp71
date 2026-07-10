'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type StoreRow = { id: string; name: string };

export default function StoreSettingsPage() {
    const { t } = useI18n();
    const copy = t.settings.storeSettings;
    const [stores, setStores] = useState<StoreRow[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

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
        setMessage(null);
        setError(null);
        try {
            await api.updateStore(store.id, { name: store.name.trim() });
            setMessage(copy.saved);
        } catch {
            setError(copy.error);
        } finally {
            setSavingId(null);
        }
    };

    return (
        <div className="max-w-2xl mx-auto p-6 space-y-6">
            <div>
                <h1 className="text-xl font-bold">{copy.title}</h1>
                <p className="text-sm text-gray-500">{copy.description}</p>
            </div>
            {message && <p className="text-sm text-emerald-600">{message}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="space-y-4">
                {stores.map((store) => (
                    <div key={store.id} className="flex items-end gap-3">
                        <label className="flex-1 space-y-1">
                            <span className="text-sm font-medium text-gray-700">{copy.nameLabel}</span>
                            <input
                                value={store.name}
                                onChange={(e) => handleName(store.id, e.target.value)}
                                className="w-full bg-gray-50 border border-gray-200 rounded-xl py-2 px-3 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                            />
                        </label>
                        <button
                            type="button"
                            onClick={() => handleSave(store)}
                            disabled={savingId === store.id || !store.name.trim()}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-xl disabled:opacity-70"
                        >
                            {copy.save}
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}
