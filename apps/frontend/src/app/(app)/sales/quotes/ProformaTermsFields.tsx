'use client';

import { useI18n } from '@/lib/i18n';

/**
 * The commercial-terms block that turns a quotation into a proforma invoice.
 *
 * Shared by the create screen and the detail editor rather than duplicated: the
 * two would otherwise drift on which terms exist and which are required, and a
 * term the buyer's bank needs is exactly the kind of field that gets added to
 * one form and forgotten on the other.
 */

export type ProformaTerms = {
    currency: string;
    exchangeRate: string;
    incoterm: string;
    portOfLoading: string;
    portOfDischarge: string;
    paymentTerms: string;
    advancePercent: string;
    deliveryLeadTimeDays: string;
    countryOfOrigin: string;
};

export const emptyProformaTerms: ProformaTerms = {
    currency: 'BDT',
    exchangeRate: '',
    incoterm: '',
    portOfLoading: '',
    portOfDischarge: '',
    paymentTerms: '',
    advancePercent: '',
    deliveryLeadTimeDays: '',
    countryOfOrigin: '',
};

/** Kept in step with INCOTERMS in the backend DTO, which rejects anything else. */
const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'DAP', 'DDP'];

/**
 * A short list, not every ISO 4217 code: these are what a Bangladeshi importer
 * or exporter actually writes. The field stays free-text-capable through
 * `datalist` so an unlisted currency is still enterable.
 */
const COMMON_CURRENCIES = ['BDT', 'USD', 'EUR', 'CNY', 'GBP', 'JPY', 'INR', 'AED', 'SGD', 'MYR'];

const inputClass =
    'w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm text-gray-900 focus:border-blue-600 focus:outline-none';

/**
 * Maps the form's strings onto the API payload, dropping anything left blank so
 * a PATCH never blanks a term the user did not touch.
 */
export function proformaTermsPayload(terms: ProformaTerms, docKind: 'QUOTE' | 'PROFORMA') {
    const num = (value: string) => (value.trim() === '' ? undefined : Number(value));
    const str = (value: string) => (value.trim() === '' ? undefined : value.trim());

    return {
        docKind,
        currency: str(terms.currency)?.toUpperCase(),
        // Only sent when the document is not in taka. A rate on a BDT document
        // is meaningless and the backend nulls it anyway.
        exchangeRate: terms.currency.toUpperCase() === 'BDT' ? undefined : num(terms.exchangeRate),
        incoterm: str(terms.incoterm),
        portOfLoading: str(terms.portOfLoading),
        portOfDischarge: str(terms.portOfDischarge),
        paymentTerms: str(terms.paymentTerms),
        advancePercent: num(terms.advancePercent),
        deliveryLeadTimeDays: num(terms.deliveryLeadTimeDays),
        countryOfOrigin: str(terms.countryOfOrigin),
    };
}

export default function ProformaTermsFields({
    terms,
    onChange,
    disabled,
}: {
    terms: ProformaTerms;
    onChange: (terms: ProformaTerms) => void;
    disabled?: boolean;
}) {
    const { t } = useI18n();
    const copy = t.quotes.detail.terms;
    const set = (patch: Partial<ProformaTerms>) => onChange({ ...terms, ...patch });
    const isForeign = terms.currency.toUpperCase() !== 'BDT';

    return (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase text-gray-500">{copy.heading}</p>

            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.currency}</span>
                    <input
                        list="proforma-currencies"
                        value={terms.currency}
                        onChange={(e) => set({ currency: e.target.value })}
                        disabled={disabled}
                        maxLength={3}
                        className={inputClass}
                    />
                    <datalist id="proforma-currencies">
                        {COMMON_CURRENCIES.map((code) => (
                            <option key={code} value={code} />
                        ))}
                    </datalist>
                </label>

                {/* Shown only for a foreign-currency document, and required there:
                    the rate is what convertToOrder translates the sale at. */}
                {isForeign && (
                    <label className="block">
                        <span className="mb-1 block text-xs text-gray-500">
                            BDT / {terms.currency.toUpperCase()}
                        </span>
                        <input
                            type="number"
                            step="0.000001"
                            min="0"
                            value={terms.exchangeRate}
                            onChange={(e) => set({ exchangeRate: e.target.value })}
                            disabled={disabled}
                            className={inputClass}
                        />
                    </label>
                )}

                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.incoterm}</span>
                    <select
                        value={terms.incoterm}
                        onChange={(e) => set({ incoterm: e.target.value })}
                        disabled={disabled}
                        className={inputClass}
                    >
                        <option value="">—</option>
                        {INCOTERMS.map((code) => (
                            <option key={code} value={code}>
                                {code}
                            </option>
                        ))}
                    </select>
                </label>

                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.advance} %</span>
                    <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={terms.advancePercent}
                        onChange={(e) => set({ advancePercent: e.target.value })}
                        disabled={disabled}
                        className={inputClass}
                    />
                </label>

                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.portOfLoading}</span>
                    <input
                        value={terms.portOfLoading}
                        onChange={(e) => set({ portOfLoading: e.target.value })}
                        disabled={disabled}
                        className={inputClass}
                    />
                </label>

                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.portOfDischarge}</span>
                    <input
                        value={terms.portOfDischarge}
                        onChange={(e) => set({ portOfDischarge: e.target.value })}
                        disabled={disabled}
                        className={inputClass}
                    />
                </label>

                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.countryOfOrigin}</span>
                    <input
                        value={terms.countryOfOrigin}
                        onChange={(e) => set({ countryOfOrigin: e.target.value })}
                        disabled={disabled}
                        className={inputClass}
                    />
                </label>

                <label className="block">
                    <span className="mb-1 block text-xs text-gray-500">{copy.deliveryLeadTime}</span>
                    <input
                        type="number"
                        min="0"
                        value={terms.deliveryLeadTimeDays}
                        onChange={(e) => set({ deliveryLeadTimeDays: e.target.value })}
                        disabled={disabled}
                        className={inputClass}
                    />
                </label>

                <label className="col-span-2 block md:col-span-4">
                    <span className="mb-1 block text-xs text-gray-500">{copy.paymentTerms}</span>
                    <input
                        value={terms.paymentTerms}
                        onChange={(e) => set({ paymentTerms: e.target.value })}
                        disabled={disabled}
                        placeholder="30% advance, 70% against BL copy"
                        className={inputClass}
                    />
                </label>
            </div>
        </div>
    );
}
