'use client';

import { Info } from 'lucide-react';

/**
 * The caveats a statutory report ships with its numbers.
 *
 * Every statutory endpoint returns a `notes` array saying what its figures do
 * and do not cover — that the PF register holds employee contributions only,
 * that the tax statement reports withholding rather than liability. Those are
 * load-bearing: a register handed to an inspector without them misrepresents
 * itself, so the pages render them rather than treating them as developer
 * commentary.
 */
export default function ReportNotes({ notes }: { notes?: string[] | null }) {
    if (!notes || notes.length === 0) return null;

    return (
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-start gap-2">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                <ul className="space-y-1 text-xs text-gray-600">
                    {notes.map((note) => (
                        <li key={note}>{note}</li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
