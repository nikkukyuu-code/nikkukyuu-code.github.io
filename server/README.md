# transfer（引き継ぎID）— Cloudflare Worker + D1
- Production: https://transfer.nikkukyuu.workers.dev — Worker `transfer`, D1 `transfer` (d13b5479-5d0e-4be1-90c6-fa080397a5b5)
- **Test (use for ALL testing): https://transfer-test.nikkukyuu.workers.dev** — Worker `transfer-test`, D1 `transfer-test` (f09fc167-c457-4bd2-a9ba-aa5d6cfacdfa).
  `transfer/transfer.js` automatically uses the test Worker when the page runs on localhost / 127.0.0.1, so local tests can never write to production.
- Source: `transfer-worker.js`, schema + protection triggers: `transfer-schema.sql`. Cron `20 15 * * *` (00:20 JST).

## How it works
1. 「引き継ぎIDを発行」: `POST /issue` reserves a unique 8-char ID (alphabet `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, no 0/O/1/I/L; shown as XXXX-XXXX). The browser makes a random 6-digit PIN.
2. Browser derives 512 bits with PBKDF2-SHA256(150k, password `ID|PIN`, salt `nk-transfer-v1|ID`): first half = AES-GCM key, second half = auth token. It encrypts the full transfer payload (all games' localStorage, same compressed format as before) and `POST /save {id, auth, blob}`. The server stores only SHA-256 of the auth token and the ciphertext — it cannot read the data.
3. Pressing 発行 again on the same device re-uploads under the **same ID/PIN** (stored in localStorage `nkTransferId` / `nkTransferPin` + `_bak`, excluded from the payload) and extends the expiry.
4. 「IDで復元」: `POST /load {id, auth}` → ciphertext → decrypt → existing merge rules (`apply()`: current data backed up to `nk-transfer-preimport`, numbers keep the max, owned things union, best times keep the faster — progress never decreases).
- Rate limits: issue 20/h/IP, save 60/h/IP; restore lockout after 5 wrong tries per ID (15 min) or 30 per IP (1 h). Wrong ID and wrong PIN give the same message.
- Expiry policy: 90 days after the last upload. Expired rows are no longer restorable; the daily cron physically removes rows only after they have been expired for 30+ more days (the delete trigger refuses anything newer).

## Protection (production)
- Trigger `protect_codes_delete`: DELETE allowed only for rows with `expires_at` older than 30 days (expiry policy). Trigger `protect_codes_update`: id / created_at never change, and an auth hash, once set, can't be replaced (nobody can take over an ID).
- No delete endpoint. Never run DELETE/DROP by hand. Daily backup: `ranking-backup` Worker also copies every transfer row changed since the last run into D1 `ranking-backup` (append-only). D1 Time Travel: 7 days on the free plan.
- See `/home/box/agent-data/workflows/ranking-production-safety/SKILL.md`.
