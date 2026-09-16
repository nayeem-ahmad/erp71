-- Group a sign-in's refresh tokens into a family, so a replay revokes one
-- session rather than the account.
--
-- `RefreshTokenService.rotate` treats a second use of an already-exchanged token
-- as a replay and revoked *every* token the user held. That is the textbook
-- response to a stolen token, but it was also reachable by accident: any two
-- browser contexts holding a copy of the same token — a duplicated tab, a
-- restored browser session — renew on their own schedules, and the one that
-- renews second was read as an attacker and signed the person out of every
-- device they own.
--
-- With a family id the blast radius is one sign-in. The token minted at login
-- starts a family and every rotation carries it forward, so revoking the family
-- ends that browser's session and leaves the phone alone.
--
-- Nullable on purpose. Production applies schema with `prisma db push` (see
-- apps/backend/Dockerfile), and adding a NOT NULL column to a populated table
-- needs a default the Prisma schema cannot express portably. A token issued
-- before this migration therefore has no family, and the service reads that as
-- "its own family" — it can revoke only itself, which is the conservative end of
-- the trade. Every token issued afterwards carries one, and the last of the
-- null rows expires within JWT_REFRESH_TTL_DAYS (30 by default) of the deploy.
ALTER TABLE "RefreshToken" ADD COLUMN "family_id" TEXT;

CREATE INDEX "RefreshToken_family_id_idx" ON "RefreshToken"("family_id");
