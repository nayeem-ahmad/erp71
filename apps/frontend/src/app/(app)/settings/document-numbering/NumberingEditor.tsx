'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    NUMBERING_DOC_TYPE_INFO,
    NUMBERING_NEXT_NUMBER_MAX,
    NUMBERING_RESET_LABELS,
    NUMBERING_RESET_POLICIES,
    NUMBERING_SCOPE_LABELS,
    NUMBERING_SEQ_WIDTH_MAX,
    NUMBERING_SEQ_WIDTH_MIN,
    NUMBERING_TEMPLATE_MAX_LENGTH,
    NUMBERING_TOKEN_LABELS,
    documentNumberingPresets,
    normalizeStoreCode,
    numberingScopesFor,
    numberingTokensFor,
    templateUsesToken,
    validateNumberingConfig,
    type DocumentNumberingConfig,
    type NumberingDocType,
    type NumberingResetPolicy,
    type NumberingScope,
} from '@erp71/shared-types';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Alert, Button, CompactSection, Field, Input, SkeletonBar, Select } from '@/components/ui';
import {
    counterRowsFor,
    periodLabel,
    previewNumber,
    storeCodeErrors,
    type DocumentNumberingData,
} from './numbering-rows';

const CUSTOM = 'custom';

const sameConfig = (a: DocumentNumberingConfig, b: DocumentNumberingConfig) =>
    a.template.trim() === b.template.trim()
    && a.resetPolicy === b.resetPolicy
    && a.scope === b.scope
    && a.seqWidth === b.seqWidth;

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * The format, branch codes and next numbers of one document type. Each tab of
 * the page holds one, kept mounted once opened so switching tabs does not throw
 * away what was typed; each saves only its own type.
 */
