/**
 * The Bangladesh public holidays that fall on the same Gregorian date every
 * year.
 *
 * Deliberately fixed-date only. The rest of the national calendar — the two
 * Eids, Durga Puja, Buddha Purnima, Shab-e-Barat, Janmashtami — follows the
 * lunar calendar and is announced by the government year by year, so any table
 * shipped in code would be wrong within a year and silently wrong after that.
 * Those are added by hand; these six are the ones a tenant should never have to
 * type in again.
 *
 * Dates that were national holidays but have been added and removed by
 * successive governments (17 March, 15 August, 7 November) are left out on
 * purpose: a suggestion that is politically contested is worse than one the
 * tenant adds themselves.
 */

export interface HolidayPreset {
    /** `MM-DD`. Combined with a year to make the stored date. */
    month_day: string;
    name: string;
}

export const BANGLADESH_FIXED_HOLIDAYS: HolidayPreset[] = [
    { month_day: '02-21', name: 'Shaheed Day & International Mother Language Day' },
    { month_day: '03-26', name: 'Independence Day' },
    { month_day: '04-14', name: 'Pohela Boishakh' },
    { month_day: '05-01', name: 'May Day' },
    { month_day: '12-16', name: 'Victory Day' },
    { month_day: '12-25', name: 'Christmas Day' },
];

/** The fixed-date holidays resolved to `YYYY-MM-DD` for one year. */
export function buildPresetHolidays(year: number): { date: string; name: string }[] {
    return BANGLADESH_FIXED_HOLIDAYS.map((preset) => ({
        date: `${year}-${preset.month_day}`,
        name: preset.name,
    }));
}

export function isLeapYear(year: number): boolean {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
