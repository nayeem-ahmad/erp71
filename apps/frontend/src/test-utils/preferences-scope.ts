/**
 * Puts this test's tab in workspace `<tenantId>` signed in as `<userId>`, as far
 * as the preferences store can tell (`currentPreferencesScopeKey`): the tab's
 * `tenant_id` and an access token whose subject is the user.
 *
 * The store only answers for the person and workspace the tab is in, so a test
 * that hydrates it as `t1:u1` signs in as `t1:u1` first:
 *
 *     beforeEach(() => signInForPreferences('t1:u1'));
 *     usePreferencesStore.getState().hydrate('t1:u1', data);
 *
 * Call it after any `localStorage.clear()`, which would take the token with it.
 */
export function signInForPreferences(scopeKey: string): void {
    const [tenantId, userId] = scopeKey.split(':');
    window.sessionStorage.setItem('tenant_id', tenantId);
    window.localStorage.setItem('access_token', fakeAccessToken(userId));
}

/** An unsigned JWT-shaped token carrying `sub` — enough for `tokenSubject`. */
export function fakeAccessToken(userId: string): string {
    const encode = (value: object) =>
        btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
    return `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: userId })}.signature`;
}
