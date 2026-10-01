-- The text side of the media & publishing plan (publishing-plan.md §6, ADR-0031)
-- and the registry of projects (publications, ADR-0029).
--
-- The plan *skeleton* (items, status, phases, todo ids and done flags) is in
-- the deterministic sim. These tables hold only text, keyed by the sim's ids
-- ("work-item-4", "todo-9", "ws-1", "goal-1"). Text never enters the sim hash.

-- One row per publication a company runs. `tracker_key` is public: it is
-- embedded in the site's tracker snippet (ADR-0032) and is not a secret.
CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    sim_project_id  TEXT NOT NULL,
    slug            TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
    name            TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
    -- Registered site host, lowercase, no scheme/port (e.g. cinqueterre.travel).
    -- Subdomains of it are accepted by the tracker collector.
    domain          TEXT CHECK (domain IS NULL OR domain ~ '^[a-z0-9.-]{1,253}$'),
    repo            TEXT,
    tracker_key     TEXT NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, sim_project_id),
    UNIQUE (company_id, slug)
);
CREATE INDEX projects_domain_idx ON projects (domain);

CREATE TABLE plan_items (
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    item_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    brief       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, item_id)
);

CREATE TABLE plan_workstreams (
    company_id     UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    workstream_id  TEXT NOT NULL,
    title          TEXT NOT NULL DEFAULT '',
    description    TEXT NOT NULL DEFAULT '',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, workstream_id)
);

CREATE TABLE plan_goals (
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    goal_id     TEXT NOT NULL,
    title       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, goal_id)
);

CREATE TABLE plan_todos (
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    todo_id     TEXT NOT NULL,
    item_id     TEXT NOT NULL,
    text        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (company_id, todo_id)
);
CREATE INDEX plan_todos_item_idx ON plan_todos (company_id, item_id);

-- The append-only thread of every work item (publishing-plan.md §2).
-- `author` is a staff id ("staff-5"), 'ceo' or 'system'. Game time is the
-- company clock when the post was appended.
CREATE TABLE plan_posts (
    id           BIGSERIAL PRIMARY KEY,
    company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    item_id      TEXT NOT NULL,
    type         TEXT NOT NULL CHECK (type IN (
                     'comment', 'handoff', 'todo-add', 'todo-done', 'review', 'question',
                     'decision', 'status', 'minutes', 'proposal', 'artifact', 'request-help')),
    author       TEXT NOT NULL CHECK (author = 'ceo' OR author = 'system' OR author ~ '^staff-[0-9]+$'),
    to_staff     TEXT,
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    text         TEXT NOT NULL DEFAULT '',
    game_day     INTEGER NOT NULL CHECK (game_day >= 0),
    game_minute  INTEGER NOT NULL CHECK (game_minute BETWEEN 0 AND 1439),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plan_posts_item_idx ON plan_posts (company_id, item_id, id);

-- Append-only: the application never updates or deletes posts, and the
-- database refuses to. The only exception is the ON DELETE CASCADE from
-- `companies` (the parent row is already gone when the cascade runs).
CREATE FUNCTION plan_posts_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'DELETE'
       AND NOT EXISTS (SELECT 1 FROM companies WHERE id = OLD.company_id) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'plan_posts is append-only (% refused)', TG_OP
        USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER plan_posts_no_update
    BEFORE UPDATE ON plan_posts
    FOR EACH ROW EXECUTE FUNCTION plan_posts_append_only();
CREATE TRIGGER plan_posts_no_delete
    BEFORE DELETE ON plan_posts
    FOR EACH ROW EXECUTE FUNCTION plan_posts_append_only();
CREATE TRIGGER plan_posts_no_truncate
    BEFORE TRUNCATE ON plan_posts
    FOR EACH STATEMENT EXECUTE FUNCTION plan_posts_append_only();
