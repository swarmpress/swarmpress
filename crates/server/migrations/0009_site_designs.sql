-- A site's designs (ADR-0093): write-once versions of the design bundles a company's site was
-- sent (an upload, Claude's "Send to"). One row per version; the files' bytes live in the object
-- store under `c/{company}/sha256/{hash}` with an `assets` row each, the manifest (paths, digests,
-- types) is here. A site is its company today (one site per company), so `site_id` is the
-- company id. The same bundle sent twice is the same version (unique hash per site).
CREATE TABLE site_designs (
  site_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  hash TEXT NOT NULL,
  -- `upload`, `connector` or `claude-design` (the manifest has the details).
  source TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  manifest_json TEXT NOT NULL,
  PRIMARY KEY (site_id, version)
);
CREATE UNIQUE INDEX site_designs_hash_idx ON site_designs (site_id, hash);
