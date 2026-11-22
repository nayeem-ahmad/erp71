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

/**
 * The sidebar's colour, chosen beside the style: the usual white rail, or a
 * dark navy one. Independent of `UiTheme`, so any style can have either.
 */
export const UI_SIDEBARS = ['LIGHT', 'NAVY'] as const;

export type UiSidebar = (typeof UI_SIDEBARS)[number];

export const DEFAULT_UI_SIDEBAR: UiSidebar = 'LIGHT';

export function isUiSidebar(value: unknown): value is UiSidebar {
  return typeof value === 'string' && (UI_SIDEBARS as readonly string[]).includes(value);
}
