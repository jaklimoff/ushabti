-- A session is stored as the SHA-256 digest of its cookie, so a copy of the database holds nothing to sign in with. The cookies people hold still match.
UPDATE "sessions" SET "id" = encode(sha256(convert_to("id", 'UTF8')), 'hex');
