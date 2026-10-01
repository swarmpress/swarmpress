-- Orchestrator state for the MVP article loop (docs/mvp.md).
-- Text and artifacts live here keyed by sim ids; the sim owns all state transitions.

-- Briefs agreed in a standup, before the sim turns them into work items.
CREATE TABLE IF NOT EXISTS briefs (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  brief_ref   BIGINT NOT NULL,                 -- opaque id carried by the sim
  job_id      BIGINT NOT NULL,                 -- the standup job that produced it
  brief       JSONB NOT NULL,                  -- agents::Brief
  writer      TEXT NOT NULL,                   -- sim staff id
  editor      TEXT NOT NULL,
  minutes     JSONB NOT NULL DEFAULT '[]',     -- standup transcript excerpt
  work_item   TEXT,                            -- set when the first draft job arrives
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, brief_ref)
);

-- Latest artifacts per work item.
CREATE TABLE IF NOT EXISTS work_item_artifacts (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  work_item   TEXT NOT NULL,
  brief_ref   BIGINT NOT NULL,
  page        JSONB,
  review      JSONB,
  revision    INT NOT NULL DEFAULT 0,
  path        TEXT,
  branch      TEXT,
  pr_number   BIGINT,
  head_sha    TEXT,
  merged_sha  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, work_item)
);

-- Meeting transcripts (ADR-0012). Wave 4 extends this with the full
-- per-utterance parameter record (ADR-0034).
CREATE TABLE IF NOT EXISTS transcripts (
  company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  job_id      BIGINT NOT NULL,
  seq         INT NOT NULL,
  speaker     TEXT NOT NULL,
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (company_id, job_id, seq)
);
