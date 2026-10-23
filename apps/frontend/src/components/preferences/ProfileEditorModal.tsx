'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { Copy, Loader2, Trash2, Users } from 'lucide-react';
import {
    DEFAULT_ALERT_PREFS,
    DEFAULT_INVOICE_PRINT_PREFS,
    DEFAULT_TABLE_VIEW,
    TABLE_DENSITIES,
    TABLE_FONT_SIZES,
    type AlertPartial,
    type AlertPrefs,
    type DevicePrefs,
    type InvoicePrintPrefs,
    type PreferenceProfileDetail,
    type PreferenceProfileSummary,
    type PreferenceSectionKey,
    type TableViewSettings,
} from '@erp71/shared-types';
import InvoiceLayoutFields from '@/app/(app)/sales/components/InvoiceLayoutFields';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Segmented } from '@/components/table/TableViewOptions';
import { Alert, Button, Checkbox, ConfirmDialog, Field, Input, Select, StatusBadge } from '@/components/ui';
import { useAppShell } from '@/contexts/AppShellContext';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import type { PrintTypeScale } from '@/lib/print/type-scale';
import { PAPER_SIZES, paperSizeLabel, type PaperSize } from '@/lib/print/types';
import { toast } from '@/lib/toast';
import ApplyProfileModal from './ApplyProfileModal';
import { collectMySettings } from './copy-my-settings';

/** The order the editor and "Copy from my settings" show the sections in. */
export const EDITOR_SECTIONS: PreferenceSectionKey[] = [
    'invoicePrint',
    'device',
    'tableView',
    'tableColumns',
    'sidebar',
    'alerts',
];

/** The API answers a taken name with 409; the field says so rather than a toast. */
export function isNameTaken(error: unknown): boolean {
    return (error as { status?: unknown } | null)?.status === 409;
}

function errorMessage(error: unknown, fallback: string): string {
    const message = (error as { message?: unknown } | null)?.message;
    return typeof message === 'string' && message ? message : fallback;
}

/* --------------------------------- Forms ---------------------------------- */

/** The device card as controls. Booleans and "normal" are what a browser does unasked. */
interface DeviceForm {
    paperSize: PaperSize | '';
    compact: boolean;
    typeScale: PrintTypeScale;
    skipPreview: boolean;
    sidebarCollapsed: boolean;
}

function deviceForm(device: DevicePrefs | undefined): DeviceForm {
    return {
        paperSize: device?.paperSize ?? '',
        compact: device?.printDensity === 'compact',
        typeScale: device?.printTypeScale ?? 'normal',
        skipPreview: device?.skipPreview === true,
        sidebarCollapsed: device?.sidebarCollapsed === true,
    };
}

/**
 * Only the answers that differ from what a browser with nothing stored does
 * anyway. The device section is never filled with built-ins: an unset paper
 * size leaves the shop's own default in charge.
 */
function deviceFromForm(form: DeviceForm): DevicePrefs {
    const device: DevicePrefs = {};
    if (form.paperSize) device.paperSize = form.paperSize;
    if (form.compact) device.printDensity = 'compact';
    if (form.typeScale !== 'normal') device.printTypeScale = form.typeScale;
    if (form.skipPreview) device.skipPreview = true;
    if (form.sidebarCollapsed) device.sidebarCollapsed = true;
    return device;
}

function alertsForm(alerts: AlertPartial | undefined): AlertPrefs {
    return {
        mutedTypes: [...(alerts?.mutedTypes ?? DEFAULT_ALERT_PREFS.mutedTypes)],
        quiet: { ...DEFAULT_ALERT_PREFS.quiet, ...alerts?.quiet },
    };
}

function toClock(minutes: number): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function fromClock(clock: string): number | null {
    const match = /^(\d{2}):(\d{2})$/.exec(clock);
    if (!match) return null;
    const minutes = Number(match[1]) * 60 + Number(match[2]);
    return minutes >= 0 && minutes < 1440 ? minutes : null;
}

/** The sections the admin has changed and not saved yet. */
interface Drafts {
    invoicePrint?: InvoicePrintPrefs;
    device?: DeviceForm;
    tableView?: TableViewSettings;
    alerts?: AlertPrefs;
}

