#!/usr/bin/env bash
# Provision erp71 Render services on the free tier.
# Requires: Render CLI logged in (~/.render/cli.yaml) and optional VPS SSH for secrets.
#
# Free-tier limits: one free Postgres per workspace, 750 web instance-hours/month.
# If creation fails with "free tier usage quota has been exhausted", retry after
# the monthly reset (1st of each month).

set -euo pipefail

OWNER="tea-d4mkmlfdiees739aics0"
FREE_PG_NAME="erp71-db"
REPO="https://github.com/nayeem-ahmad/erp71"

exec python3 - "$OWNER" "$FREE_PG_NAME" "$REPO" <<'PY'
import json, os, secrets, subprocess, sys, urllib.error, urllib.request, yaml

OWNER, FREE_PG_NAME, REPO = sys.argv[1:4]
KEY = yaml.safe_load(open(os.path.expanduser("~/.render/cli.yaml")))["api"]["key"]
API = "https://api.render.com/v1"

def api(method, path, data=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(data).encode() if data is not None else None,
        method=method,
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")

def list_services():
    code, rows = api("GET", "/services?limit=100")
    if code != 200:
        return {}
    return {row["service"]["name"]: row["service"]["id"] for row in rows if "service" in row}

def postgres_id(name):
    out = subprocess.check_output(["render", "services", "-o", "json"], text=True)
    for row in json.loads(out):
        p = row.get("postgres")
        if p and p.get("name") == name:
            return p["id"]
    return None

def ensure_postgres():
    pg_id = postgres_id(FREE_PG_NAME)
    if pg_id:
        print(f"Postgres exists: {FREE_PG_NAME} ({pg_id})")
        return pg_id
    code, body = api("POST", "/postgres", {
        "name": FREE_PG_NAME,
        "ownerId": OWNER,
        "plan": "free",
        "version": "16",
        "region": "oregon",
        "databaseName": "erp71",
        "databaseUser": "erp71_user",
    })
    if code != 201:
        raise SystemExit(f"Failed to create Postgres ({code}): {body}")
    print(f"Created Postgres: {body['name']} ({body['id']})")
    return body["id"]

def create_service(name, branch, dockerfile, health, predeploy=None):
    existing = list_services()
    if name in existing:
        print(f"Service exists: {name} ({existing[name]})")
        return existing[name]
    env_details = {"dockerContext": ".", "dockerfilePath": dockerfile}
    if predeploy:
        env_details["preDeployCommand"] = predeploy
    code, body = api("POST", "/services", {
        "type": "web_service",
        "name": name,
        "ownerId": OWNER,
        "repo": REPO,
        "branch": branch,
        "rootDir": ".",
        "autoDeploy": "yes",
        "serviceDetails": {
            "env": "docker",
            "runtime": "docker",
            "plan": "free",
            "region": "oregon",
            "numInstances": 1,
            "healthCheckPath": health,
            "envSpecificDetails": env_details,
        },
    })
    if code != 201:
        raise SystemExit(f"Failed to create {name} ({code}): {body}")
    sid = body["service"]["id"]
    url = body["service"]["serviceDetails"]["url"]
    print(f"Created {name}: {sid} {url}")
    return sid

def load_vps_env():
    try:
        out = subprocess.check_output([
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
            "root@66.116.236.127", "cat /opt/erp71/.env.production",
        ], text=True, stderr=subprocess.DEVNULL)
    except Exception:
        print("VPS unreachable; only core env vars will be set")
        return {}
    env = {}
    for line in out.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def configure_env(service_id, envs):
    code, _ = api("PUT", f"/services/{service_id}/env-vars",
                  [{"key": k, "value": v} for k, v in envs if v])
    api("POST", f"/services/{service_id}/deploys", {"clearCache": "do_not_clear"})

pg_id = ensure_postgres()
_, conn = api("GET", f"/postgres/{pg_id}/connection-info")
db_url = conn["internalConnectionString"]
direct_url = conn["externalConnectionString"]
vps = load_vps_env()

# Free tier does not support preDeployCommand; schema sync runs in the backend Dockerfile CMD.

services = [
    ("erp71-backend", "main", "./apps/backend/Dockerfile", "/api/v1/health", None),
    ("erp71-frontend", "main", "./apps/frontend/Dockerfile", "/", None),
    ("erp71-backend-staging", "staging", "./apps/backend/Dockerfile", "/api/v1/health", None),
    ("erp71-frontend-staging", "staging", "./apps/frontend/Dockerfile", "/", None),
]

ids = {}
for name, branch, dockerfile, health, predeploy in services:
    ids[name] = create_service(name, branch, dockerfile, health, predeploy)

backend_common = [
    ("DATABASE_URL", db_url),
    ("DIRECT_URL", direct_url),
    ("BILLING_PROVIDER", vps.get("BILLING_PROVIDER", "SSL_WIRELESS")),
    ("PLATFORM_ADMIN_EMAILS", vps.get("PLATFORM_ADMIN_EMAILS", "nayeem.ahmad@gmail.com")),
    ("SMTP_HOST", vps.get("SMTP_HOST", "")),
    ("SMTP_PORT", vps.get("SMTP_PORT", "587")),
    ("SMTP_USER", vps.get("SMTP_USER", "")),
    ("SMTP_PASS", vps.get("SMTP_PASS", "")),
    ("EMAIL_FROM", vps.get("EMAIL_FROM", vps.get("SMTP_USER", "noreply@nayeemahmad.com"))),
    ("CLOUDINARY_CLOUD_NAME", vps.get("CLOUDINARY_CLOUD_NAME", "")),
    ("CLOUDINARY_API_KEY", vps.get("CLOUDINARY_API_KEY", "")),
    ("CLOUDINARY_API_SECRET", vps.get("CLOUDINARY_API_SECRET", "")),
    ("SMS_API_KEY", vps.get("SMS_API_KEY", "")),
    ("SMS_SENDER_ID", vps.get("SMS_SENDER_ID", "")),
    ("SSL_WIRELESS_API_URL", "https://sandbox.sslcommerz.com/gwprocess/v4/api.php"),
    ("SSL_WIRELESS_VALIDATION_URL", "https://sandbox.sslcommerz.com/validator/api/validationserverAPI.php"),
]

configure_env(ids["erp71-backend"], [
    ("NODE_ENV", "production"), ("PORT", "4000"),
    ("JWT_SECRET", secrets.token_urlsafe(48)),
    ("FIELD_ENCRYPTION_KEY", secrets.token_hex(32)),
    ("METRICS_TOKEN", secrets.token_urlsafe(32)),
    ("FRONTEND_URL", "https://erp71-frontend.onrender.com"),
    ("BACKEND_PUBLIC_URL", "https://erp71-backend.onrender.com"),
    *backend_common,
])

configure_env(ids["erp71-frontend"], [
    ("NODE_ENV", "production"), ("PORT", "3000"),
    ("NEXT_PUBLIC_API_URL", "https://erp71-backend.onrender.com/api/v1"),
])

configure_env(ids["erp71-backend-staging"], [
    ("NODE_ENV", "staging"), ("PORT", "4000"),
    ("JWT_SECRET", secrets.token_urlsafe(48)),
    ("FIELD_ENCRYPTION_KEY", secrets.token_hex(32)),
    ("METRICS_TOKEN", secrets.token_urlsafe(32)),
    ("FRONTEND_URL", "https://erp71-frontend-staging.onrender.com"),
    ("BACKEND_PUBLIC_URL", "https://erp71-backend-staging.onrender.com"),
    *backend_common,
])

configure_env(ids["erp71-frontend-staging"], [
    ("NODE_ENV", "staging"), ("PORT", "3000"),
    ("NEXT_PUBLIC_API_URL", "https://erp71-backend-staging.onrender.com/api/v1"),
])

print("All free-tier services provisioned.")
PY