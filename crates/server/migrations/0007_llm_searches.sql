-- Web searches a model call ran (ADR-0068); each is priced into `cost_micros`.
ALTER TABLE llm_jobs ADD COLUMN searches INTEGER NOT NULL DEFAULT 0;