/* ------------------------------ Building blocks --------------------------- */

function CheckRow({
    label,
    hint,
    checked,
    disabled,
    onChange,
}: {
    label: string;
    hint?: string;
    checked: boolean;
    disabled?: boolean;
    onChange: (next: boolean) => void;
}) {
    return (
        <div>
            <label className="flex min-h-touch cursor-pointer items-center gap-2 sm:min-h-0">
                <Checkbox checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
                <span className="text-sm text-gray-700">{label}</span>
            </label>
            {hint ? <p className="ms-6 text-xs text-gray-400">{hint}</p> : null}
        </div>
    );
}

function SectionCard({
    title,
    hint,
    isSet,
    clearing,
    onClear,
    children,
}: {
    title: string;
    hint: string;
    isSet: boolean;
    clearing: boolean;
    onClear: () => void;
    children: ReactNode;
}) {
    const { t } = useI18n();
    const copy = t.teamManagement.profiles;
    const headingId = useId();
    return (
        <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-gray-200 p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <h3 id={headingId} className="text-sm font-semibold text-gray-800">
                        {title}
                    </h3>
                    <p className="text-xs text-gray-500">{hint}</p>
                </div>
                <div className="flex items-center gap-2">
                    <StatusBadge tone={isSet ? 'info' : 'neutral'}>{isSet ? copy.setByProfile : copy.notSet}</StatusBadge>
                    {isSet ? (
                        <Button variant="ghost" size="sm" loading={clearing} onClick={onClear}>
                            {copy.clear}
                        </Button>
                    ) : null}
                </div>
            </div>
            {children}
        </section>
    );
}

/** Which sections to replace with what the admin sees now. Nothing is chosen up front. */
function CopyMySettingsModal({
    busy,
    onCopy,
    onClose,
}: {
    busy: boolean;
    onCopy: (sections: PreferenceSectionKey[]) => void;
    onClose: () => void;
}) {
    const { t } = useI18n();
    const copy = t.teamManagement.profiles;
    const [chosen, setChosen] = useState<PreferenceSectionKey[]>([]);
    const toggle = (key: PreferenceSectionKey, on: boolean) =>
        setChosen((current) => (on ? [...current, key] : current.filter((k) => k !== key)));

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <ModalHeader title={copy.copyTitle} onClose={onClose} closeLabel={t.common.close} />
            <div className="space-y-3 overflow-y-auto p-4">
                <p className="text-sm text-gray-600">{copy.copyHint}</p>
                <div className="space-y-1">
                    {EDITOR_SECTIONS.map((key) => (
                        <CheckRow
                            key={key}
                            label={copy.sections[key]}
                            checked={chosen.includes(key)}
                            onChange={(on) => toggle(key, on)}
                        />
                    ))}
                </div>
            </div>
            <ModalFooter>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.cancel}
                </Button>
                <Button
                    loading={busy}
                    disabled={chosen.length === 0}
                    // Sent in the editor's order, whatever order they were ticked in.
                    onClick={() => onCopy(EDITOR_SECTIONS.filter((key) => chosen.includes(key)))}
                >
                    {copy.copy}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

/* --------------------------------- Editor --------------------------------- */

export interface ProfileEditorModalProps {
    profileId: string;
    /** Every profile in the workspace, so Apply can tell which roles have one of their own. */
    profiles: PreferenceProfileSummary[];
    /** Called after anything is saved, cleared, copied or deleted, so the list can refresh. */
    onChanged: () => void;
    onClose: () => void;
}

/**
 * One preference profile: its name, whether it is the workspace default, and a
 * card per section.
 *
 * The cards a person can set by hand (invoice print, the new-browser print
 * setup, the list look, alerts) are edited here and sent together on Save,
 * only the ones touched — a section the admin never opened stays unset, so
 * members keep the built-in value there. Saved columns and sidebar groups are
 * too fiddly to build by hand and are only ever copied from the admin's own
 * setup. Clear, Copy and Apply act at once, on the saved profile.
 */
