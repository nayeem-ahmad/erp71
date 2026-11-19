/**
 * The workspace's visual style, chosen by an admin in Settings › Branding.
 *
 * - CLASSIC: the look ERP71 has always had. The default, so no workspace
 *   changes until someone picks another.
 * - POLISHED: calmer type, sentence-case labels, and lists that turn into
 *   cards on a phone.
 * - COLORFUL: POLISHED plus colour: gradient KPI cards, a hue per sidebar
 *   module, tinted icon chips. Buttons and links stay blue in every style.
 */
export const UI_THEMES = ['CLASSIC', 'POLISHED', 'COLORFUL'] as const;

export type UiTheme = (typeof UI_THEMES)[number];

export const DEFAULT_UI_THEME: UiTheme = 'CLASSIC';

export function isUiTheme(value: unknown): value is UiTheme {
  return typeof value === 'string' && (UI_THEMES as readonly string[]).includes(value);
}
