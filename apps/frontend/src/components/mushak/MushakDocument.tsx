'use client';

import type { ReactNode } from 'react';
import { MUSHAK_FORM_BY_CODE, toBengaliDigits } from '@erp71/shared-types';

/**
 * The chrome every NBR Mushak 6.x document shares.
 *
 * The labels here are deliberately NOT localised. A Mushak form is a statutory
 * document whose wording is prescribed in Bangla by the VAT and Supplementary
 * Duty Rules 2016 — translating "কর চালানপত্র" into German because a user set
 * their interface language to German would produce something NBR does not
 * accept. Each Bangla label therefore carries a small English gloss instead, so
 * a non-Bangla-reading bookkeeper can still work the document, and only the
 * surrounding app chrome (buttons, page titles) goes through `useI18n`.
 */

export interface MushakIssuerBlock {
    name: string;
    bin: string | null;
    tin: string | null;
    address: string | null;
    economicActivity: string | null;
    officerName: string | null;
    officerDesignation: string | null;
    readiness: { ready: boolean; missing: string[] };
}

export interface MushakPartyBlock {
    name: string;
    bin: string | null;
    nid: string | null;
    address: string | null;
    phone: string | null;
}

/** A value with its prescribed Bangla label and an English gloss beneath. */
export function MushakField({
    bn,
    en,
    value,
    mono = false,
}: {
    bn: string;
    en: string;
    value: ReactNode;
    mono?: boolean;
}) {
    return (
        <div className="flex gap-2 text-xs">
            <span className="shrink-0 text-gray-600">
                {bn}
                <span className="ms-1 text-[10px] text-gray-400">({en})</span>:
            </span>
            <span className={`min-w-0 flex-1 font-medium text-gray-900 ${mono ? 'font-mono' : ''}`}>
                {value || <span className="text-gray-300">—</span>}
            </span>
        </div>
    );
}

/**
 * Bangla-numbered column heading, as the gazetted forms print it: the label,
 * then the column's own number in Bengali numerals on the row beneath.
 */
export function MushakColumnHead({
    bn,
    en,
    index,
    align = 'start',
    className = '',
}: {
    bn: string;
    en: string;
    index: number;
    align?: 'start' | 'center' | 'end';
    className?: string;
}) {
    const alignment = align === 'end' ? 'text-end' : align === 'center' ? 'text-center' : 'text-start';
    return (
        <th className={`${alignment} border border-gray-300 px-2 py-1.5 align-bottom ${className}`}>
            <div className="text-xs font-semibold text-gray-900">{bn}</div>
            <div className="text-[10px] font-normal text-gray-500">{en}</div>
            <div className="text-[10px] font-normal text-gray-400">({toBengaliDigits(index)})</div>
        </th>
    );
}

export function MushakPartyPanel({
    heading,
    party,
    /** The 6.3 names the buyer's BIN; the 6.10 wants their NID instead. */
    showNid = false,
}: {
    heading: { bn: string; en: string };
    party: MushakPartyBlock;
    showNid?: boolean;
}) {
    return (
        <div className="space-y-1">
            <div className="mb-1 text-xs font-bold text-gray-900">
                {heading.bn}
                <span className="ms-1 text-[10px] font-normal text-gray-400">({heading.en})</span>
            </div>
            <MushakField bn="নাম" en="Name" value={party.name} />
            <MushakField bn="বিআইএন" en="BIN" value={party.bin} mono />
            {showNid ? (
                <MushakField bn="জাতীয় পরিচয়পত্র নম্বর" en="NID" value={party.nid} mono />
            ) : null}
            <MushakField bn="ঠিকানা" en="Address" value={party.address} />
        </div>
    );
}

/**
 * The document frame: the government heading, the form's gazetted title and
 * rule citation, the issuer block, and the print rules that reduce the page to
 * just this document.
 */
export default function MushakDocument({
    form,
    issuer,
    children,
    banner,
}: {
    /** A form code from `MUSHAK_FORMS`, e.g. `'6.3'`. */
    form: string;
    issuer: MushakIssuerBlock;
    children: ReactNode;
    /** Warnings shown above the document but never printed. */
    banner?: ReactNode;
}) {
    const meta = MUSHAK_FORM_BY_CODE[form];

    return (
        <>
            {/* The document is the page when printed: everything else — sidebar,
                header, the action buttons — is hidden, and A4 portrait with a
                10mm margin is what NBR expects a 6.x on. */}
            <style jsx global>{`
                @media print {
                    body * { visibility: hidden !important; }
                    #mushak-printable, #mushak-printable * { visibility: visible !important; }
                    #mushak-printable {
                        position: absolute;
                        inset-inline-start: 0;
                        top: 0;
                        width: 100%;
                        margin: 0;
                        padding: 0;
                        border: 0 !important;
                        box-shadow: none !important;
                    }
                    .no-print { display: none !important; }
                    @page { size: A4 portrait; margin: 10mm; }
                }
            `}</style>

            {banner ? <div className="no-print space-y-2">{banner}</div> : null}

            <div
                id="mushak-printable"
                className="mx-auto w-full max-w-4xl border border-gray-300 bg-white p-4 text-gray-900 md:p-6"
            >
                <header className="border-b border-gray-300 pb-3 text-center">
                    <div className="text-xs text-gray-600">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</div>
                    <div className="text-xs text-gray-600">জাতীয় রাজস্ব বোর্ড</div>
                    <h2 className="mt-1 text-base font-bold">{meta?.titleBn ?? form}</h2>
                    <div className="text-xs text-gray-500">{meta?.titleEn}</div>
                    <div className="mt-0.5 text-[10px] text-gray-500">{meta?.ruleBn}</div>
                    <div className="mt-1 inline-block border border-gray-400 px-2 py-0.5 text-xs font-semibold">
                        মূসক-{toBengaliDigits(form)}
                    </div>
                </header>

                <section className="grid gap-x-6 gap-y-1 border-b border-gray-300 py-3 md:grid-cols-2">
                    <MushakField bn="নিবন্ধিত ব্যক্তির নাম" en="Registered person" value={issuer.name} />
                    <MushakField bn="বিআইএন" en="BIN" value={issuer.bin} mono />
                    <MushakField bn="চালানপত্র ইস্যুর ঠিকানা" en="Address of issue" value={issuer.address} />
                    <MushakField bn="অর্থনৈতিক কার্যক্রম" en="Economic activity" value={issuer.economicActivity} />
                </section>

                {children}
            </div>
        </>
    );
}

/**
 * The signature block that closes a 6.3 and a 6.7. Rule 40 wants the name and
 * designation of the person answerable for the document, not just a squiggle.
 */
export function MushakSignature({ issuer }: { issuer: MushakIssuerBlock }) {
    return (
        <section className="mt-8 flex justify-end">
            <div className="w-64 space-y-1 border-t border-gray-400 pt-2 text-xs">
                <div className="text-gray-500">
                    প্রতিষ্ঠানের দায়িত্বপ্রাপ্ত ব্যক্তির স্বাক্ষর
                    <span className="ms-1 text-[10px] text-gray-400">(Authorised signature)</span>
                </div>
                <MushakField bn="নাম" en="Name" value={issuer.officerName} />
                <MushakField bn="পদবি" en="Designation" value={issuer.officerDesignation} />
                <div className="pt-4 text-[10px] text-gray-400">সীলমোহর (Seal)</div>
            </div>
        </section>
    );
}
