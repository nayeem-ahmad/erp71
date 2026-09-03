'use client';

import { Download, Loader2, RotateCcw } from 'lucide-react';
import {
    BUSINESS_TYPE_LABELS,
    BUSINESS_TYPE_VALUES,
    BUSINESS_TYPES_WITH_TEMPLATE,
    TENANT_OVERRIDABLE_FEATURE_KEYS,
} from '@erp71/shared-types';
import CompactSection from '@/components/ui/compact/CompactSection';
import { Button, Field, Select, Checkbox } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import type { AdminTenantFeatures } from '@/lib/api';
import type { SecondaryLocale, TenantRecord } from '../types';
import type { FeatureChoice, FeatureDraft, LocalizationDraft, TenantNavKind } from '../use-tenant-detail';

function FeatureChoiceGroup({
    value,
    labels,
    onChange,
}: {
    value: FeatureChoice;
    labels: Record<FeatureChoice, string>;
    onChange: (next: FeatureChoice) => void;
}) {
    return (
        <div className="inline-flex flex-shrink-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {(['inherit', 'on', 'off'] as const).map((choice) => (
                <button
                    key={choice}
                    type="button"
                    aria-pressed={value === choice}
                    onClick={() => onChange(choice)}
                    className={`min-h-touch px-3 py-1.5 text-xs font-semibold transition-colors ${
                        value === choice ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                >
                    {labels[choice]}
                </button>
            ))}
        </div>
    );
}

type Props = {
    tenant: TenantRecord;
    features: AdminTenantFeatures | null;
    featureDraft: FeatureDraft;
    onFeatureDraftChange: (next: FeatureDraft) => void;
    localization: LocalizationDraft;
    onLocalizationChange: (next: LocalizationDraft) => void;
    businessType: string;
    onBusinessTypeChange: (next: string) => void;
    isImportingCatalog: boolean;
    onImportCatalog: () => void;
    navKind: TenantNavKind;
    isResettingNav: boolean;
    onResetNav: () => void;
};

export default function ConfigurationPanel({
    tenant,
    features,
    featureDraft,
    onFeatureDraftChange,
    localization,
    onLocalizationChange,
    businessType,
    onBusinessTypeChange,
    isImportingCatalog,
    onImportCatalog,
    navKind,
    isResettingNav,
    onResetNav,
}: Props) {
    const { t } = useI18n();
    const m = t.admin.tenants;
    const fc = m.featureControls;
    const lc = m.localizationControls;
    const nc = m.navLayoutControls;
    const bt = m.businessTypeControls;
    const featureLabels = t.admin.platformSettings.tenantFeatures;

    const hasTemplate = Boolean(tenant.business_type)
        && BUSINESS_TYPES_WITH_TEMPLATE.includes(tenant.business_type as never);

    return (
        <div className="space-y-4">
            <CompactSection>
                <p className="text-sm font-semibold text-gray-900">{fc.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{fc.description}</p>

                <div className="mt-3 space-y-2">
                    {TENANT_OVERRIDABLE_FEATURE_KEYS.map((key) => {
                        const choice = featureDraft[key];
                        const inheritedOn = features?.platform_defaults?.[key] ?? false;
                        return (
                            <div
                                key={key}
                                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 px-3 py-2"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-gray-800">{featureLabels[key].label}</p>
                                    <p className="mt-0.5 text-xs text-gray-500">
                                        {choice === 'inherit'
                                            ? (inheritedOn ? fc.inheritingOn : fc.inheritingOff)
                                            : fc.overriddenNote}
                                    </p>
                                </div>
                                <FeatureChoiceGroup
                                    value={choice}
                                    labels={{ inherit: fc.inherit, on: fc.on, off: fc.off }}
                                    onChange={(next) => onFeatureDraftChange({ ...featureDraft, [key]: next })}
                                />
                            </div>
                        );
                    })}
                </div>
                <p className="mt-2 text-xs text-gray-500">{fc.planNote}</p>
            </CompactSection>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <CompactSection>
                    <p className="text-sm font-semibold text-gray-900">{bt.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{bt.description}</p>

                    <div className="mt-3">
                        <Field label={bt.typeLabel}>
                            <Select
                                value={businessType}
                                onChange={(event) => onBusinessTypeChange(event.target.value)}
                                aria-label={bt.typeLabel}
                            >
                                <option value="">{bt.typePlaceholder}</option>
                                {BUSINESS_TYPE_VALUES.map((value) => (
                                    <option key={value} value={value}>{BUSINESS_TYPE_LABELS[value]}</option>
                                ))}
                            </Select>
                        </Field>
                    </div>

                    <div className="mt-3">
                        <Button
                            variant="secondary"
                            onClick={onImportCatalog}
                            disabled={isImportingCatalog || !hasTemplate}
                            loading={isImportingCatalog}
                            icon={<Download className="w-4 h-4" />}
                        >
                            {bt.import}
                        </Button>
                    </div>

                    {!tenant.business_type ? (
                        <p className="mt-2 text-xs text-gray-500">{bt.noTypeSet}</p>
                    ) : !hasTemplate ? (
                        <p className="mt-2 text-xs text-gray-500">{bt.noTemplate}</p>
                    ) : null}
                </CompactSection>

                <CompactSection>
                    <p className="text-sm font-semibold text-gray-900">{lc.title}</p>
                    <p className="mt-0.5 text-xs text-gray-500">{lc.description}</p>

                    <label className="mt-3 flex items-center gap-2 text-sm text-gray-700 max-md:min-h-touch">
                        <Checkbox
                            checked={localization.localization_enabled}
                            onChange={(event) => onLocalizationChange({
                                localization_enabled: event.target.checked,
                                secondary_locale: event.target.checked ? localization.secondary_locale : '',
                            })}
                        />
                        {lc.enabledLabel}
                    </label>

                    {localization.localization_enabled ? (
                        <div className="mt-3">
                            <Field label={lc.secondaryLabel}>
                                <Select
                                    value={localization.secondary_locale}
                                    onChange={(event) => onLocalizationChange({
                                        ...localization,
                                        secondary_locale: event.target.value as SecondaryLocale | '',
                                    })}
                                    aria-label={lc.secondaryLabel}
                                >
                                    <option value="">{lc.secondaryPlaceholder}</option>
                                    <option value="bn">বাংলা (Bangla)</option>
                                    <option value="ms">Bahasa Melayu (Malay)</option>
                                </Select>
                            </Field>
                        </div>
                    ) : (
                        <p className="mt-2 text-xs text-gray-500">{lc.englishOnly}</p>
                    )}
                </CompactSection>
            </div>

            <CompactSection>
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-900">{nc.title}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {navKind === 'custom'
                                ? nc.status.custom
                                : navKind === 'pinned_default'
                                    ? nc.status.pinned
                                    : nc.status.inherit}
                        </p>
                    </div>
                    <Button
                        variant="secondary"
                        onClick={onResetNav}
                        disabled={isResettingNav}
                        icon={isResettingNav
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <RotateCcw className="w-4 h-4" />}
                    >
                        {nc.reset}
                    </Button>
                </div>
            </CompactSection>
        </div>
    );
}
