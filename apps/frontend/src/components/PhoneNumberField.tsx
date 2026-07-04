'use client';

import { MOBILE_COUNTRY_OPTIONS, DEFAULT_MOBILE_COUNTRY_CODE } from '@erp71/shared-types';

type Props = {
    countryCode: string;
    mobile: string;
    onCountryCodeChange: (value: string) => void;
    onMobileChange: (value: string) => void;
    countryLabel?: string;
    mobileLabel?: string;
    mobilePlaceholder?: string;
    required?: boolean;
    idPrefix?: string;
};

export default function PhoneNumberField({
    countryCode,
    mobile,
    onCountryCodeChange,
    onMobileChange,
    countryLabel = 'Country',
    mobileLabel = 'Mobile number',
    mobilePlaceholder = '01XXXXXXXXX',
    required = false,
    idPrefix = 'phone',
}: Props) {
    const selected = MOBILE_COUNTRY_OPTIONS.find((entry) => entry.code === countryCode)
        ?? MOBILE_COUNTRY_OPTIONS.find((entry) => entry.code === DEFAULT_MOBILE_COUNTRY_CODE)!;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
            <div className="space-y-2">
                <label htmlFor={`${idPrefix}-country`} className="text-sm font-medium text-gray-700 ml-1">
                    {countryLabel}
                </label>
                <select
                    id={`${idPrefix}-country`}
                    value={countryCode}
                    onChange={(e) => onCountryCodeChange(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 px-3 text-sm outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                >
                    {MOBILE_COUNTRY_OPTIONS.map((entry) => (
                        <option key={entry.code} value={entry.code}>
                            {entry.label} ({entry.dial})
                        </option>
                    ))}
                </select>
            </div>
            <div className="space-y-2">
                <label htmlFor={`${idPrefix}-mobile`} className="text-sm font-medium text-gray-700 ml-1">
                    {mobileLabel}
                </label>
                <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-gray-400">
                        {selected.dial}
                    </span>
                    <input
                        id={`${idPrefix}-mobile`}
                        type="tel"
                        value={mobile}
                        onChange={(e) => onMobileChange(e.target.value)}
                        required={required}
                        placeholder={mobilePlaceholder}
                        className="w-full bg-gray-50 border border-gray-200 rounded-xl py-3 pl-14 pr-4 outline-hidden focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                </div>
            </div>
        </div>
    );
}