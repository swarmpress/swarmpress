-- Migration 001: Initial Schema
-- Creates all core tables for swarm.press
-- Run: psql $DATABASE_URL -f 001_initial_schema.sql

BEGIN;

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- ORGANIZATIONAL STRUCTURE
-- ============================================================================

-- Company (top-level organization)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Department (organizational units)
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL CHECK (name IN (
        'Editorial',
        'Writers Room',
        'SEO & Analytics',
        'Media & Design',
        'Engineering',
        'Distribution & Social',
        'Governance'
    )),
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, name)
);

-- Role (functions within departments)
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(department_id, name)
);

-- Agent (virtual employees)
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
    persona TEXT NOT NULL,
    virtual_email VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    capabilities JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- PUBLISHING INFRASTRUCTURE
-- ============================================================================

-- Website (publication surfaces)
CREATE TABLE websites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    domain VARCHAR(255) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- WebPage (routes within websites)
CREATE TABLE web_pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    slug VARCHAR(500) NOT NULL,
    template VARCHAR(255) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(website_id, slug)
);

-- ContentItem (atomic content units with JSON blocks)
CREATE TABLE content_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    page_id UUID REFERENCES web_pages(id) ON DELETE SET NULL,
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'article',
        'section',
        'hero',
        'metadata',
        'component'
    )),
    body JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    author_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    status VARCHAR(50) NOT NULL CHECK (status IN (
        'idea',
        'planned',
        'brief_created',
        'draft',
        'in_editorial_review',
        'needs_changes',
        'approved',
        'scheduled',
        'published',
        'archived'
    )),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- WORKFLOW & COLLABORATION
-- ============================================================================

-- Task (assigned work)
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'create_brief',
        'write_draft',
        'revise_draft',
        'editorial_review',
        'seo_optimization',
        'generate_media',
        'prepare_build',
        'publish_site'
    )),
    status VARCHAR(50) NOT NULL CHECK (status IN (
        'planned',
        'in_progress',
        'blocked',
        'completed',
        'cancelled'
    )),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    content_id UUID REFERENCES content_items(id) ON DELETE CASCADE,
    website_id UUID REFERENCES websites(id) ON DELETE CASCADE,
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Review (editorial decisions)
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content_id UUID NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
    reviewer_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    result VARCHAR(50) NOT NULL CHECK (result IN (
        'approved',
        'needs_changes',
        'rejected'
    )),
    comments TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- QuestionTicket (escalations)
CREATE TABLE question_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    created_by_agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    target VARCHAR(50) NOT NULL CHECK (target IN (
        'CEO',
        'ChiefEditor',
        'TechnicalLead'
    )),
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN (
        'open',
        'answered',
        'closed'
    )),
    answer_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    answer_body TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Organizational structure indexes
CREATE INDEX idx_departments_company_id ON departments(company_id);
CREATE INDEX idx_roles_department_id ON roles(department_id);
CREATE INDEX idx_agents_role_id ON agents(role_id);
CREATE INDEX idx_agents_department_id ON agents(department_id);

-- Publishing infrastructure indexes
CREATE INDEX idx_web_pages_website_id ON web_pages(website_id);
CREATE INDEX idx_content_items_website_id ON content_items(website_id);
CREATE INDEX idx_content_items_page_id ON content_items(page_id);
CREATE INDEX idx_content_items_author_agent_id ON content_items(author_agent_id);
CREATE INDEX idx_content_items_status ON content_items(status);

-- Workflow indexes
CREATE INDEX idx_tasks_agent_id ON tasks(agent_id);
CREATE INDEX idx_tasks_content_id ON tasks(content_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_reviews_content_id ON reviews(content_id);
CREATE INDEX idx_reviews_reviewer_agent_id ON reviews(reviewer_agent_id);
CREATE INDEX idx_question_tickets_created_by_agent_id ON question_tickets(created_by_agent_id);
CREATE INDEX idx_question_tickets_status ON question_tickets(status);

-- Timestamp indexes for queries by date
CREATE INDEX idx_content_items_created_at ON content_items(created_at);
CREATE INDEX idx_content_items_updated_at ON content_items(updated_at);
CREATE INDEX idx_tasks_created_at ON tasks(created_at);
CREATE INDEX idx_question_tickets_created_at ON question_tickets(created_at);

-- ============================================================================
-- TRIGGERS
-- ============================================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_departments_updated_at BEFORE UPDATE ON departments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_websites_updated_at BEFORE UPDATE ON websites
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_web_pages_updated_at BEFORE UPDATE ON web_pages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_items_updated_at BEFORE UPDATE ON content_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_reviews_updated_at BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_question_tickets_updated_at BEFORE UPDATE ON question_tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
