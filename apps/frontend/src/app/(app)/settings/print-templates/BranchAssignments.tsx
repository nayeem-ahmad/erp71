'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { Select } from '@/components/ui';
import { clearPrintTemplateCache } from '@/lib/print/use-print-header';
import type { PrintDocType } from '@/lib/print';
import { DOC_TYPES } from './HeaderEditor';

interface Store {
    id: string;
    name: string;
}

interface Assignment {
    store_id: string;
    doc_type: PrintDocType;
    template_id: string;
}

interface BranchAssignmentsProps {
    templates: { id: string; name: string }[];
}

const COMPANY = 'company';

/**
 * Which letterhead each branch prints, per document type. A row left on
 * Company default stores nothing and follows the template assigned on the
 * company side; naming a template pins the branch to it. Each change saves on
 * its own — the template Save button never writes these.
 *
 * Renders nothing until the tenant has two stores: a single-branch shop has no
 * choice to make here.
 */
export default function BranchAssignments({ templates }: BranchAssignmentsProps) {
    const { t } = useI18n();
    const copy = t.settingsExtras.printTemplates;

    const [stores, setStores] = useState<Store[]>([]);
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [selected, setSelected] = useState<string>(COMPANY);

    useEffect(() => {
        let active = true;
        Promise.resolve(api.getStores())
            .then((data: Store[] | null) => {
                if (active) setStores(data ?? []);
            })
            .catch(() => {
                if (active) setStores([]);
            });
        return () => {
            active = false;
        };
    }, []);

    // Reloaded with the template list: deleting a template drops its pins.
    useEffect(() => {
        if (stores.length < 2) return;
        let active = true;
        Promise.resolve(api.getPrintTemplateAssignments())
            .then((data: Assignment[] | null) => {
                if (active) setAssignments(data ?? []);
            })
            .catch(() => {
                if (active) toast.error(copy.assignments.loadFailed);
            });
        return () => {
            active = false;
        };
    }, [stores.length, templates, copy.assignments.loadFailed]);

    if (stores.length < 2) return null;

    const valueFor = (storeId: string, docType: PrintDocType) =>
        assignments.find((a) => a.store_id === storeId && a.doc_type === docType)?.template_id ?? '';

    const handleChange = async (storeId: string, docType: PrintDocType, templateId: string) => {
        const previous = assignments;
        const others = assignments.filter((a) => !(a.store_id === storeId && a.doc_type === docType));
        setAssignments(templateId
            ? [...others, { store_id: storeId, doc_type: docType, template_id: templateId }]
            : others);
        try {
            await api.upsertPrintTemplateAssignment({ storeId, docType, templateId: templateId || null });
            clearPrintTemplateCache();
        } catch {
            setAssignments(previous);
            toast.error(copy.assignments.saveFailed);
        }
    };

    const pill = (id: string, label: string) => (
        <button
            key={id}
            type="button"
            onClick={() => setSelected(id)}
            className={`rounded-md border px-3 py-2 text-xs max-md:min-h-touch ${
                selected === id
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
        >
            {label}
        </button>
    );

    return (
        <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-3 md:p-4">
            <h2 className="text-sm font-semibold text-gray-700">{copy.assignments.title}</h2>

            <div className="flex flex-wrap gap-2">
                {pill(COMPANY, copy.assignments.company)}
                {stores.map((store) => pill(store.id, store.name))}
            </div>

            {selected === COMPANY ? (
                <p className="text-xs text-gray-500">{copy.assignments.companyHelp}</p>
            ) : (
                <>
                    <p className="text-xs text-gray-500">{copy.assignments.hint}</p>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        {DOC_TYPES.map((docType) => (
                            <label key={docType} className="flex flex-col gap-1 text-xs text-gray-600">
                                {copy.docTypes[docType]}
                                <Select
                                    aria-label={copy.docTypes[docType]}
                                    value={valueFor(selected, docType)}
                                    onChange={(e) => void handleChange(selected, docType, e.target.value)}
                                >
                                    <option value="">{copy.assignments.companyDefault}</option>
                                    {templates.map((template) => (
                                        <option key={template.id} value={template.id}>{template.name}</option>
                                    ))}
                                </Select>
                            </label>
                        ))}
                    </div>
                </>
            )}
        </section>
    );
}
