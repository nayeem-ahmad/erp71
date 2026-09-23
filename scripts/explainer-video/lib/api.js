// A thin client for the backend API, used by a video's `setup` to create the
// state it starts from (a customer who owes money, a supplier with open bills)
// through the same endpoints the app uses, so every balance is one the app
// itself computed rather than a row written by hand.
const API = process.env.API_URL || 'http://localhost:4000/api/v1';

async function connect({ email = 'nayeem.ahmad@gmail.com', password = 'password123', tenant = 'Dhaka Retail Co.', store = 'Gulshan Branch' } = {}) {
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(API + path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
    return json.data ?? json;
  };

  const { access_token: token } = await call('POST', '/auth/login', { email, password });
  const auth = { Authorization: `Bearer ${token}` };
  const me = await call('GET', '/auth/me', undefined, auth);
  const t = (me.tenants || []).find((x) => (x.name || x.tenant?.name) === tenant);
  if (!t) throw new Error(`tenant "${tenant}" not found for ${email}`);
  const tenantId = t.id || t.tenant_id || t.tenant?.id;
  const s = (t.stores || []).find((x) => x.name === store);
  if (!s) throw new Error(`store "${store}" not found`);
  const headers = { ...auth, 'x-tenant-id': tenantId, 'x-store-id': s.id };

  return {
    storeId: s.id,
    get: (path) => call('GET', path, undefined, headers),
    post: (path, body) => call('POST', path, body, headers),
    patch: (path, body) => call('PATCH', path, body, headers),
    put: (path, body) => call('PUT', path, body, headers),
  };
}

/** The first row of a list endpoint whose `name` matches. */
async function findByName(api, path, name) {
  const rows = await api.get(path);
  const list = Array.isArray(rows) ? rows : rows.items || rows.data || [];
  const hit = list.find((r) => r.name === name);
  if (!hit) throw new Error(`${path}: no "${name}"`);
  return hit;
}

module.exports = { connect, findByName };
