'use client';

import { useState } from 'react';
import { Loader2, Search } from 'lucide-react';
import { BUSINESS_TYPE_LABELS, BUSINESS_TYPE_VALUES } from '@erp71/shared-types';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { emptyCreateDraft, type CreateDraft, type PlanCode } from './types';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';

type Props = {
    open: boolean;
    onClose: () => void;
    onCreated: (tenantId: string, tenantName: string) => void;
};

export default function CreateTenantModal({ open, onClose, onCreated }: Props) {
    const { t } = useI18n();
    const mc = t.admin.tenants.createModal;
    const [createMode, setCreateMode] = useState<'new' | 'existing'>('new');
    const [createDraft, setCreateDraft] = useState<CreateDraft>(emptyCreateDraft());
    const [lookupResult, setLookupResult] = useState<{ id: string; email: string; name: string | null } | null>(null);
    const [lookupNotFound, setLookupNotFound] = useState(false);
    const [isLookingUp, setIsLookingUp] = useState(false);
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    if (!open) return null;

    const close = () => {
        if (isCreating) return;
        onClose();
    };

    const handleLookup = async () => {
        if (!createDraft.existingEmail) return;
        setIsLookingUp(true);
        setLookupResult(null);
        setLookupNotFound(false);
        setCreateDraft((d) => ({ ...d, ownerUserId: '' }));
        try {
            const user: { id: string; email: string; name: string | null } = await api.lookupAdminUser(createDraft.existingEmail);
            setLookupResult(user);
            setCreateDraft((d) => ({ ...d, ownerUserId: user.id }));
        } catch {
            setLookupNotFound(true);
        } finally {
            setIsLookingUp(false);
        }
    };

    const handleCreate = async () => {
        setIsCreating(true);
        setCreateError('');
        try {
            const payload: Record<string, unknown> = {
                ownerMode: createMode,
                tenantName: createDraft.tenantName,
                storeName: createDraft.storeName,
                planCode: createDraft.planCode,
            };
            if (createDraft.address) payload.address = createDraft.address;
            if (createDraft.businessType) payload.businessType = createDraft.businessType;
            if (createDraft.discountMode !== 'NONE') {
                const value = Number(createDraft.discountValue);
                if (!Number.isFinite(value) || value <= 0) {
                    throw new Error(mc.discountInvalid);
                }
                if (createDraft.discountMode === 'PERCENTAGE' && value > 100) {
                    throw new Error(mc.discountPercentInvalid);
                }
                payload.discountType = createDraft.discountMode;
                payload.discountValue = value;
            }
            if (createMode === 'new') {
                payload.ownerEmail = createDraft.ownerEmail;
                if (createDraft.ownerName) payload.ownerName = createDraft.ownerName;
            } else {
                payload.ownerUserId = createDraft.ownerUserId;
            }

            const created: { id: string } = await api.createAdminTenant(payload as Parameters<typeof api.createAdminTenant>[0]);
            setCreateDraft(emptyCreateDraft());
            onCreated(created.id, createDraft.tenantName);
        } catch (err: unknown) {
            setCreateError(err instanceof Error ? err.message : mc.createFailed);
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={close}>
            <ModalHeader title={mc.title} />

            <div className="p-6 space-y-5 overflow-y-auto">
                {createError && (
                    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                        {createError}
                    </div>
                )}

                <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500">{mc.ownerSection}</p>
                    <div className="flex rounded-md border border-gray-100 overflow-hidden">
                        <button
                            type="button"
                            onClick={() => { setCreateMode('new'); setLookupResult(null); setLookupNotFound(false); }}
                            className={`flex-1 py-2.5 text-xs font-semibold transition ${createMode === 'new' ? 'bg-primary text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                            {mc.tabNewUser}
                        </button>
                        <button
                            type="button"
                            onClick={() => setCreateMode('existing')}
                            className={`flex-1 py-2.5 text-xs font-semibold transition ${createMode === 'existing' ? 'bg-primary text-white' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}
                        >
                            {mc.tabExistingUser}
                        </button>
                    </div>

                    {createMode === 'new' ? (
                        <div className="space-y-3">
                            <input
                                type="email"
                                value={createDraft.ownerEmail}
                                onChange={(e) => setCreateDraft((d) => ({ ...d, ownerEmail: e.target.value }))}
                                placeholder={mc.ownerEmail}
                                className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                            <input
                                value={createDraft.ownerName}
                                onChange={(e) => setCreateDraft((d) => ({ ...d, ownerName: e.target.value }))}
                                placeholder={mc.ownerName}
                                className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="flex gap-2">
                                <input
                                    type="email"
                                    value={createDraft.existingEmail}
                                    onChange={(e) => setCreateDraft((d) => ({ ...d, existingEmail: e.target.value }))}
                                    placeholder={mc.lookupEmail}
                                    className="flex-1 rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={() => void handleLookup()}
                                    disabled={isLookingUp || !createDraft.existingEmail}
                                    className="rounded-md bg-gray-800 px-4 py-3 text-xs font-semibold text-white hover:bg-gray-700 disabled:opacity-50"
                                >
                                    {isLookingUp ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                                </button>
                            </div>
                            {lookupResult && (
                                <div className="rounded-md border border-success-light bg-success-light px-4 py-2 text-sm font-semibold text-success-text">
                                    {lookupResult.name || lookupResult.email}
                                </div>
                            )}
                            {lookupNotFound && (
                                <p className="text-xs font-semibold text-red-500">{mc.userNotFound}</p>
                            )}
                        </div>
                    )}
                </div>

                <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500">{mc.tenantSection}</p>
                    <input
                        value={createDraft.tenantName}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, tenantName: e.target.value }))}
                        placeholder={mc.tenantName}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <input
                        value={createDraft.storeName}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, storeName: e.target.value }))}
                        placeholder={mc.storeName}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <input
                        value={createDraft.address}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, address: e.target.value }))}
                        placeholder={mc.address}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                    />
                    <select
                        value={createDraft.businessType}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, businessType: e.target.value }))}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="">{mc.businessType}</option>
                        {BUSINESS_TYPE_VALUES.map((value) => (
                            <option key={value} value={value}>{BUSINESS_TYPE_LABELS[value]}</option>
                        ))}
                    </select>
                </div>

                <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500">{mc.plan}</p>
                    <select
                        value={createDraft.planCode}
                        onChange={(e) => setCreateDraft((d) => ({ ...d, planCode: e.target.value as PlanCode }))}
                        className="w-full rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                    >
                        <option value="FREE">Free</option>
                        <option value="BASIC">Basic</option>
                        <option value="ACCOUNTING">Accounting</option>
                        <option value="STANDARD">Standard</option>
                        <option value="PREMIUM">Premium</option>
                    </select>
                </div>

                <div className="space-y-3">
                    <p className="text-xs font-medium text-gray-500">{mc.discount}</p>
                    <div className="flex gap-2">
                        <select
                            value={createDraft.discountMode}
                            onChange={(e) => setCreateDraft((d) => ({ ...d, discountMode: e.target.value as CreateDraft['discountMode'] }))}
                            className="rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm font-medium outline-none"
                        >
                            <option value="NONE">{mc.discountNone}</option>
                            <option value="PERCENTAGE">{mc.discountPercent}</option>
                            <option value="FIXED">{mc.discountFixed}</option>
                        </select>
                        {createDraft.discountMode !== 'NONE' && (
                            <input
                                type="number"
                                min="0"
                                step="0.01"
                                value={createDraft.discountValue}
                                onChange={(e) => setCreateDraft((d) => ({ ...d, discountValue: e.target.value }))}
                                placeholder={createDraft.discountMode === 'PERCENTAGE' ? '%' : '৳'}
                                className="flex-1 rounded-md border border-gray-100 bg-gray-50 px-4 py-3 text-sm outline-none"
                            />
                        )}
                    </div>
                </div>
            </div>

            <ModalFooter>
                <button
                    type="button"
                    onClick={close}
                    disabled={isCreating}
                    className="rounded-md bg-gray-100 px-5 py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                >
                    {mc.cancel}
                </button>
                <button
                    type="button"
                    onClick={() => void handleCreate()}
                    disabled={isCreating}
                    className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-60"
                >
                    {isCreating
                        ? <><Loader2 className="w-4 h-4 animate-spin" /> {mc.creating}</>
                        : mc.create}
                </button>
            </ModalFooter>
        </ModalShell>
    );
}