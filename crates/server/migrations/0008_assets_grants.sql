-- Asset bytes in object storage (ADR-0050, plan M3): one row per company and digest; the bytes
-- live under `c/{company}/sha256/{hash}` in the object store, never in SQLite.
CREATE TABLE assets (
  company_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, sha256)
);

-- The hosts a company's WordPress may reach through the fetch proxy (ADR-0084 §2): granted by the
-- lease holder, checked on every `POST /web/wp-request`.
CREATE TABLE web_grants (
  company_id TEXT NOT NULL,
  host TEXT NOT NULL,
  granted_at INTEGER NOT NULL,
  PRIMARY KEY (company_id, host)
);
