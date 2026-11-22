'use client';

import { UI_SIDEBARS, type UiSidebar } from '@erp71/shared-types';
import { useI18n } from '@/lib/i18n';
import ChoiceCard from './ChoiceCard';

const COPY_KEY: Record<UiSidebar, 'light' | 'navy'> = {
    LIGHT: 'light',
    NAVY: 'navy',
};

/** Light or dark navy sidebar, in the same cards as the style picker above it. */
export default function UiSidebarPicker({
    value,
    saved,
    onChange,
}: {
    value: UiSidebar;
    /** The colour currently in force, marked "Current" until a new one is saved. */
    saved: UiSidebar;
    onChange: (sidebar: UiSidebar) => void;
}) {
    const { t, fmt } = useI18n();
    const m = t.settingsExtras.branding.uiSidebar;
    const shared = t.settingsExtras.branding.uiTheme;

    return (
        <fieldset>
            <legend className="text-sm font-medium text-gray-900">{m.label}</legend>
            <p className="mt-0.5 text-xs text-gray-500">{m.hint}</p>
            {/* Three columns like the style cards, so the two rows line up. */}
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
                {UI_SIDEBARS.map((sidebar) => {
                    const copy = m[COPY_KEY[sidebar]];
                    return (
                        <ChoiceCard
                            key={sidebar}
                            group="ui_sidebar"
                            value={sidebar}
                            name={copy.name}
                            description={copy.description}
                            preview={<SidebarThumbnail navy={sidebar === 'NAVY'} label={fmt(shared.previewAlt, { name: copy.name })} />}
                            selected={value === sidebar}
                            current={saved === sidebar}
                            currentLabel={shared.current}
                            onSelect={() => onChange(sidebar)}
                        />
                    );
                })}
            </div>
        </fieldset>
    );
}

/** A rail and a page in miniature, drawn rather than captured so it never goes stale. */
function SidebarThumbnail({ navy, label }: { navy: boolean; label: string }) {
    return (
        <div role="img" aria-label={label} className="flex h-24 overflow-hidden rounded-md border border-gray-200 bg-gray-50">
            <div className={`flex w-1/4 flex-col gap-1.5 border-e p-1.5 ${navy ? 'border-slate-800 bg-slate-900' : 'border-gray-200 bg-white'}`}>
                <span className={`h-1.5 w-3/4 rounded-sm ${navy ? 'bg-white' : 'bg-gray-800'}`} />
                <span className="h-2.5 w-full rounded-sm bg-blue-600" />
                {Array.from({ length: 4 }).map((_, i) => (
                    <span key={i} className={`h-1 w-5/6 rounded-sm ${navy ? 'bg-slate-600' : 'bg-gray-200'}`} />
                ))}
            </div>
            <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                <span className="h-1.5 w-1/3 rounded-sm bg-gray-700" />
                <span className="flex-1 rounded border border-gray-200 bg-white" />
            </div>
        </div>
    );
}
