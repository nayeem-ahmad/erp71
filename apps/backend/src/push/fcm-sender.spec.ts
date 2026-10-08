import * as crypto from 'node:crypto';
import { FcmSender, parseServiceAccount, signJwt } from './fcm-sender';

describe('FcmSender', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const account = {
        project_id: 'erp71-test',
        client_email: 'push@erp71-test.iam.gserviceaccount.com',
        private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const saved = process.env.FCM_SERVICE_ACCOUNT_JSON;

    afterEach(() => {
        if (saved === undefined) delete process.env.FCM_SERVICE_ACCOUNT_JSON;
        else process.env.FCM_SERVICE_ACCOUNT_JSON = saved;
    });

    const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

    it('is off, and sends nothing, without a service account', async () => {
        delete process.env.FCM_SERVICE_ACCOUNT_JSON;
        const sender = new FcmSender();
        sender.fetchImpl = jest.fn();
        expect(sender.enabled).toBe(false);
        expect(await sender.send('t', { title: 'a', body: 'b' })).toBe('failed');
        expect(sender.fetchImpl).not.toHaveBeenCalled();
    });

    it('accepts the key raw or base64, and rejects anything else', () => {
        const raw = JSON.stringify(account);
        expect(parseServiceAccount(raw)?.project_id).toBe('erp71-test');
        expect(parseServiceAccount(Buffer.from(raw).toString('base64'))?.client_email).toBe(account.client_email);
        expect(parseServiceAccount('{"project_id":"x"}')).toBeNull();
        expect(parseServiceAccount('not json')).toBeNull();
    });

    it('signs an assertion Google can verify', () => {
        const jwt = signJwt({ iss: 'me', aud: 'you' }, account.private_key);
        const [header, payload, signature] = jwt.split('.');
        expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
        expect(
            crypto.verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
        ).toBe(true);
    });

    it('gets one access token, reuses it, and posts the message to the project', async () => {
        process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
        const sender = new FcmSender();
        const fetchImpl = jest.fn(async (url: string) =>
            url.includes('oauth2') ? json({ access_token: 'ya29.token', expires_in: 3600 }) : json({ name: 'projects/x/messages/1' }),
        );
        sender.fetchImpl = fetchImpl as any;

        expect(await sender.send('device-1', { title: 'Hi', body: 'There', data: { k: 'v' } })).toBe('sent');
        expect(await sender.send('device-2', { title: 'Hi', body: 'Again' })).toBe('sent');

        const urls = fetchImpl.mock.calls.map((c) => c[0]);
        expect(urls.filter((u) => u.includes('oauth2'))).toHaveLength(1);
        const [url, init] = fetchImpl.mock.calls[1] as any;
        expect(url).toBe('https://fcm.googleapis.com/v1/projects/erp71-test/messages:send');
        expect(init.headers.Authorization).toBe('Bearer ya29.token');
        expect(JSON.parse(init.body).message).toEqual(
            expect.objectContaining({ token: 'device-1', notification: { title: 'Hi', body: 'There' }, data: { k: 'v' } }),
        );
    });

    it('reports an uninstalled app’s token as unregistered', async () => {
        process.env.FCM_SERVICE_ACCOUNT_JSON = JSON.stringify(account);
        const sender = new FcmSender();
        sender.fetchImpl = jest.fn(async (url: string) =>
            url.includes('oauth2')
                ? json({ access_token: 't' })
                : json({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }, 404),
        ) as any;
        expect(await sender.send('gone', { title: 'a', body: 'b' })).toBe('unregistered');
    });
});
