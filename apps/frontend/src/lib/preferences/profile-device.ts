import type { DevicePrefs } from '@erp71/shared-types';
import { isCurrentPreferencesScope } from './scope';
import { usePreferencesStore } from './store';

/**
 * What the signed-in member's profile sets for this device — only the fields it
 * sets, and `{}` while preferences are not loaded (admin, referee and employee
 * modes, or before the first load) or still belong to someone else.
 *
 * The print readers consult this after this browser's own stored answer and
 * before their built-in fallback. It is only ever read: a profile value is a
 * starting point for a browser that has no answer, never something written to
 * the browser on the member's behalf.
 */
export function profileDevice(): DevicePrefs {
    const { scopeKey, data } = usePreferencesStore.getState();
    if (!isCurrentPreferencesScope(scopeKey)) return {};
    return data?.sections?.device?.value ?? {};
}
