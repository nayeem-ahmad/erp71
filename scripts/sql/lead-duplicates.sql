-- ============================================================================
-- Find, and optionally clear, duplicate leads for one tenant.
--
-- Self-contained: needs nothing deployed, no application code, no migration.
-- Runs against the production database as it stands today.
--
-- Get it onto the box first (it is not in the deployed branch):
--     scp scripts/sql/lead-duplicates.sql root@66.116.236.127:/tmp/
--
-- `tenant_id` is exact and is what you should normally use — tenant NAMES ARE
-- NOT UNIQUE (production has two tenants both named "Outsource to BD").
--
--   REPORT (read-only, always safe) — on the VPS, from /opt/erp71:
--     docker compose -p erp71 --env-file .env.production -f docker-compose.prod.yml \
--       exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
--       -v tenant_id="3f7d7826-fa79-4512-9e20-f5916a9821d9" -v confirm=no -f -' < /tmp/lead-duplicates.sql
--
--   DELETE — same command with confirm=yes:
--       ... -v tenant_id="3f7d7826-fa79-4512-9e20-f5916a9821d9" -v confirm=yes -f -' < /tmp/lead-duplicates.sql
--
-- The inner single quotes matter: POSTGRES_USER/POSTGRES_DB are set inside the
-- db container, not in the host shell, so the expansion has to happen there.
--
-- `tenant` is an ILIKE pattern matched against Tenant.name. Run the report
-- first and check it resolved to the one shop you meant: the delete refuses to
-- run unless the pattern matches exactly one tenant.
--
-- ── What gets deleted ───────────────────────────────────────────────────────
-- Deleting a lead CASCADES: its activities, conversations and follow-ups are
-- destroyed with it. Projects and campaign memberships survive, with the lead
-- link nulled. So only duplicates that carry NOTHING are ever deleted — no
-- manually logged activity, no conversation, no follow-up, no linked project,
-- no campaign membership, not converted. That is the shape of a lead imported
-- twice and never worked. Everything else is reported as BY HAND and left
-- alone, because merging two leads' histories means choosing which one wins.
--
-- The oldest lead of each duplicate group is always the keeper.
--
-- The normalization below is the same rule as
-- packages/shared-types/lead-identity.ts, verified byte-identical
-- against it over 17 spellings.
-- ============================================================================

\set ON_ERROR_STOP on
\if :{?confirm}
\else
  \set confirm no
\endif
\if :{?tenant_id}
\elif :{?tenant}
\else
  \echo '!! Give -v tenant_id=<uuid> (exact, preferred) or -v tenant=<name pattern>. Aborting.'
  \quit
\endif

-- Session-local, so nothing is left behind in the database.
CREATE FUNCTION pg_temp.norm_mobile(raw TEXT) RETURNS TEXT AS $fn$
DECLARE digits TEXT; national TEXT;
BEGIN
    IF raw IS NULL THEN RETURN NULL; END IF;
    digits := regexp_replace(raw, '\D', '', 'g');
    IF digits = '' THEN RETURN NULL; END IF;
    national := digits;
    IF left(national, 3) = '880' THEN national := substr(national, 4); END IF;
    IF left(national, 1) = '0'   THEN national := substr(national, 2); END IF;
    IF length(national) BETWEEN 7 AND 11 THEN RETURN '+880' || national; END IF;
    RETURN digits;
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

CREATE FUNCTION pg_temp.norm_url(raw TEXT) RETURNS TEXT AS $fn$
DECLARE value TEXT;
BEGIN
    IF raw IS NULL THEN RETURN NULL; END IF;
    value := lower(btrim(raw));
    value := regexp_replace(value, '^[a-z][a-z0-9+.-]*://', '');
    value := regexp_replace(value, '^www\.', '');
    value := regexp_replace(value, '[?#].*$', '');
    value := regexp_replace(value, '/+$', '');
    RETURN nullif(value, '');
END;
$fn$ LANGUAGE plpgsql IMMUTABLE;

\echo ''
\echo '=== 1. Tenant match ========================================================'
-- Prefer the exact id: tenant names are not unique. Production carries two
-- tenants both literally named "Outsource to BD", so a name pattern cannot
-- address one of them and the single-tenant guard below would refuse the delete.
\if :{?tenant_id}
CREATE TEMP TABLE t_tenants AS
SELECT id, name FROM "Tenant" WHERE id = :'tenant_id';
\else
CREATE TEMP TABLE t_tenants AS
SELECT id, name FROM "Tenant" WHERE name ILIKE :'tenant';
\endif
SELECT id, name FROM t_tenants ORDER BY name;

CREATE TEMP TABLE t_leads AS
SELECT id, tenant_id, name, mobile, email, linkedin_url, status,
       converted_customer_id, created_at
FROM "Lead" WHERE tenant_id IN (SELECT id FROM t_tenants);

-- One row per lead per identity value it carries.
CREATE TEMP TABLE t_keys AS
SELECT id AS lead_id, 'mobile' AS field, pg_temp.norm_mobile(mobile) AS value
  FROM t_leads WHERE pg_temp.norm_mobile(mobile) IS NOT NULL
