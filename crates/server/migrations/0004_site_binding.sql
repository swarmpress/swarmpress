-- Rebinding a company to another site repository (PATCH /api/companies/me,
-- increment G2, ADR-0047).
--
-- `gateway_prs` has no repository column: a row belongs to the repository its
-- company is bound to now, and pull request numbers are only unique within
-- one repository. A rebind therefore moves the company's settled gateway
-- pull requests (merged and landed, failed or unknown; closed) here, in the
-- same transaction as the new binding, so that a number in the new repository
-- can never meet a row of the old one. The rebind is refused while a pull
-- request is open or a merge's deployment is still pending.
--
-- Plain SQLite subset (ADR-0041). No primary key: a repository that was
-- deleted and created again under the same name restarts its numbers.

CREATE TABLE gateway_prs_retired (
    company_id         TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    -- `owner/name` the company was bound to when these were opened.
    site_repo          TEXT NOT NULL,
    site_base_branch   TEXT NOT NULL,
    number             INTEGER NOT NULL,
    content_id         TEXT NOT NULL,
    work_item          TEXT,
    path               TEXT NOT NULL,
    branch             TEXT NOT NULL,
    head_sha           TEXT NOT NULL,
    merged_sha         TEXT,
    merged_at          INTEGER,
    landed_at          INTEGER,
    deploy_state       TEXT,
    deploy_detail      TEXT,
    deploy_checked_at  INTEGER,
    closed_at          INTEGER,
    final_head         TEXT,
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    -- When the rebind moved the row here.
    retired_at         INTEGER NOT NULL
);
CREATE INDEX gateway_prs_retired_company_idx ON gateway_prs_retired (company_id, site_repo);
