'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PLATFORM_FEATURE_KEYS, type PlatformFeatureKey } from '@erp71/shared-types';
import { api, type AdminTenantFeatures, type AdminTenantAddonSubscription } from '@/lib/api';
import type { DiscountType, PlanCode, SecondaryLocale, TenantRecord } from './types';

export type DemoBatch = {
    status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
    phase?: string | null;
    processed: number;
    total: number;
    batch_number: number;
    error?: string | null;
};

/** Tri-state per feature: follow the platform default, or pin it on/off for this tenant. */
export type FeatureChoice = 'inherit' | 'on' | 'off';

export type FeatureDraft = Record<PlatformFeatureKey, FeatureChoice>;

export type AddonCatalogEntry = { id: string; code: string; name: string; is_active: boolean };

export type SubscriptionDraft = {
    planCode: PlanCode;
    status: NonNullable<TenantRecord['subscription']>['status'];
    cancelAtPeriodEnd: boolean;
    discountMode: 'NONE' | DiscountType;
    discountValue: string;
};

export type LocalizationDraft = {
    localization_enabled: boolean;
    secondary_locale: SecondaryLocale | '';
};

export type TenantNavKind = 'none' | 'custom' | 'pinned_default';

export function toFeatureDraft(features: AdminTenantFeatures | null): FeatureDraft {
    const draft = {} as FeatureDraft;
    for (const key of PLATFORM_FEATURE_KEYS) {
        const override = features?.overrides?.[key];
        draft[key] = override === undefined ? 'inherit' : override ? 'on' : 'off';
    }
    return draft;
}

function subscriptionBaseline(tenant: TenantRecord | null): SubscriptionDraft {
    if (!tenant?.subscription) {
        return {
            planCode: 'FREE',
            status: 'ACTIVE',
            cancelAtPeriodEnd: false,
            discountMode: 'NONE',
            discountValue: '',
        };
    }
    return {
        planCode: tenant.subscription.plan.code,
        status: tenant.subscription.status,
        cancelAtPeriodEnd: tenant.subscription.cancel_at_period_end,
        discountMode: (tenant.subscription.discount_type ?? 'NONE') as 'NONE' | DiscountType,
        discountValue: tenant.subscription.discount_value != null
            ? String(tenant.subscription.discount_value)
            : '',
    };
}

function localizationBaseline(tenant: TenantRecord | null): LocalizationDraft {
    return {
        localization_enabled: Boolean(tenant?.localization_enabled),
        secondary_locale: (tenant?.secondary_locale || '') as SecondaryLocale | '',
    };
}

/**
 * Everything the tenant detail page needs, in one place.
 *
 * The panels are presentational: they read drafts and call setters, and the
 * page saves. Holding the drafts and their server baselines together here is
 * what makes a single "N unsaved changes" bar possible — the old modal had a
 * save button per section and no idea a section had been edited, so editing
 * two sections and saving one silently dropped the other.
 */
