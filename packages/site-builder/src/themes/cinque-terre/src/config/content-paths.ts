/**
 * Content Path Resolution Utilities
 *
 * Provides consistent path resolution for content directories across all Astro pages.
 * Uses environment variables when available, otherwise searches common relative paths.
 */

import fs from 'fs';
import path from 'path';

/**
 * Resolve the pages content directory
 * Tries environment variable first, then searches common relative paths
 */
export function resolveContentDir(): string {
  if (process.env.CONTENT_DIR) {
    return process.env.CONTENT_DIR;
  }

  const possiblePaths = [
    path.join(process.cwd(), 'cinqueterre.travel', 'content', 'pages'),
    path.join(process.cwd(), '..', 'cinqueterre.travel', 'content', 'pages'),
    path.join(process.cwd(), '..', '..', 'cinqueterre.travel', 'content', 'pages'),
    path.join(process.cwd(), '..', '..', '..', 'cinqueterre.travel', 'content', 'pages'),
    path.join(process.cwd(), '..', '..', '..', '..', 'cinqueterre.travel', 'content', 'pages'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return possiblePaths[0];
}

/**
 * Resolve the root content directory (parent of pages, collections, config, blog)
 * Tries environment variable first, then searches common relative paths
 */
export function resolveContentRoot(): string {
  if (process.env.CONTENT_ROOT) {
    return process.env.CONTENT_ROOT;
  }

  const possiblePaths = [
    path.join(process.cwd(), 'cinqueterre.travel', 'content'),
    path.join(process.cwd(), '..', 'cinqueterre.travel', 'content'),
    path.join(process.cwd(), '..', '..', 'cinqueterre.travel', 'content'),
    path.join(process.cwd(), '..', '..', '..', 'cinqueterre.travel', 'content'),
    path.join(process.cwd(), '..', '..', '..', '..', 'cinqueterre.travel', 'content'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return possiblePaths[0];
}

/**
 * Resolve the collections directory
 * Tries environment variable first, then uses content root
 */
export function resolveCollectionsDir(): string {
  if (process.env.COLLECTIONS_DIR) {
    return process.env.COLLECTIONS_DIR;
  }

  return path.join(resolveContentRoot(), 'collections');
}

/**
 * Resolve the blog content directory
 * Tries environment variable first, then uses content root
 */
export function resolveBlogDir(): string {
  if (process.env.BLOG_DIR) {
    return process.env.BLOG_DIR;
  }

  return path.join(resolveContentRoot(), 'blog');
}

// Export resolved paths for direct use
export const CONTENT_DIR = resolveContentDir();
export const CONTENT_ROOT = resolveContentRoot();
export const COLLECTIONS_DIR = resolveCollectionsDir();
export const BLOG_DIR = resolveBlogDir();