export default function NumberingEditor({ docType }: { docType: NumberingDocType }) {
    const info = NUMBERING_DOC_TYPE_INFO[docType];
    const presets = useMemo(() => documentNumberingPresets(docType), [docType]);
    const id = (name: string) => `${docType.toLowerCase()}-${name}`;

    const [data, setData] = useState<DocumentNumberingData | null>(null);
    const [loadError, setLoadError] = useState('');
    const [saving, setSaving] = useState(false);

    const [config, setConfig] = useState<DocumentNumberingConfig | null>(null);
    /** Branch codes as typed, keyed by store id. */
    const [codes, setCodes] = useState<Record<string, string>>({});
    /** "Next number" as typed, keyed by scope key; absent means unchanged. */
    const [nextNumbers, setNextNumbers] = useState<Record<string, string>>({});
    const [submitted, setSubmitted] = useState(false);
    const templateRef = useRef<HTMLInputElement>(null);

    const adopt = useCallback((next: DocumentNumberingData) => {
        setData(next);
        setConfig(next.config);
        setCodes(Object.fromEntries(next.stores.map((s) => [s.id, s.code ?? ''])));
        setNextNumbers({});
        setSubmitted(false);
    }, []);

    useEffect(() => {
        api.getDocumentNumbering(docType)
            .then(adopt)
            .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Could not load document numbering.'));
    }, [adopt, docType]);

    const formatErrors = useMemo(() => (config ? validateNumberingConfig(config, docType) : []), [config, docType]);
    const usesStore = config ? templateUsesToken(config.template, 'STORE') : false;
    const codeErrors = useMemo(
        () => (data && usesStore ? storeCodeErrors(data.stores, codes) : {}),
        [data, usesStore, codes],
    );
    const rows = useMemo(() => (config && data ? counterRowsFor(config, data) : []), [config, data]);

    const nextNumberError = (scopeKey: string, currentNext: number): string => {
        const raw = nextNumbers[scopeKey];
        if (raw === undefined) return '';
        const value = Number(raw);
        if (!raw.trim() || !Number.isInteger(value) || value < 1) return 'Enter a whole number.';
        if (value > NUMBERING_NEXT_NUMBER_MAX) return 'That number is too large.';
        if (value < currentNext) return `Cannot go below ${currentNext} — lower numbers may already be printed.`;
        return '';
    };

    /** The number a counter would issue next: what was typed, once it is a valid one. */
    const seqFor = (scopeKey: string, currentNext: number): number => {
        const typed = nextNumbers[scopeKey];
        return typed !== undefined && !nextNumberError(scopeKey, currentNext) ? Number(typed) : currentNext;
    };

    if (loadError) {
        return <Alert tone="danger">{loadError}</Alert>;
    }

    if (!data || !config) {
        return (
            <div className="space-y-3" aria-busy="true">
                <SkeletonBar className="h-40 w-full" />
                <SkeletonBar className="h-24 w-full" />
            </div>
        );
    }

    const preset = presets.find((p) => sameConfig(p.config, config))?.key ?? CUSTOM;
    // A branch with no code yet gets the next S<n> on save; the preview says so.
    const codeFor = (storeId: string) =>
        normalizeStoreCode(codes[storeId]) ?? data.stores.find((s) => s.id === storeId)?.code ?? 'S?';
    const seriesChanged = config.resetPolicy !== data.config.resetPolicy || config.scope !== data.config.scope;

    const update = (patch: Partial<DocumentNumberingConfig>) => setConfig({ ...config, ...patch });

    const insertToken = (token: string) => {
        const input = templateRef.current;
        const text = `{${token}}`;
        const start = input?.selectionStart ?? config.template.length;
        const end = input?.selectionEnd ?? config.template.length;
        update({ template: config.template.slice(0, start) + text + config.template.slice(end) });
        requestAnimationFrame(() => {
            input?.focus();
            input?.setSelectionRange(start + text.length, start + text.length);
        });
    };

    const handleSave = async () => {
        setSubmitted(true);
        const rowErrors = rows.some((row) => nextNumberError(row.scopeKey, row.currentNext));
        if (formatErrors.length > 0 || Object.keys(codeErrors).length > 0 || rowErrors) return;

        const storeCodes = usesStore
            ? data.stores
                .map((s) => ({ storeId: s.id, code: normalizeStoreCode(codes[s.id]) ?? '' }))
                .filter((c) => c.code !== (data.stores.find((s) => s.id === c.storeId)?.code ?? ''))
            : [];
        const changedNumbers = rows
            .filter((row) => nextNumbers[row.scopeKey] !== undefined && Number(nextNumbers[row.scopeKey]) !== row.currentNext)
            .map((row) => ({ scopeKey: row.scopeKey, nextNumber: Number(nextNumbers[row.scopeKey]) }));

        setSaving(true);
        try {
            const saved = await api.updateDocumentNumbering(docType, {
                ...config,
                template: config.template.trim(),
                ...(storeCodes.length > 0 ? { storeCodes } : {}),
                ...(changedNumbers.length > 0 ? { nextNumbers: changedNumbers } : {}),
            });
            adopt(saved);
            toast.success(`${info.label} numbering saved`);
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : 'Could not save document numbering');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            <CompactSection
                title={`${capitalise(info.noun)} number`}
                titleStyle="heading"
                actions={(
                    <Button onClick={handleSave} disabled={saving} loading={saving}>
                        {saving ? 'Saving...' : 'Save'}
                    </Button>
                )}
            >
                <div className="space-y-4">
                    <Field label="Start from" htmlFor={id('preset')} className="max-w-sm">
                        <Select
                            id={id('preset')}
                            value={preset}
                            onChange={(e) => {
                                const chosen = presets.find((p) => p.key === e.target.value);
                                if (chosen) setConfig({ ...chosen.config });
                            }}
                            className="w-full"
                        >
                            {presets.map((p) => (
                                <option key={p.key} value={p.key}>{p.label}</option>
                            ))}
                            <option value={CUSTOM} disabled>Custom</option>
                        </Select>
                    </Field>

                    <Field
                        label="Format"
                        htmlFor={id('template')}
                        required
                        error={submitted || config.template.trim() ? formatErrors[0] : undefined}
                    >
                        <Input
                            id={id('template')}
                            ref={templateRef}
                            value={config.template}
                            maxLength={NUMBERING_TEMPLATE_MAX_LENGTH}
                            onChange={(e) => update({ template: e.target.value })}
                            className="w-full font-mono"
                            spellCheck={false}
                            autoComplete="off"
                        />
                    </Field>
                    {formatErrors.length > 1 && (
                        <ul className="-mt-2 space-y-1 text-xs text-danger">
                            {formatErrors.slice(1).map((error) => <li key={error}>{error}</li>)}
                        </ul>
                    )}

                    <div>
                        <p className="text-xs font-medium text-gray-600">Insert</p>
                        <div className="mt-1 flex flex-wrap gap-2">
                            {numberingTokensFor(docType).map((token) => (
                                <Button
                                    key={token}
                                    variant="secondary"
                                    onClick={() => insertToken(token)}
                                    title={NUMBERING_TOKEN_LABELS[token]}
                                    className="max-md:min-h-touch"
                                >
                                    <span className="font-mono">{`{${token}}`}</span>
                                    <span className="text-gray-400">{NUMBERING_TOKEN_LABELS[token]}</span>
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-3">
                        <Field label="Starts again at 1" htmlFor={id('reset')}>
                            <Select
                                id={id('reset')}
                                value={config.resetPolicy}
                                onChange={(e) => update({ resetPolicy: e.target.value as NumberingResetPolicy })}
                                className="w-full"
                            >
                                {NUMBERING_RESET_POLICIES.map((policy) => (
                                    <option key={policy} value={policy}>{NUMBERING_RESET_LABELS[policy]}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Series" htmlFor={id('scope')}>
                            <Select
                                id={id('scope')}
                                value={config.scope}
                                onChange={(e) => update({ scope: e.target.value as NumberingScope })}
                                className="w-full"
                            >
                                {numberingScopesFor(docType).map((scope) => (
                                    <option key={scope} value={scope}>{NUMBERING_SCOPE_LABELS[scope]}</option>
                                ))}
                            </Select>
                        </Field>
                        <Field label="Minimum digits" htmlFor={id('width')} hint="Padded with zeros: 5 gives 00042.">
                            <Input
                                id={id('width')}
                                type="number"
                                min={NUMBERING_SEQ_WIDTH_MIN}
                                max={NUMBERING_SEQ_WIDTH_MAX}
                                value={config.seqWidth}
                                onChange={(e) => update({ seqWidth: Number(e.target.value) })}
                                className="w-full"
                            />
                        </Field>
                    </div>

                    {formatErrors.length === 0 && rows[0] && (
                        <p className="text-sm text-gray-700">
                            Next {info.noun}:{' '}
                            <span className="font-mono font-semibold text-gray-900">
                                {previewNumber(
                                    config,
                                    rows[0],
                                    seqFor(rows[0].scopeKey, rows[0].currentNext),
                                    data.today,
                                    codeFor,
                                )}
                            </span>
                        </p>
                    )}
                </div>
            </CompactSection>

            {usesStore && (
                <CompactSection title="Branch codes" titleStyle="heading">
                    <p className="mb-3 text-xs text-gray-500">
                        Printed where the format says {'{STORE}'}. Up to 6 letters or digits, different for each branch,
                        and shared by every document type.
                    </p>
                    <div className="space-y-3">
                        {data.stores.map((store) => (
                            <Field
                                key={store.id}
                                label={store.name}
                                htmlFor={id(`code-${store.id}`)}
                                error={codeErrors[store.id]}
                                hint={!store.code && !codes[store.id] ? 'Left blank, one is assigned when you save.' : undefined}
                            >
                                <Input
                                    id={id(`code-${store.id}`)}
                                    value={codes[store.id] ?? ''}
                                    maxLength={6}
                                    onChange={(e) => setCodes({ ...codes, [store.id]: e.target.value.toUpperCase() })}
                                    className="w-32 font-mono uppercase"
                                    autoComplete="off"
                                />
                            </Field>
                        ))}
                    </div>
                </CompactSection>
            )}

            {formatErrors.length === 0 && (
                <CompactSection title={`Next number — ${periodLabel(config, data.today)}`} titleStyle="heading">
                    <p className="mb-3 text-xs text-gray-500">
                        Moving over from another system? Set where each series continues from. A number can only go
                        up: lower ones may already be printed. Numbers already printed in this format are skipped.
                    </p>
                    <div className="space-y-3">
                        {rows.map((row) => {
                            const typed = nextNumbers[row.scopeKey];
                            const error = nextNumberError(row.scopeKey, row.currentNext);
                            const seq = seqFor(row.scopeKey, row.currentNext);
                            return (
                                <div key={row.scopeKey || 'tenant'} className="flex flex-wrap items-start gap-3">
                                    <Field
                                        label={row.label}
                                        htmlFor={id(`next-${row.scopeKey || 'tenant'}`)}
                                        error={error || undefined}
                                        className="min-w-0 flex-1"
                                    >
                                        <Input
                                            id={id(`next-${row.scopeKey || 'tenant'}`)}
                                            type="number"
                                            min={row.currentNext}
                                            value={typed ?? String(row.currentNext)}
                                            onChange={(e) => setNextNumbers({ ...nextNumbers, [row.scopeKey]: e.target.value })}
                                            className="w-40"
                                        />
                                    </Field>
                                    <p className="pt-6 font-mono text-sm text-gray-700">
                                        {previewNumber(config, row, seq, data.today, codeFor)}
                                    </p>
                                </div>
                            );
                        })}
                    </div>
                </CompactSection>
            )}

            <Alert tone="info">
                Only new {info.label.toLowerCase()} change; ones already issued keep their numbers.
                {docType === 'SALE' ? ' A parked draft gets its number when it is completed.' : ''}
                {seriesChanged
                    ? ' A different reset or series starts its counters at 1 — after any numbers already printed in that format — unless you set a next number above.'
                    : ''}
            </Alert>
        </div>
    );
}
