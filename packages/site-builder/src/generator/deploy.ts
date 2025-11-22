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
  deployTarget: 'local' | 'netlify' | 's3'
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