UNION ALL
SELECT id, 'email', nullif(lower(btrim(email)), '')
  FROM t_leads WHERE nullif(lower(btrim(email)), '') IS NOT NULL
UNION ALL
SELECT id, 'linkedin', pg_temp.norm_url(linkedin_url)
  FROM t_leads WHERE pg_temp.norm_url(linkedin_url) IS NOT NULL;

-- Leads joined transitively: if A and B share a mobile and B and C share an
-- email, all three are one person. Grouping per key instead would report two
-- overlapping pairs and could delete B as C's duplicate while still treating
-- it as A's keeper.
CREATE TEMP TABLE t_comp AS
WITH RECURSIVE
edges AS (
    SELECT DISTINCT a.lead_id AS src, b.lead_id AS dst
    FROM t_keys a
    JOIN t_keys b ON a.field = b.field AND a.value = b.value AND a.lead_id <> b.lead_id
),
reach(lead_id, root) AS (
    SELECT DISTINCT lead_id, lead_id FROM t_keys
    UNION
    SELECT e.dst, r.root FROM reach r JOIN edges e ON e.src = r.lead_id
)
SELECT lead_id, min(root) AS component FROM reach GROUP BY lead_id;

CREATE TEMP TABLE t_plan AS
SELECT l.id, l.tenant_id, l.name, l.mobile, l.email, l.linkedin_url, l.status,
       l.converted_customer_id, l.created_at, c.component,
       row_number() OVER (PARTITION BY c.component ORDER BY l.created_at, l.id) AS rn,
       NULL::TEXT AS holds
FROM t_leads l
JOIN t_comp c ON c.lead_id = l.id
WHERE c.component IN (SELECT component FROM t_comp GROUP BY component HAVING count(*) > 1);

-- Everything a delete would destroy or orphan. Only MANUAL activities count as
-- history: an import seeds one of its own (origin 'IMPORT') for the opening
-- next step, and a lead carrying only that has never actually been worked.
UPDATE t_plan p SET holds = nullif(concat_ws(', ',
    (SELECT CASE WHEN count(*) > 0 THEN count(*) || ' logged activity(ies)' END
       FROM "CrmActivity" x WHERE x.lead_id = p.id AND x.origin = 'MANUAL'),
    (SELECT CASE WHEN count(*) > 0 THEN count(*) || ' conversation(s)' END
       FROM "LeadConversation" x WHERE x.lead_id = p.id),
    (SELECT CASE WHEN count(*) > 0 THEN count(*) || ' follow-up(s)' END
       FROM "CrmFollowUp" x WHERE x.lead_id = p.id),
    (SELECT CASE WHEN count(*) > 0 THEN count(*) || ' project(s) linked' END
       FROM projects x WHERE x.lead_id = p.id),
    (SELECT CASE WHEN count(*) > 0 THEN 'in ' || count(*) || ' campaign(s)' END
       FROM "CrmCampaignRecipient" x WHERE x.lead_id = p.id),
    CASE WHEN p.status = 'CONVERTED' OR p.converted_customer_id IS NOT NULL
         THEN 'converted' END
), '');

CREATE TEMP VIEW v_plan AS
SELECT component, rn,
       CASE WHEN rn = 1 THEN 'keep'
            WHEN holds IS NULL THEN 'DELETABLE'
            ELSE 'BY HAND' END AS verdict,
       id, name, status, created_at::date AS created, mobile, email, holds
FROM t_plan;

\echo ''
\echo '=== 2. Duplicate groups ===================================================='
\echo '    (oldest lead of each group is the keeper)'
SELECT component, verdict, id, name, status, created, mobile, email, holds
FROM v_plan ORDER BY component, rn;

\echo ''
\echo '=== 3. Summary ============================================================='
SELECT
    (SELECT count(*) FROM t_leads)                                  AS leads_in_tenant,
    (SELECT count(DISTINCT component) FROM t_plan)                  AS duplicate_groups,
    (SELECT count(*) FROM v_plan WHERE verdict = 'DELETABLE')       AS deletable,
    (SELECT count(*) FROM v_plan WHERE verdict = 'BY HAND')         AS need_manual_merge;

\echo ''
\echo '=== 4. Deletion ============================================================'
\echo '    Deletes only where confirm=yes AND the pattern matched one tenant.'
BEGIN;
DELETE FROM "Lead"
WHERE id IN (SELECT id FROM v_plan WHERE verdict = 'DELETABLE')
  AND :'confirm' = 'yes'
  AND (SELECT count(*) FROM t_tenants) = 1;
COMMIT;

\echo ''
\echo '    confirm setting was:'
SELECT :'confirm' AS confirm,
       (SELECT count(*) FROM t_tenants) AS tenants_matched,
       (SELECT count(*) FROM "Lead" WHERE tenant_id IN (SELECT id FROM t_tenants)) AS leads_remaining;
\echo ''
\echo '    A DELETE 0 above with confirm=yes means nothing was safe to delete,'
\echo '    or the tenant pattern did not match exactly one tenant.'
\echo ''
