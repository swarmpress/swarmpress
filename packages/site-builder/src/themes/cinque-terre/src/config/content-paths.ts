/**
 * Content Path Resolution Utilities
 *
 * Provides consistent path resolution for content directories across all Astro pages.
 * Uses environment variables when available, otherwise finds the monorepo root.
 */

import fs from 'fs';
import path from 'path';

/**
 * Find the monorepo root by looking for turbo.json or pnpm-workspace.yaml
 * Walks up the directory tree from cwd until found
 */
function findMonorepoRoot(): string | null {
  let current = process.cwd();
  const root = path.parse(current).root;

  while (current !== root) {
    // Check for monorepo markers
    if (
      fs.existsSync(path.join(current, 'turbo.json')) ||
      fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))
    ) {
      return current;
    }
    current = path.dirname(current);
  }

  return null;
}

/**
 * Resolve the pages content directory
 * Tries environment variable first, then uses monorepo root
 */
export function resolveContentDir(): string {
  if (process.env.CONTENT_DIR) {
    return process.env.CONTENT_DIR;
  }

  const monorepoRoot = findMonorepoRoot();
  if (monorepoRoot) {
    const contentPath = path.join(monorepoRoot, 'cinqueterre.travel', 'content', 'pages');
    if (fs.existsSync(contentPath)) {
      return contentPath;
    }
  }

  // Fallback to cwd-relative path
  return path.join(process.cwd(), 'cinqueterre.travel', 'content', 'pages');
}

/**
 * Resolve the root content directory (parent of pages, collections, config, blog)
 * Tries environment variable first, then uses monorepo root
 */
export function resolveContentRoot(): string {
  if (process.env.CONTENT_ROOT) {
    return process.env.CONTENT_ROOT;
  }

  const monorepoRoot = findMonorepoRoot();
  if (monorepoRoot) {
    const contentPath = path.join(monorepoRoot, 'cinqueterre.travel', 'content');
    if (fs.existsSync(contentPath)) {
      return contentPath;
    }
  }

  // Fallback to cwd-relative path
  return path.join(process.cwd(), 'cinqueterre.travel', 'content');
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