export default function ProfileEditorModal({ profileId, profiles, onChanged, onClose }: ProfileEditorModalProps) {
    const { t, fmt } = useI18n();
    const copy = t.teamManagement.profiles;
    const print = t.sales.printSettings;
    const view = t.common.dataTable.view;
    const { enabled: appShell } = useAppShell();
    const ids = useId();

    const [profile, setProfile] = useState<PreferenceProfileDetail | null>(null);
    const [loadFailed, setLoadFailed] = useState(false);
    const [name, setName] = useState('');
    const [nameError, setNameError] = useState<string | null>(null);
    const [isDefault, setIsDefault] = useState(false);
    const [drafts, setDrafts] = useState<Drafts>({});
    const [invoiceValid, setInvoiceValid] = useState(true);
    // Remounts the invoice fields when the profile is replaced under them; they
    // hold the footer and signature gap as typed.
    const [formKey, setFormKey] = useState(0);
    const [alertTypes, setAlertTypes] = useState<{ type: string; label: string; description: string }[] | null>(null);
    const [alertTypesFailed, setAlertTypesFailed] = useState(false);
    const [saving, setSaving] = useState(false);
    const [clearing, setClearing] = useState<PreferenceSectionKey | null>(null);
    const [copyOpen, setCopyOpen] = useState(false);
    const [copying, setCopying] = useState(false);
    const [applyOpen, setApplyOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [deleting, setDeleting] = useState(false);

    useEffect(() => {
        let cancelled = false;
        api.getPreferenceProfile(profileId)
            .then((loaded) => {
                if (cancelled) return;
                setProfile(loaded);
                setName(loaded.name);
                setIsDefault(loaded.is_default);
            })
            .catch(() => {
                if (!cancelled) setLoadFailed(true);
            });
        api.getAlertPreferences()
            .then((answer) => {
                if (!cancelled) setAlertTypes(answer?.types ?? []);
            })
            .catch(() => {
                if (!cancelled) setAlertTypesFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [profileId]);

    /** Takes the server's copy; unsaved edits to the sections it just rewrote are dropped. */
    const replaceProfile = (next: PreferenceProfileDetail, rewritten: PreferenceSectionKey[]) => {
        setProfile(next);
        setDrafts((current) => {
            const kept: Drafts = { ...current };
            for (const key of rewritten) delete (kept as Record<string, unknown>)[key];
            return kept;
        });
        if (rewritten.includes('invoicePrint')) setFormKey((key) => key + 1);
    };

    const setDraft = <K extends keyof Drafts>(key: K, value: Drafts[K]) =>
        setDrafts((current) => ({ ...current, [key]: value }));

    if (!profile) {
        return (
            <ModalShell size="lg" onBackdropClick={onClose}>
                <ModalHeader title={copy.editTitle} onClose={onClose} closeLabel={t.common.close} />
                <div className="p-4">
                    {loadFailed ? (
                        <Alert tone="danger">{copy.loadOneFailed}</Alert>
                    ) : (
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                            <Loader2 className="h-4 w-4 animate-spin" /> {t.teamManagement.loading}
                        </div>
                    )}
                </div>
            </ModalShell>
        );
    }

    const sections = profile.sections;
    const invoiceValue = drafts.invoicePrint ?? { ...DEFAULT_INVOICE_PRINT_PREFS, ...sections.invoicePrint };
    const deviceValue = drafts.device ?? deviceForm(sections.device);
    const listValue = drafts.tableView ?? { ...DEFAULT_TABLE_VIEW, ...sections.tableView?.global };
    const alertsValue = drafts.alerts ?? alertsForm(sections.alerts);
    const columnLists = Object.keys(sections.tableColumns ?? {}).length;
    const sidebarGroups = sections.sidebar?.appShellOpenGroups?.length ?? 0;

    const trimmedName = name.trim();
    const dirty =
        trimmedName !== profile.name || isDefault !== profile.is_default || Object.keys(drafts).length > 0;
    const isSet = (key: PreferenceSectionKey) => Object.keys(sections[key] ?? {}).length > 0;

    const save = async () => {
        if (!trimmedName) {
            setNameError(copy.nameRequired);
            return;
        }
        const body: { name?: string; is_default?: boolean; sections?: Record<string, unknown | null> } = {};
        if (trimmedName !== profile.name) body.name = trimmedName;
        if (isDefault !== profile.is_default) body.is_default = isDefault;
        const changed: Record<string, unknown | null> = {};
        // The whole layout the form shows, so the profile never holds half of one.
        if (drafts.invoicePrint) changed.invoicePrint = drafts.invoicePrint;
        if (drafts.device) {
            const device = deviceFromForm(drafts.device);
            changed.device = Object.keys(device).length > 0 ? device : null;
        }
        if (drafts.tableView) {
            // A section is replaced whole: keep the per-list looks a copy brought in.
            const tables = sections.tableView?.tables;
            changed.tableView = tables ? { global: drafts.tableView, tables } : { global: drafts.tableView };
        }
        if (drafts.alerts) changed.alerts = drafts.alerts;
        if (Object.keys(changed).length > 0) body.sections = changed;

        setSaving(true);
        try {
            const next = await api.updatePreferenceProfile(profile.id, body);
            replaceProfile(next, EDITOR_SECTIONS);
            setName(next.name);
            setIsDefault(next.is_default);
            setNameError(null);
            toast.success(copy.saved);
            onChanged();
        } catch (error) {
            if (isNameTaken(error)) setNameError(copy.nameTaken);
            else toast.error(errorMessage(error, copy.saveFailed));
        } finally {
            setSaving(false);
        }
    };

    const clearSection = async (key: PreferenceSectionKey) => {
        setClearing(key);
        try {
            const next = await api.updatePreferenceProfile(profile.id, { sections: { [key]: null } });
            replaceProfile(next, [key]);
            toast.success(copy.cleared);
            onChanged();
        } catch (error) {
            toast.error(errorMessage(error, copy.saveFailed));
        } finally {
            setClearing(null);
        }
    };

    const copyMine = async (keys: PreferenceSectionKey[]) => {
        setCopying(true);
        try {
            const mine = await collectMySettings(keys, { appShell });
            const next = await api.updatePreferenceProfile(profile.id, { sections: mine as Record<string, unknown> });
            replaceProfile(next, keys);
            setCopyOpen(false);
            toast.success(copy.copied);
            onChanged();
        } catch (error) {
            toast.error(errorMessage(error, copy.copyFailed));
        } finally {
            setCopying(false);
        }
    };

    const remove = async () => {
        setDeleting(true);
        try {
            await api.deletePreferenceProfile(profile.id);
            toast.success(copy.deleted);
            onChanged();
            onClose();
        } catch (error) {
            toast.error(errorMessage(error, copy.deleteFailed));
            setDeleting(false);
            setDeleteOpen(false);
        }
    };

    const card = (key: PreferenceSectionKey, children: ReactNode) => (
        <SectionCard
            title={copy.sections[key]}
            hint={copy.hints[key]}
            isSet={isSet(key)}
            clearing={clearing === key}
            onClear={() => void clearSection(key)}
        >
            {children}
        </SectionCard>
    );

    const roleNames = profile.roles.map((role) => role.name).join(copy.listSeparator);

    return (
        <ModalShell size="lg" onBackdropClick={onClose} dismissOnBackdrop={false}>
            <ModalHeader title={copy.editTitle} subtitle={profile.name} onClose={onClose} closeLabel={t.common.close} />

            <div className="space-y-4 overflow-y-auto p-4">
                <div className="space-y-3">
                    <Field label={copy.nameLabel} htmlFor={`${ids}-name`} error={nameError ?? undefined}>
                        <Input
                            id={`${ids}-name`}
                            value={name}
                            maxLength={60}
                            placeholder={copy.namePlaceholder}
                            aria-invalid={nameError ? true : undefined}
                            error={Boolean(nameError)}
                            className="w-full"
                            onChange={(event) => {
                                setName(event.target.value);
                                setNameError(null);
                            }}
                        />
                    </Field>
                    <CheckRow label={copy.defaultLabel} hint={copy.defaultHint} checked={isDefault} onChange={setIsDefault} />
                    <p className="text-xs text-gray-500">
                        {roleNames ? fmt(copy.roles, { roles: roleNames }) : copy.noRoles} {copy.rolesHint}
                    </p>
                </div>

                <div className="space-y-1">
                    <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => setCopyOpen(true)}>
                            {copy.copyFromMine}
                        </Button>
                        <Button
                            variant="secondary"
                            icon={<Users className="h-4 w-4" />}
                            disabled={dirty}
                            onClick={() => setApplyOpen(true)}
                        >
                            {copy.applyToMembers}
                        </Button>
                    </div>
                    {dirty ? <p className="text-xs text-amber-700">{copy.applyNeedsSave}</p> : null}
                </div>

                {card(
                    'invoicePrint',
                    <InvoiceLayoutFields
                        key={formKey}
                        value={invoiceValue}
                        onChange={(next) => setDraft('invoicePrint', next)}
                        onValidityChange={setInvoiceValid}
                    />,
                )}

                {card(
                    'device',
                    <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label={print.paperSizeLabel} htmlFor={`${ids}-paper`}>
                                <Select
                                    id={`${ids}-paper`}
                                    value={deviceValue.paperSize}
                                    className="w-full"
                                    onChange={(event) =>
                                        setDraft('device', { ...deviceValue, paperSize: event.target.value as PaperSize | '' })
                                    }
                                >
                                    <option value="">{copy.paperNotSet}</option>
                                    {PAPER_SIZES.map((size) => (
                                        <option key={size} value={size}>
                                            {paperSizeLabel(size)}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <Field label={t.components.printWindow.typeSize} htmlFor={`${ids}-type`}>
                                <Select
                                    id={`${ids}-type`}
                                    value={deviceValue.typeScale}
                                    className="w-full"
                                    onChange={(event) =>
                                        setDraft('device', { ...deviceValue, typeScale: event.target.value as PrintTypeScale })
                                    }
                                >
                                    <option value="normal">{t.components.printWindow.typeNormal}</option>
                                    <option value="large">{t.components.printWindow.typeLarge}</option>
                                    <option value="larger">{t.components.printWindow.typeLarger}</option>
                                </Select>
                            </Field>
                        </div>
                        <CheckRow
                            label={print.compactLabel}
                            checked={deviceValue.compact}
                            onChange={(compact) => setDraft('device', { ...deviceValue, compact })}
                        />
                        <CheckRow
                            label={print.skipPreviewLabel}
                            checked={deviceValue.skipPreview}
                            onChange={(skipPreview) => setDraft('device', { ...deviceValue, skipPreview })}
                        />
                        <CheckRow
                            label={copy.sidebarCollapsed}
                            checked={deviceValue.sidebarCollapsed}
                            onChange={(sidebarCollapsed) => setDraft('device', { ...deviceValue, sidebarCollapsed })}
                        />
                    </div>,
                )}

                {card(
                    'tableView',
                    <div className="space-y-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Segmented
                                label={view.density}
                                options={TABLE_DENSITIES.map((key) => ({ key, label: view.densities[key] }))}
                                value={listValue.density}
                                onChange={(density) => setDraft('tableView', { ...listValue, density })}
                            />
                            <Segmented
                                label={view.fontSize}
                                options={TABLE_FONT_SIZES.map((key) => ({
                                    key,
                                    label: view.fontSizes[key],
                                    title: view.fontSizeTitles[key],
                                }))}
                                value={listValue.fontSize}
                                onChange={(fontSize) => setDraft('tableView', { ...listValue, fontSize })}
                            />
                        </div>
                        <CheckRow
                            label={view.striped}
                            checked={listValue.striped}
                            onChange={(striped) => setDraft('tableView', { ...listValue, striped })}
                        />
                        <CheckRow
                            label={view.fitWidth}
                            hint={view.fitWidthHint}
                            checked={listValue.fitWidth}
                            onChange={(fitWidth) => setDraft('tableView', { ...listValue, fitWidth })}
                        />
                    </div>,
                )}

                {card(
                    'tableColumns',
                    <p className={columnLists > 0 ? 'text-sm text-gray-700' : 'text-xs text-gray-500'}>
                        {columnLists > 0 ? fmt(copy.columnsSet, { count: columnLists }) : copy.setWithCopy}
                    </p>,
                )}

                {card(
                    'sidebar',
                    <p className={sidebarGroups > 0 ? 'text-sm text-gray-700' : 'text-xs text-gray-500'}>
                        {sidebarGroups > 0 ? fmt(copy.sidebarSet, { count: sidebarGroups }) : copy.setWithCopy}
                    </p>,
                )}

                {card(
                    'alerts',
                    <div className="space-y-3">
                        {alertTypesFailed ? (
                            <Alert tone="warning">{copy.alertTypesFailed}</Alert>
                        ) : alertTypes === null ? (
                            <div className="flex items-center gap-2 text-xs text-gray-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t.teamManagement.loading}
                            </div>
                        ) : (
                            <fieldset className="space-y-1">
                                <legend className="text-xs font-medium text-gray-600">{copy.mutedLabel}</legend>
                                <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                                    {alertTypes.map((type) => (
                                        <CheckRow
                                            key={type.type}
                                            label={type.label}
                                            hint={type.description}
                                            checked={alertsValue.mutedTypes.includes(type.type)}
                                            onChange={(muted) =>
                                                setDraft('alerts', {
                                                    ...alertsValue,
                                                    mutedTypes: muted
                                                        ? [...alertsValue.mutedTypes, type.type]
                                                        : alertsValue.mutedTypes.filter((code) => code !== type.type),
                                                })
                                            }
                                        />
                                    ))}
                                </div>
                            </fieldset>
                        )}
                        <CheckRow
                            label={copy.quietHours}
                            hint={copy.quietHint}
                            checked={alertsValue.quiet.enabled}
                            onChange={(enabled) =>
                                setDraft('alerts', { ...alertsValue, quiet: { ...alertsValue.quiet, enabled } })
                            }
                        />
                        <div className="grid grid-cols-2 gap-3 sm:max-w-xs">
                            {(['from', 'to'] as const).map((edge) => (
                                <Field
                                    key={edge}
                                    label={edge === 'from' ? copy.quietFrom : copy.quietTo}
                                    htmlFor={`${ids}-quiet-${edge}`}
                                >
                                    <Input
                                        id={`${ids}-quiet-${edge}`}
                                        type="time"
                                        className="w-full"
                                        value={toClock(alertsValue.quiet[edge])}
                                        disabled={!alertsValue.quiet.enabled}
                                        onChange={(event) => {
                                            const minutes = fromClock(event.target.value);
                                            if (minutes === null) return;
                                            setDraft('alerts', {
                                                ...alertsValue,
                                                quiet: { ...alertsValue.quiet, [edge]: minutes },
                                            });
                                        }}
                                    />
                                </Field>
                            ))}
                        </div>
                    </div>,
                )}
            </div>

            <ModalFooter className="flex-wrap">
                <div className="me-auto">
                    <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDeleteOpen(true)}>
                        {copy.deleteProfile}
                    </Button>
                </div>
                <Button variant="secondary" onClick={onClose}>
                    {t.common.close}
                </Button>
                <Button loading={saving} disabled={!dirty || !invoiceValid} onClick={() => void save()}>
                    {copy.saveChanges}
                </Button>
            </ModalFooter>

            {copyOpen ? (
                <CopyMySettingsModal busy={copying} onCopy={(keys) => void copyMine(keys)} onClose={() => setCopyOpen(false)} />
            ) : null}
            {applyOpen ? (
                <ApplyProfileModal profile={profile} profiles={profiles} onClose={() => setApplyOpen(false)} />
            ) : null}
            <ConfirmDialog
                open={deleteOpen}
                danger
                title={copy.deleteTitle}
                prompt={fmt(copy.deletePrompt, { name: profile.name })}
                confirmLabel={t.common.delete}
                cancelLabel={t.common.cancel}
                loading={deleting}
                onConfirm={() => void remove()}
                onCancel={() => setDeleteOpen(false)}
            />
        </ModalShell>
    );
}
