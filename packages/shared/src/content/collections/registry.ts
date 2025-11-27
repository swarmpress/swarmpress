/**
 * Collection Registry System
 * Provides utilities for working with base collections
 *
 * Note: Website-specific collections are loaded from the database.
 * Use the collection repository for dynamic collection operations.
 */

import { z } from 'zod'
import {
  BASE_COLLECTION_TYPES,
  BaseCollectionType,
  isBaseCollectionType,
  getBaseCollectionType,
} from './index'
import { EventSchema, CreateEventSchema, type Event } from './event'
import { POISchema, CreatePOISchema, type POI } from './poi'
import { FAQSchema, CreateFAQSchema, type FAQ } from './faq'
import { NewsSchema, CreateNewsSchema, type News } from './news'

// =============================================================================
// COLLECTION DATA TYPES (Base collections only)
// =============================================================================

/**
 * Union type of base collection data types
 */
export type BaseCollectionData = Event | POI | FAQ | News

/**
 * Map base collection type string to TypeScript type
 */
export type BaseCollectionDataType<T extends BaseCollectionType> =
  T extends 'events' ? Event :
  T extends 'pois' ? POI :
  T extends 'faqs' ? FAQ :
  T extends 'news' ? News :
  never

// =============================================================================
// VALIDATION (Base collections only)
// =============================================================================

/**
 * Validate base collection data against its schema
 */
export function validateBaseCollectionData<T extends BaseCollectionType>(
  collectionType: T,
  data: unknown
): { success: true; data: BaseCollectionDataType<T> } | { success: false; error: z.ZodError } {
  const collectionDef = getBaseCollectionType(collectionType)

  const result = collectionDef.schema.safeParse(data)

  if (result.success) {
    return { success: true, data: result.data as BaseCollectionDataType<T> }
  } else {
    return { success: false, error: result.error }
  }
}

/**
 * Validate base collection data for creation
 */
export function validateCreateBaseCollectionData<T extends BaseCollectionType>(
  collectionType: T,
  data: unknown
): { success: true; data: unknown } | { success: false; error: z.ZodError } {
  const collectionDef = getBaseCollectionType(collectionType)

  const result = collectionDef.createSchema.safeParse(data)

  if (result.success) {
    return { success: true, data: result.data }
  } else {
    return { success: false, error: result.error }
  }
}

/**
 * Get the appropriate schema for a base collection type
 */
export function getBaseCollectionSchema(collectionType: BaseCollectionType) {
  switch (collectionType) {
    case 'events':
      return EventSchema
    case 'pois':
      return POISchema
    case 'faqs':
      return FAQSchema
    case 'news':
      return NewsSchema
    default:
      throw new Error(`Unknown base collection type: ${collectionType}`)
  }
}

/**
 * Get the create schema for a base collection type
 */
export function getCreateBaseCollectionSchema(collectionType: BaseCollectionType) {
  switch (collectionType) {
    case 'events':
      return CreateEventSchema
    case 'pois':
      return CreatePOISchema
    case 'faqs':
      return CreateFAQSchema
    case 'news':
      return CreateNewsSchema
    default:
      throw new Error(`Unknown base collection type: ${collectionType}`)
  }
}

// =============================================================================
// FIELD METADATA
// =============================================================================

/**
 * Get field metadata for a base collection type
 */
export function getBaseFieldMetadata(collectionType: BaseCollectionType) {
  const collectionDef = getBaseCollectionType(collectionType)
  return collectionDef.fieldMetadata
}

// =============================================================================
// COLLECTION INFO
// =============================================================================

/**
 * Get display information for a base collection type
 */
export function getBaseCollectionInfo(collectionType: BaseCollectionType) {
  const collectionDef = getBaseCollectionType(collectionType)
  return {
    type: collectionDef.type,
    displayName: collectionDef.displayName,
    singularName: collectionDef.singularName,
    icon: collectionDef.icon,
    color: collectionDef.color,
    description: collectionDef.description,
  }
}

/**
 * Get all base collection types with their info
 */
export function getAllBaseCollectionInfo() {
  return Object.keys(BASE_COLLECTION_TYPES).map(type =>
    getBaseCollectionInfo(type as BaseCollectionType)
  )
}

// =============================================================================
// SLUG GENERATION
// =============================================================================

/**
 * Generate a URL-friendly slug from a title
 */
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars (except spaces and hyphens)
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single hyphen
    .replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
}

/**
 * Validate a slug format
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug)
}

// =============================================================================
// SCHEMA UTILITIES
// =============================================================================

/**
 * Extract required fields from a base schema
 */
export function getRequiredFields(collectionType: BaseCollectionType): string[] {
  const schema = getBaseCollectionSchema(collectionType)
  const shape = schema._def.shape()

  const required: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    if (value instanceof z.ZodType) {
      if (!value.isOptional()) {
        required.push(key)
      }
    }
  }

  return required
}

/**
 * Extract optional fields from a base schema
 */
export function getOptionalFields(collectionType: BaseCollectionType): string[] {
  const schema = getBaseCollectionSchema(collectionType)
  const shape = schema._def.shape()

  const optional: string[] = []

  for (const [key, value] of Object.entries(shape)) {
    if (value instanceof z.ZodType) {
      if (value.isOptional()) {
        optional.push(key)
      }
    }
  }

  return optional
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Format validation errors for display
 */
export function formatValidationErrors(error: z.ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {}

  for (const issue of error.issues) {
    const path = issue.path.join('.')
    if (!formatted[path]) {
      formatted[path] = []
    }
    formatted[path].push(issue.message)
  }

  return formatted
}

/**
 * Get a human-readable error message from validation errors
 */
export function getValidationErrorMessage(error: z.ZodError): string {
  const formatted = formatValidationErrors(error)
  const messages = Object.entries(formatted).map(
    ([field, errors]) => `${field}: ${errors.join(', ')}`
  )
  return messages.join('; ')
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  BASE_COLLECTION_TYPES,
  BaseCollectionType,
  isBaseCollectionType,
  getBaseCollectionType,
}
