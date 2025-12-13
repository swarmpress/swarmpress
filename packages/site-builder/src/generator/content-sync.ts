/**
 * Content Sync Module
 * Handles auto-commit to Git when content files are saved
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFile, mkdir } from 'fs/promises'
import { dirname, join, relative } from 'path'
import { existsSync } from 'fs'

const execAsync = promisify(exec)

// =============================================================================
// TYPES
// =============================================================================

export interface SyncOptions {
  /** Automatically commit changes */
  autoCommit: boolean
  /** Automatically push to remote */
  autoPush?: boolean
  /** Custom commit message */
  commitMessage?: string
  /** Git remote name (default: 'origin') */
  remote?: string
  /** Git branch name */
  branch?: string
  /** Git user name */
  userName?: string
  /** Git user email */
  userEmail?: string
}

export interface SyncResult {
  success: boolean
  action: 'saved' | 'committed' | 'pushed' | 'error'
  filePath: string
  commitHash?: string
  error?: string
}

export interface GitStatus {
  isRepo: boolean
  branch?: string
  hasChanges: boolean
  untrackedFiles: string[]
  modifiedFiles: string[]
  stagedFiles: string[]
}

// =============================================================================
// GIT HELPERS
// =============================================================================

/**
 * Check if a directory is a Git repository
 */
export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir })
    return true
  } catch {
    return false
  }
}

/**
 * Get the root directory of the Git repository
 */
export async function getGitRoot(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd: dir })
    return stdout.trim()
  } catch {
    return null
  }
}

/**
 * Get current Git status
 */
export async function getGitStatus(dir: string): Promise<GitStatus> {
  const status: GitStatus = {
    isRepo: false,
    hasChanges: false,
    untrackedFiles: [],
    modifiedFiles: [],
    stagedFiles: [],
  }

  try {
    // Check if it's a repo
    await execAsync('git rev-parse --is-inside-work-tree', { cwd: dir })
    status.isRepo = true

    // Get current branch
    const { stdout: branchOutput } = await execAsync('git branch --show-current', { cwd: dir })
    status.branch = branchOutput.trim()

    // Get status
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: dir })

    if (statusOutput.trim()) {
      status.hasChanges = true

      for (const line of statusOutput.split('\n').filter(Boolean)) {
        const code = line.substring(0, 2)
        const file = line.substring(3)

        if (code.startsWith('?')) {
          status.untrackedFiles.push(file)
        } else if (code[0] !== ' ') {
          status.stagedFiles.push(file)
        }
        if (code[1] !== ' ' && code[1] !== '?') {
          status.modifiedFiles.push(file)
        }
      }
    }
  } catch {
    // Not a repo or error
  }

  return status
}

/**
 * Configure Git user for commits
 */
async function configureGitUser(
  dir: string,
  userName: string,
  userEmail: string
): Promise<void> {
  await execAsync(`git config user.name "${userName}"`, { cwd: dir })
  await execAsync(`git config user.email "${userEmail}"`, { cwd: dir })
}

/**
 * Get the last commit hash
 */
async function getLastCommitHash(dir: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: dir })
    return stdout.trim()
  } catch {
    return null
  }
}

// =============================================================================
// SAVE AND SYNC
// =============================================================================

/**
 * Save content to a file and optionally sync to Git
 */
