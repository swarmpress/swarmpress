-- Migration: State Audit Log
-- Track all state transitions across all entities

CREATE TABLE state_audit_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

    -- Entity reference
    entity_type VARCHAR(50) NOT NULL CHECK (entity_type IN ('content_item', 'task', 'question_ticket', 'review')),
    entity_id UUID NOT NULL,

    -- Transition details
    from_state VARCHAR(100) NOT NULL,
    to_state VARCHAR(100) NOT NULL,
    event VARCHAR(100) NOT NULL,

    -- Actor information
    actor VARCHAR(100) NOT NULL, -- Role name (e.g., 'Writer', 'Editor', 'CEO')
    actor_id UUID NOT NULL, -- Agent ID or user ID

    -- Additional context
    metadata JSONB DEFAULT '{}'::jsonb,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_state_audit_entity ON state_audit_log(entity_type, entity_id);
CREATE INDEX idx_state_audit_created_at ON state_audit_log(created_at DESC);
CREATE INDEX idx_state_audit_actor ON state_audit_log(actor_id);
CREATE INDEX idx_state_audit_from_to ON state_audit_log(from_state, to_state);

-- Comments
COMMENT ON TABLE state_audit_log IS 'Audit trail of all state machine transitions';
COMMENT ON COLUMN state_audit_log.entity_type IS 'Type of entity that transitioned';
COMMENT ON COLUMN state_audit_log.entity_id IS 'ID of the entity that transitioned';
COMMENT ON COLUMN state_audit_log.from_state IS 'Previous state before transition';
COMMENT ON COLUMN state_audit_log.to_state IS 'New state after transition';
COMMENT ON COLUMN state_audit_log.event IS 'Event that triggered the transition';
COMMENT ON COLUMN state_audit_log.actor IS 'Role of the entity that triggered the transition';
COMMENT ON COLUMN state_audit_log.actor_id IS 'ID of the agent or user that triggered the transition';
COMMENT ON COLUMN state_audit_log.metadata IS 'Additional context about the transition (JSON)';
