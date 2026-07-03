export type SalesSettingsSnapshot = {
    pos_enabled?: boolean | null;
};

export function isPosEnabled(settings?: SalesSettingsSnapshot | null): boolean {
    return settings?.pos_enabled !== false;
}