/**
 * @swarm-press/shared
 *
 * Shared types, schemas, and utilities for swarm.press
 */

// Configuration
export { validateEnv, getEnv, type Env } from './config/env'

// Content Model (JSON Blocks)
export * from './content/blocks'

// Block Metadata (for agents)
export * from './content/block-metadata'

// Agent-Page Mapping
export * from './content/agent-page-mapping'

// Collection Loader
export * from './content/collection-loader'

// Collection Schemas
export * from './content/collections'

// Quality Checker
export * from './content/quality-checker'

// Domain Entity Types & Schemas
export * from './types/entities'
export * from './types/sitemap'
export * from './types/prompts'
export * from './types/tools'
export * from './types/blueprint-collections'
export * from './types/inline-prompts'
export * from './types/site-definition'
export * from './types/page-section'

// Section Registry
export * from './content/section-registry'

// Template Resolver (for collection page templates)
export * from './content/template-resolver'

// State Machines
export * from './state-machines'

// Logging and Error Tracking
export * from './logging'

// Metrics
export * from './metrics'

// Utilities
// export * from './utils'
