/**
 * Collection Registry System
 * Provides utilities for working with collections
 */

import { z } from 'zod';
import {
  COLLECTION_TYPES,
  CollectionType,
  isValidCollectionType,
  getCollectionType,
} from './index';
import { EventSchema, CreateEventSchema, type Event } from './event';
import { POISchema, CreatePOISchema, type POI } from './poi';
import { FAQSchema, CreateFAQSchema, type FAQ } from './faq';
import { NewsSchema, CreateNewsSchema, type News } from './news';

// =============================================================================
// COLLECTION DATA TYPES
// =============================================================================

/**
 * Union type of all collection data types
 */
export type CollectionData = Event | POI | FAQ | News;

/**
 * Map collection type string to TypeScript type
 */
export type CollectionDataType<T extends CollectionType> =
  T extends 'events' ? Event :
  T extends 'pois' ? POI :
  T extends 'faqs' ? FAQ :
  T extends 'news' ? News :
  never;

// =============================================================================
// VALIDATION
// =============================================================================

/**
 * Validate collection data against its schema
 */
export function validateCollectionData<T extends CollectionType>(
  collectionType: T,
  data: unknown
): { success: true; data: CollectionDataType<T> } | { success: false; error: z.ZodError } {
  const collectionDef = getCollectionType(collectionType);

  const result = collectionDef.schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data as CollectionDataType<T> };
  } else {
    return { success: false, error: result.error };
  }
}

/**
 * Validate collection data for creation (omits auto-generated fields)
 */
export function validateCreateCollectionData<T extends CollectionType>(
  collectionType: T,
  data: unknown
): { success: true; data: any } | { success: false; error: z.ZodError } {
  const collectionDef = getCollectionType(collectionType);

  const result = collectionDef.createSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  } else {
    return { success: false, error: result.error };
  }
}

/**
 * Get the appropriate schema for a collection type
 */
export function getCollectionSchema(collectionType: CollectionType) {
  switch (collectionType) {
    case 'events':
      return EventSchema;
    case 'pois':
      return POISchema;
    case 'faqs':
      return FAQSchema;
    case 'news':
      return NewsSchema;
    default:
      throw new Error(`Unknown collection type: ${collectionType}`);
  }
}

/**
 * Get the create schema for a collection type
 */
export function getCreateCollectionSchema(collectionType: CollectionType) {
  switch (collectionType) {
    case 'events':
      return CreateEventSchema;
    case 'pois':
      return CreatePOISchema;
    case 'faqs':
      return CreateFAQSchema;
    case 'news':
      return CreateNewsSchema;
    default:
      throw new Error(`Unknown collection type: ${collectionType}`);
  }
}

// =============================================================================
// FIELD METADATA
// =============================================================================

/**
 * Get field metadata for a collection type
 */
export function getFieldMetadata(collectionType: CollectionType) {
  const collectionDef = getCollectionType(collectionType);
  return collectionDef.fieldMetadata;
}

/**
 * Get field metadata for a specific field
 */
export function getFieldMetadataForField(
  collectionType: CollectionType,
  fieldPath: string
) {
  const metadata = getFieldMetadata(collectionType);
  return (metadata as any)[fieldPath];
}

// =============================================================================
// COLLECTION INFO
// =============================================================================

/**
 * Get display information for a collection type
 */
export function getCollectionInfo(collectionType: CollectionType) {
  const collectionDef = getCollectionType(collectionType);
  return {
    type: collectionDef.type,
    displayName: collectionDef.displayName,
    singularName: collectionDef.singularName,
    icon: collectionDef.icon,
    color: collectionDef.color,
    description: collectionDef.description,
  };
}

/**
 * Get all collection types with their info
 */
export function getAllCollectionInfo() {
  return Object.keys(COLLECTION_TYPES).map(type =>
    getCollectionInfo(type as CollectionType)
  );
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
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing hyphens
}

/**
 * Validate a slug format
 */
export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9-]+$/.test(slug);
}

// =============================================================================
// SCHEMA UTILITIES
// =============================================================================

/**
 * Extract required fields from a schema
 */
export function getRequiredFields(collectionType: CollectionType): string[] {
  const schema = getCollectionSchema(collectionType);
  const shape = schema._def.shape();

  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    if (value instanceof z.ZodType) {
      if (!value.isOptional()) {
        required.push(key);
      }
    }
  }

  return required;
}

/**
 * Extract optional fields from a schema
 */
export function getOptionalFields(collectionType: CollectionType): string[] {
  const schema = getCollectionSchema(collectionType);
  const shape = schema._def.shape();

  const optional: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    if (value instanceof z.ZodType) {
      if (value.isOptional()) {
        optional.push(key);
      }
    }
  }

  return optional;
}

/**
 * Get default values for a collection type
 */
export function getDefaultValues(collectionType: CollectionType): Partial<CollectionData> {
  const schema = getCollectionSchema(collectionType);

  try {
    // Parse an empty object to get defaults
    const result = schema.safeParse({});
    if (result.success) {
      return result.data;
    }
  } catch (error) {
    // Ignore errors, return empty object
  }

  return {};
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Format validation errors for display
 */
export function formatValidationErrors(error: z.ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const path = issue.path.join('.');
    if (!formatted[path]) {
      formatted[path] = [];
    }
    formatted[path].push(issue.message);
  }

  return formatted;
}

/**
 * Get a human-readable error message from validation errors
 */
export function getValidationErrorMessage(error: z.ZodError): string {
  const formatted = formatValidationErrors(error);
  const messages = Object.entries(formatted).map(
    ([field, errors]) => `${field}: ${errors.join(', ')}`
  );
  return messages.join('; ');
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  COLLECTION_TYPES,
  CollectionType,
  isValidCollectionType,
  getCollectionType,
};
