CREATE TABLE IF NOT EXISTS codes (id TEXT PRIMARY KEY, auth_hash TEXT, blob TEXT, size INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS codes_exp ON codes(expires_at);
CREATE TABLE IF NOT EXISTS attempts (k TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS attempts_k ON attempts(k, at);
-- Protection (prod + test): a code row can only be deleted when it expired more than 30 days ago (expiry policy).
CREATE TRIGGER IF NOT EXISTS protect_codes_delete BEFORE DELETE ON codes WHEN OLD.expires_at > (unixepoch() * 1000 - 30 * 86400000) BEGIN SELECT RAISE(ABORT, 'codes: only rows expired 30+ days may be deleted'); END;
-- id / created_at never change; once an auth is set it can't be replaced (no hijacking an ID).
CREATE TRIGGER IF NOT EXISTS protect_codes_update BEFORE UPDATE ON codes WHEN NEW.id IS NOT OLD.id OR NEW.created_at IS NOT OLD.created_at OR (OLD.auth_hash IS NOT NULL AND NEW.auth_hash IS NOT OLD.auth_hash) BEGIN SELECT RAISE(ABORT, 'codes: id/created_at/auth are fixed'); END;
