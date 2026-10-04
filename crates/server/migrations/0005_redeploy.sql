-- A failed deploy can be run again: POST /api/gateway/redeploy (FEAT-085,
-- ADR-0059, ADR-0061 decision 7).
--
--   failed ──redeploy (re-run the failed jobs of the failed workflow run)──► pending ──► landed | failed
--
-- Plain SQLite subset (ADR-0041): integers are unix milliseconds, no CHECK on
-- the added columns (the values are written by `db/gateway.rs` only).

-- When the current wait for a deployment began: NULL means at `merged_at`;
-- a redeploy sets it to the time of the request, so the poller's age limit
-- (SWARMPRESS_DEPLOY_POLL_MAX_AGE_SECS) counts from there.
ALTER TABLE gateway_prs ADD COLUMN deploy_since INTEGER;
-- The commit whose deployment failed: the merge itself, or the later merge
-- whose deployment superseded it. A redeploy re-runs that commit's workflow
-- run. NULL when nothing ran (the merge timed out).
ALTER TABLE gateway_prs ADD COLUMN deploy_failed_sha TEXT;
-- How many redeploys were requested. `DeployFailed` events carry it as
-- `attempt`, so the browser can tell a new failure from a repeated event.
ALTER TABLE gateway_prs ADD COLUMN deploy_attempt INTEGER NOT NULL DEFAULT 0;
-- The workflow run attempt the last redeploy re-ran, `<run id>:<attempt>`:
-- a second request for the same failed attempt changes nothing.
ALTER TABLE gateway_prs ADD COLUMN deploy_rerun TEXT;
