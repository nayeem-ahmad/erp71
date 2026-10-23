'use client';

import type { PersonSectionKey } from '@erp71/shared-types';
import { useI18n } from '@/lib/i18n';
import { usePreferencesStore } from '@/lib/preferences/store';
import PreferenceSourceLine from './PreferenceSourceLine';

const ROWS: PersonSectionKey[] = ['invoicePrint', 'tableView', 'tableColumns', 'sidebar', 'alerts'];

/**
 * "My preferences" on the profile page: one row per setting the member can
 * personalise, saying whether it follows their profile, the built-in value or
 * their own choice, with a Reset where the choice is theirs.
 *
 * Left out entirely where no preferences were loaded for this session
 * (platform admins, referees, employees).
 */
export default function MyPreferencesSection() {
    const { t } = useI18n();
    const copy = t.profile.preferences;
    const loaded = usePreferencesStore((state) => state.data !== null);

    if (!loaded) return null;

    return (
        <section className="rounded-lg border border-gray-200 bg-white p-3 md:p-4 shadow-sm space-y-3">
            <div>
                <h2 className="text-sm font-semibold text-gray-900">{copy.heading}</h2>
                <p className="text-xs text-gray-500">{copy.hint}</p>
            </div>
            <ul className="divide-y divide-gray-100">
                {ROWS.map((key) => (
                    <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 min-h-touch md:min-h-0">
                        <span className="text-sm text-gray-700">{copy.sections[key]}</span>
                        <PreferenceSourceLine sectionKey={key} copy={copy.source} />
                    </li>
                ))}
            </ul>
        </section>
    );
}
