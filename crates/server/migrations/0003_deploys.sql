-- Gateway pull requests after the draft: finalise, merge, deploy, close
-- (ADR-0061 decisions 6 to 8).
--
-- A gateway pull request now has a life after `merged_sha`:
--
--   open ──merge──► pending ──a deployment at or after it succeeds──► landed
--     │                 └──its deployment fails, or none is seen──► failed ──a later one succeeds──► landed
--     └──close──► closed
--
-- Plain SQLite subset (ADR-0041): integers are unix milliseconds, no CHECK on
-- the added columns (the values are written by `db/gateway.rs` only).

-- When the squash merge was recorded (the server's clock). Deploys are mapped
-- "at or before": a successful deployment of the merge at `merged_at = T`
-- lands every unlanded merge of the same repository with `merged_at <= T`.
ALTER TABLE gateway_prs ADD COLUMN merged_at INTEGER;
-- When a deployment that contains the merge was observed to succeed.
ALTER TABLE gateway_prs ADD COLUMN landed_at INTEGER;
-- NULL until merged; then 'pending', 'landed' or 'failed'. 'unknown' marks
-- pull requests merged before this migration: nobody watched their deploy.
ALTER TABLE gateway_prs ADD COLUMN deploy_state TEXT;
-- Why a deployment failed, or which commit's deployment landed the merge.
ALTER TABLE gateway_prs ADD COLUMN deploy_detail TEXT;
-- When the poller last asked GitHub about this merge.
ALTER TABLE gateway_prs ADD COLUMN deploy_checked_at INTEGER;
-- When the pull request was closed without a merge (POST /api/gateway/close).
ALTER TABLE gateway_prs ADD COLUMN closed_at INTEGER;
-- The branch head after the gateway's own finalise commits (base merged in,
-- page published, story listed). `head_sha` stays the reviewed head, so a
-- retried merge can tell its own commits from a head somebody else moved.
ALTER TABLE gateway_prs ADD COLUMN final_head TEXT;

UPDATE gateway_prs
   SET merged_at = updated_at, deploy_state = 'unknown'
 WHERE merged_sha IS NOT NULL;

CREATE INDEX gateway_prs_deploy_idx ON gateway_prs (deploy_state, merged_at);
CREATE INDEX gateway_prs_path_idx ON gateway_prs (company_id, path);