export function useTenantDetail(tenantId: string) {
    const [tenant, setTenant] = useState<TenantRecord | null>(null);
    const [features, setFeatures] = useState<AdminTenantFeatures | null>(null);
    const [addons, setAddons] = useState<AdminTenantAddonSubscription[]>([]);
    const [addonCatalog, setAddonCatalog] = useState<AddonCatalogEntry[]>([]);
    const [navKind, setNavKind] = useState<TenantNavKind>('none');
    const [demoBatch, setDemoBatch] = useState<DemoBatch | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const subscriptionBase = useMemo(() => subscriptionBaseline(tenant), [tenant]);
    const localizationBase = useMemo(() => localizationBaseline(tenant), [tenant]);
    const featureBase = useMemo(() => toFeatureDraft(features), [features]);
    const businessTypeBase = tenant?.business_type ?? '';

    // Drafts are OVERRIDES on top of the server state, not copies of it. A copy
    // has to be re-synced by an effect after every load and save, and for the
    // render in between, the "unsaved changes" bar sees the stale copy and
    // flashes. `null` here means "unedited — follow the server".
    const [subscriptionEdit, setSubscriptionEdit] = useState<SubscriptionDraft | null>(null);
    const [localizationEdit, setLocalizationEdit] = useState<LocalizationDraft | null>(null);
    const [featureEdit, setFeatureEdit] = useState<FeatureDraft | null>(null);
    const [businessTypeEdit, setBusinessTypeEdit] = useState<string | null>(null);

    const demoPollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const load = useCallback(async (id: string, opts?: { quiet?: boolean }) => {
        if (!opts?.quiet) setLoading(true);
        setError('');
        try {
            const [detail, navOverride, tenantFeatures, tenantAddons] = await Promise.all([
                api.getAdminTenant(id),
                api.getAdminTenantNavOverride(id).catch(() => null),
                api.getAdminTenantFeatures(id).catch(() => null),
                api.getAdminTenantAddons(id).catch(() => []),
            ]);
            setTenant(detail);
            setNavKind(navOverride?.kind ?? 'none');
            setFeatures(tenantFeatures);
            setAddons(tenantAddons);
            return detail as TenantRecord;
        } catch (err: unknown) {
            setError(err instanceof Error ? err.message : 'Failed to load tenant detail.');
            setTenant(null);
            return null;
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!tenantId) return;
        void load(tenantId);
    }, [tenantId, load]);

    // The add-on catalog is tenant-independent — load it once.
    useEffect(() => {
        api.getAdminAddonModules()
            .then((rows: AddonCatalogEntry[]) => setAddonCatalog(rows.filter((row) => row.is_active)))
            .catch(() => setAddonCatalog([]));
    }, []);

    const pollDemoStatus = useCallback(async (
        id: string,
        onDone?: (batch: DemoBatch) => void,
    ) => {
        let batch: DemoBatch | null = null;
        try {
            batch = await api.getAdminTenantDemoDataStatus(id) as DemoBatch;
        } catch {
            batch = null;
        }
        setDemoBatch(batch);
        if (batch && (batch.status === 'RUNNING' || batch.status === 'PENDING')) {
            demoPollTimer.current = setTimeout(() => void pollDemoStatus(id, onDone), 2000);
        } else if (batch) {
            onDone?.(batch);
        }
    }, []);

    useEffect(() => () => {
        if (demoPollTimer.current) clearTimeout(demoPollTimer.current);
        demoPollTimer.current = null;
    }, []);

    const subscription = subscriptionEdit ?? subscriptionBase;
    const localization = localizationEdit ?? localizationBase;
    const featureDraft = featureEdit ?? featureBase;
    const businessType = businessTypeEdit ?? businessTypeBase;

    const subscriptionDirty = subscriptionEdit !== null
        && (Object.keys(subscriptionBase) as Array<keyof SubscriptionDraft>)
            .some((key) => subscriptionEdit[key] !== subscriptionBase[key]);

    const localizationDirty = localizationEdit !== null
        && (localizationEdit.localization_enabled !== localizationBase.localization_enabled
            || localizationEdit.secondary_locale !== localizationBase.secondary_locale);

    const featuresDirty = featureEdit !== null
        && PLATFORM_FEATURE_KEYS.some((key) => featureEdit[key] !== featureBase[key]);

    // An empty business type is the "not set yet" placeholder, never something
    // to save over a real one.
    const businessTypeDirty = businessTypeEdit !== null
        && businessTypeEdit !== ''
        && businessTypeEdit !== businessTypeBase;

    const dirtyCount = [subscriptionDirty, localizationDirty, featuresDirty, businessTypeDirty]
        .filter(Boolean).length;

    /** Drop every local edit; the drafts fall back to the server state. */
    const resetDrafts = useCallback(() => {
        setSubscriptionEdit(null);
        setLocalizationEdit(null);
        setFeatureEdit(null);
        setBusinessTypeEdit(null);
    }, []);

    return {
        tenant,
        features,
        addons,
        addonCatalog,
        navKind,
        demoBatch,
        loading,
        error,
        setError,
        setNavKind,
        setAddons,
        setFeatures,
        setDemoBatch,
        load,
        pollDemoStatus,
        subscription,
        setSubscription: setSubscriptionEdit,
        localization,
        setLocalization: setLocalizationEdit,
        featureDraft,
        setFeatureDraft: setFeatureEdit,
        businessType,
        setBusinessType: setBusinessTypeEdit,
        subscriptionDirty,
        localizationDirty,
        featuresDirty,
        businessTypeDirty,
        dirtyCount,
        resetDrafts,
    };
}