export async function saveAndSync(
  filePath: string,
  content: unknown,
  options: SyncOptions = { autoCommit: false }
): Promise<SyncResult> {
  const dir = dirname(filePath)

  try {
    // Ensure directory exists
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }

    // Write content (JSON stringify if object)
    const contentStr = typeof content === 'string'
      ? content
      : JSON.stringify(content, null, 2)

    await writeFile(filePath, contentStr, 'utf-8')

    // Return early if not auto-committing
    if (!options.autoCommit) {
      return {
        success: true,
        action: 'saved',
        filePath,
      }
    }

    // Check if in a Git repo
    const gitRoot = await getGitRoot(dir)
    if (!gitRoot) {
      return {
        success: true,
        action: 'saved',
        filePath,
      }
    }

    // Configure Git user if provided
    if (options.userName && options.userEmail) {
      await configureGitUser(gitRoot, options.userName, options.userEmail)
    }

    // Get relative path for commit
    const relativePath = relative(gitRoot, filePath)

    // Stage the file
    await execAsync(`git add "${relativePath}"`, { cwd: gitRoot })

    // Create commit message
    const commitMessage = options.commitMessage ||
      `Update ${relativePath.split('/').pop()}\n\nAuto-committed by swarm.press`

    // Commit
    try {
      await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: gitRoot })
    } catch (e: any) {
      // Check if nothing to commit
      if (e.message?.includes('nothing to commit')) {
        return {
          success: true,
          action: 'saved',
          filePath,
        }
      }
      throw e
    }

    const commitHash = await getLastCommitHash(gitRoot)

    // Push if configured
    if (options.autoPush) {
      const remote = options.remote || 'origin'
      const branch = options.branch || 'main'

      try {
        await execAsync(`git push ${remote} ${branch}`, { cwd: gitRoot })
        return {
          success: true,
          action: 'pushed',
          filePath,
          commitHash: commitHash || undefined,
        }
      } catch (e: any) {
        // Push failed but commit succeeded
        return {
          success: true,
          action: 'committed',
          filePath,
          commitHash: commitHash || undefined,
          error: `Push failed: ${e.message}`,
        }
      }
    }

    return {
      success: true,
      action: 'committed',
      filePath,
      commitHash: commitHash || undefined,
    }
  } catch (error) {
    return {
      success: false,
      action: 'error',
      filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Save multiple files and commit them together
 */
export async function batchSaveAndSync(
  files: Array<{ path: string; content: unknown }>,
  options: SyncOptions = { autoCommit: false }
): Promise<{
  success: boolean
  results: SyncResult[]
  commitHash?: string
  error?: string
}> {
  const results: SyncResult[] = []
  let gitRoot: string | null = null

  try {
    // Save all files first
    for (const file of files) {
      const dir = dirname(file.path)

      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true })
      }

      const contentStr = typeof file.content === 'string'
        ? file.content
        : JSON.stringify(file.content, null, 2)

      await writeFile(file.path, contentStr, 'utf-8')

      results.push({
        success: true,
        action: 'saved',
        filePath: file.path,
      })

      // Track git root
      if (!gitRoot) {
        gitRoot = await getGitRoot(dir)
      }
    }

    // Return early if not auto-committing or no git repo
    if (!options.autoCommit || !gitRoot) {
      return {
        success: true,
        results,
      }
    }

    // Configure Git user if provided
    if (options.userName && options.userEmail) {
      await configureGitUser(gitRoot, options.userName, options.userEmail)
    }

    // Stage all files
    for (const file of files) {
      const relativePath = relative(gitRoot, file.path)
      await execAsync(`git add "${relativePath}"`, { cwd: gitRoot })
    }

    // Create commit message
    const fileCount = files.length
    const commitMessage = options.commitMessage ||
      `Update ${fileCount} file${fileCount > 1 ? 's' : ''}\n\nAuto-committed by swarm.press`

    // Commit
    try {
      await execAsync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, { cwd: gitRoot })
    } catch (e: any) {
      if (e.message?.includes('nothing to commit')) {
        return { success: true, results }
      }
      throw e
    }

    const commitHash = await getLastCommitHash(gitRoot)

    // Update results
    for (const result of results) {
      result.action = 'committed'
      result.commitHash = commitHash || undefined
    }

    // Push if configured
    if (options.autoPush) {
      const remote = options.remote || 'origin'
      const branch = options.branch || 'main'

      try {
        await execAsync(`git push ${remote} ${branch}`, { cwd: gitRoot })
        for (const result of results) {
          result.action = 'pushed'
        }
      } catch (e: any) {
        return {
          success: true,
          results,
          commitHash: commitHash || undefined,
          error: `Push failed: ${e.message}`,
        }
      }
    }

    return {
      success: true,
      results,
      commitHash: commitHash || undefined,
    }
  } catch (error) {
    return {
      success: false,
      results,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

// =============================================================================
// CONTENT-SPECIFIC HELPERS
// =============================================================================

/**
 * Save a page file and sync to Git
 */
export async function savePageAndSync(
  pagesDir: string,
  pageId: string,
  content: unknown,
  options: SyncOptions = { autoCommit: true }
): Promise<SyncResult> {
  const filePath = join(pagesDir, `${pageId}.json`)

  return saveAndSync(filePath, content, {
    ...options,
    commitMessage: options.commitMessage || `Update page: ${pageId}`,
  })
}

/**
 * Save a collection item and sync to Git
 */
export async function saveCollectionItemAndSync(
  collectionsDir: string,
  collectionType: string,
  itemId: string,
  content: unknown,
  options: SyncOptions = { autoCommit: true }
): Promise<SyncResult> {
  const filePath = join(collectionsDir, collectionType, `${itemId}.json`)

  return saveAndSync(filePath, content, {
    ...options,
    commitMessage: options.commitMessage || `Update ${collectionType}: ${itemId}`,
  })
}

// =============================================================================
// EXPORTS
// =============================================================================

export default {
  // Core functions
  saveAndSync,
  batchSaveAndSync,

  // Git helpers
  isGitRepo,
  getGitRoot,
  getGitStatus,

  // Content helpers
  savePageAndSync,
  saveCollectionItemAndSync,
}
