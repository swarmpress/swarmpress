-- Migration: Add company_id to websites table for proper multi-tenancy
-- This enables each media house (tenant/company) to manage multiple websites

BEGIN;

-- Add company_id column to websites table (nullable initially)
ALTER TABLE websites
ADD COLUMN company_id UUID REFERENCES companies(id) ON DELETE CASCADE;

-- Update existing websites to link to their companies
-- This assumes websites.domain matches pattern and links to appropriate company
UPDATE websites w
SET company_id = (
  SELECT c.id
  FROM companies c
  WHERE c.name ILIKE '%' || split_part(w.domain, '.', 1) || '%'
  LIMIT 1
);

-- If no match found, link to first company (for migration safety)
UPDATE websites
SET company_id = (SELECT id FROM companies LIMIT 1)
WHERE company_id IS NULL;

-- Now make it required for future inserts
ALTER TABLE websites
ALTER COLUMN company_id SET NOT NULL;

-- Add index for performance
CREATE INDEX idx_websites_company_id ON websites(company_id);

COMMENT ON COLUMN websites.company_id IS 'Links website to its owning media house (tenant)';

COMMIT;
