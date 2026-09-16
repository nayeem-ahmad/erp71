'use client';

import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { useTenantPlanFeatures } from '@/lib/use-tenant-plan-features';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { Alert, Button, Field, Input, PageShell } from '@/components/ui';
import PageHeader from '@/components/ui/compact/PageHeader';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

type StoreRow = { id: string; name: string };

export default function StoreSettingsPage() {
    const { t } = useI18n();
    const copy = t.settings.storeSettings;
    const { features, ready } = useTenantPlanFeatures();
    const [stores, setStores] = useState<StoreRow[]>([]);
    const [savingId, setSavingId] = useState<string | null>(null);
    const [showAdd, setShowAdd] = useState(false);
    const [newName, setNewName] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [nameError, setNameError] = useState('');
    /** Inline error under one branch's own name field, keyed by branch id. */
    const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
    const [creating, setCreating] = useState(false);

    // The API gate is `multiStore` on POST /stores; mirror it here so the button
    // is absent rather than offering an action the server will refuse.
    const canAddStore = features.multiStore === true;

    const loadStores = () =>
        api.getStores()
            .then((rows: StoreRow[]) => setStores(Array.isArray(rows) ? rows.map((s) => ({ id: s.id, name: s.name })) : []))
            .catch(() => setStores([]));

    useEffect(() => {
        loadStores();
    }, []);

    const handleName = (id: string, name: string) => {
        setStores((rows) => rows.map((s) => (s.id === id ? { ...s, name } : s)));
        setRowErrors((errors) => (errors[id] ? { ...errors, [id]: '' } : errors));
    };

    /**
     * The name a branch may not take: blank, or one another branch already holds.
     * The server enforces both; checking here too means the answer arrives as the
     * user types rather than as a toast that does not say which row was wrong.
     */
    const nameProblem = (id: string, name: string) => {
        if (!name) return copy.nameRequired;
        const clash = stores.some((other) => (
            other.id !== id && other.name.trim().toLowerCase() === name.toLowerCase()
        ));
        return clash ? copy.nameDuplicate : '';
    };

    const handleSave = async (store: StoreRow) => {
        const name = store.name.trim();
        const problem = nameProblem(store.id, name);
        if (problem) {
            setRowErrors((errors) => ({ ...errors, [store.id]: problem }));
            return;
        }

        setSavingId(store.id);
        try {
            await api.updateStore(store.id, { name });
            toast.success(copy.saved);
        } catch (err: any) {
            toast.error(err?.message || copy.error);
        } finally {
            setSavingId(null);
        }
    };

    const openAdd = () => {
        setNewName('');
        setNewAddress('');
        setNameError('');
        setShowAdd(true);
    };

    const handleCreate = async () => {
        const name = newName.trim();
        // '' is not a branch id, so nothing in the list is excluded from the check.
        const problem = nameProblem('', name);
        if (problem) {
            setNameError(problem);
            return;
        }
        setCreating(true);
        try {
            await api.createStore({ name, address: newAddress.trim() || undefined });
            toast.success(copy.created);
            setShowAdd(false);
            // The list comes from /auth/me, which is also what the branch switcher
            // reads — refetching keeps both in step with the store just created.
            await loadStores();
        } catch (err: any) {
            toast.error(err?.message || copy.createError);
        } finally {
            setCreating(false);
        }
    };

    return (
        <PageShell maxWidth="narrow">
            <PageHeader
                title={copy.title}
                subtitle={copy.description}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accountSettings,
                    copy.title,
                    'settings',
                )}
                actions={ready && canAddStore ? (
                    <Button icon={<Plus className="w-4 h-4" />} onClick={openAdd}>
                        {copy.add}
                    </Button>
                ) : undefined}
            />

            {ready && !canAddStore && (
                <Alert tone="info" className="mt-4">
                    {copy.locked}
                </Alert>
            )}

            <div className="mt-4 space-y-4">
                {stores.map((store) => (
                    <div key={store.id} className="flex items-end gap-3">
                        <Field
                            label={copy.nameLabel}
                            htmlFor={`store-${store.id}`}
                            className="flex-1"
                            error={rowErrors[store.id] || undefined}
                        >
                            <Input
                                id={`store-${store.id}`}
                                value={store.name}
                                onChange={(e) => handleName(store.id, e.target.value)}
                            />
                        </Field>
                        <Button
                            onClick={() => handleSave(store)}
                            // Not disabled on a blank name: a button that does
                            // nothing and says nothing leaves the user guessing.
                            // Clicking it surfaces the inline message instead,
                            // which is what the Add form already does.
                            disabled={savingId === store.id}
                        >
                            {copy.save}
                        </Button>
                    </div>
                ))}
            </div>

            {showAdd && (
                <ModalShell size="sm" onBackdropClick={() => setShowAdd(false)}>
                    <ModalHeader title={copy.addTitle} onClose={() => setShowAdd(false)} />
                    <div className="p-4 space-y-4">
                        <Field label={copy.nameLabel} htmlFor="new-store-name" required error={nameError}>
                            <Input
                                id="new-store-name"
                                value={newName}
                                onChange={(e) => {
                                    setNewName(e.target.value);
                                    if (nameError) setNameError('');
                                }}
                            />
                        </Field>
                        <Field label={copy.addressLabel} htmlFor="new-store-address">
                            <Input
                                id="new-store-address"
                                value={newAddress}
                                onChange={(e) => setNewAddress(e.target.value)}
                            />
                        </Field>
                    </div>
                    <ModalFooter>
                        <Button variant="secondary" onClick={() => setShowAdd(false)} disabled={creating}>
                            {copy.cancel}
                        </Button>
                        <Button onClick={handleCreate} disabled={creating} loading={creating}>
                            {creating ? copy.adding : copy.create}
                        </Button>
                    </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
