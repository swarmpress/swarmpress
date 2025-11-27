/**
 * Site Deployment
 * Handles deployment of built sites to production
 */

import { exec } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'

const execAsync = promisify(exec)

export interface DeployOptions {
  websiteId: string
  buildDir: string
  deployTarget: 'local' | 'netlify' | 's3' | 'github-pages'
  config?: Record<string, string>
}

export interface DeployResult {
  success: boolean
  url?: string
  error?: string
  deployTime?: number
}

/**
 * Deploy a built site
 */
export async function deploySite(options: DeployOptions): Promise<DeployResult> {
  const startTime = Date.now()

  try {
    console.log(`[Deployer] Starting deployment for website ${options.websiteId}`)

    let result: DeployResult

    switch (options.deployTarget) {
      case 'local':
        result = await deployLocal(options)
        break

      case 'netlify':
        result = await deployNetlify(options)
        break

      case 's3':
        result = await deployS3(options)
        break

      case 'github-pages':
        result = await deployGitHubPages(options)
        break

      default:
        return {
          success: false,
          error: `Unsupported deploy target: ${options.deployTarget}`,
        }
    }

    const deployTime = Date.now() - startTime
    result.deployTime = deployTime

    console.log(`[Deployer] Deployment completed in ${deployTime}ms`)

    return result
  } catch (error) {
    console.error('[Deployer] Deployment failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}

/**
 * Deploy to local directory (for testing)
 */
async function deployLocal(options: DeployOptions): Promise<DeployResult> {
  const outputDir = options.config?.outputDir || join(process.cwd(), 'deployed', options.websiteId)
  const distDir = join(options.buildDir, 'dist')

  console.log(`[Deployer] Copying to ${outputDir}`)

  await execAsync(`mkdir -p ${outputDir}`)
  await execAsync(`cp -r ${distDir}/* ${outputDir}/`)

  return {
    success: true,
    url: `file://${outputDir}/index.html`,
  }
}

/**
 * Deploy to Netlify
 */
async function deployNetlify(options: DeployOptions): Promise<DeployResult> {
  const distDir = join(options.buildDir, 'dist')
  const siteId = options.config?.netlify_site_id

  if (!siteId) {
    return {
      success: false,
      error: 'Netlify site ID not configured',
    }
  }

  console.log(`[Deployer] Deploying to Netlify site ${siteId}`)

  // Install Netlify CLI if not available
  try {
    await execAsync('which netlify')
  } catch {
    console.log('[Deployer] Installing Netlify CLI')
    await execAsync('npm install -g netlify-cli')
  }

  // Deploy to Netlify
  const { stdout } = await execAsync(
    `netlify deploy --prod --dir=${distDir} --site=${siteId}`,
    {
      env: {
        ...process.env,
        NETLIFY_AUTH_TOKEN: options.config?.netlify_auth_token,
      },
    }
  )

  // Extract URL from output
  const urlMatch = stdout.match(/Website URL:\s+(https?:\/\/[^\s]+)/)
  const url = urlMatch ? urlMatch[1] : undefined

  return {
    success: true,
    url,
  }
}

/**
 * Deploy to AWS S3
 */
async function deployS3(options: DeployOptions): Promise<DeployResult> {
  const distDir = join(options.buildDir, 'dist')
  const bucket = options.config?.s3_bucket

  if (!bucket) {
    return {
      success: false,
      error: 'S3 bucket not configured',
    }
  }

  console.log(`[Deployer] Deploying to S3 bucket ${bucket}`)

  // Install AWS CLI if not available
  try {
    await execAsync('which aws')
  } catch {
    return {
      success: false,
      error: 'AWS CLI not installed',
    }
  }

  // Sync to S3
  await execAsync(`aws s3 sync ${distDir} s3://${bucket}/ --delete`, {
    env: {
      ...process.env,
      AWS_ACCESS_KEY_ID: options.config?.aws_access_key_id,
      AWS_SECRET_ACCESS_KEY: options.config?.aws_secret_access_key,
      AWS_REGION: options.config?.aws_region || 'us-east-1',
    },
  })

  const url = `https://${bucket}.s3.amazonaws.com/index.html`

  return {
    success: true,
    url,
  }
}

/**
 * Deploy to GitHub Pages via API
 * Uses the backend tRPC API to deploy files
 */
async function deployGitHubPages(options: DeployOptions): Promise<DeployResult> {
  const distDir = join(options.buildDir, 'dist')
  const apiUrl = options.config?.api_url || 'http://localhost:3000'

  console.log(`[Deployer] Deploying to GitHub Pages for website ${options.websiteId}`)

  try {
    // Read all files from dist directory
    const { readdir, readFile } = await import('fs/promises')
    const files: Array<{ path: string; content: string }> = []

    async function collectFiles(dir: string, basePath: string = '') {
      const entries = await readdir(dir, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(dir, entry.name)
        const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          await collectFiles(fullPath, relativePath)
        } else {
          const content = await readFile(fullPath, 'utf-8')
          files.push({ path: relativePath, content })
        }
      }
    }

    await collectFiles(distDir)

    console.log(`[Deployer] Collected ${files.length} files for deployment`)

    // Call backend API to deploy
    const response = await fetch(`${apiUrl}/api/trpc/github.deployToPages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        json: {
          websiteId: options.websiteId,
          files,
          commitMessage: `Deploy: ${new Date().toISOString()}`,
        },
      }),
    })

    const data = await response.json()

    if (!response.ok || data.error) {
      const errorMsg = data.error?.json?.message || data.error?.message || 'Deployment failed'
      return {
        success: false,
        error: errorMsg,
      }
    }

    const result = data.result?.data?.json || data.result?.data

    return {
      success: true,
      url: result?.pagesUrl,
    }
  } catch (error) {
    console.error('[Deployer] GitHub Pages deployment failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }
  }
}
