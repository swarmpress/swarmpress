/**
 * Engineering Agent
 * Builds and deploys websites
 */

import { BaseAgent, AgentConfig, AgentContext, Tool } from '../base/agent'
import { getContentItem, transitionContent } from '../base/utilities'
import type { Agent } from '@agent-press/shared'
import { events } from '@agent-press/event-bus'
import { publishWebsite, validateContent } from '@agent-press/site-builder/generator'

// ============================================================================
// Engineering Agent Tools
// ============================================================================

const ENGINEERING_TOOLS: Tool[] = [
  {
    name: 'prepare_build',
    description:
      'Prepare a website build by gathering all approved content and validating structure',
    input_schema: {
      type: 'object',
      properties: {
        website_id: {
          type: 'string',
          description: 'The ID of the website to build',
        },
        content_ids: {
          type: 'array',
          description: 'Array of content IDs to include in the build',
          items: { type: 'string' },
        },
      },
      required: ['website_id'],
    },
  },
  {
    name: 'validate_assets',
    description:
      'Validate all assets (images, videos, etc.) are accessible and properly configured',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content to validate assets for',
        },
      },
      required: ['content_id'],
    },
  },
  {
    name: 'validate_content_structure',
    description: 'Validate that content JSON blocks are properly structured',
    input_schema: {
      type: 'object',
      properties: {
        content_id: {
          type: 'string',
          description: 'The ID of the content to validate',
        },
      },
      required: ['content_id'],
    },
  },
  {
    name: 'build_site',
    description:
      'Build the static site using Astro. Generates HTML/CSS/JS from content blocks.',
    input_schema: {
      type: 'object',
      properties: {
        website_id: {
          type: 'string',
          description: 'The ID of the website to build',
        },
        build_config: {
          type: 'object',
          description: 'Build configuration options',
          properties: {
            environment: {
              type: 'string',
              enum: ['development', 'staging', 'production'],
            },
            optimize: { type: 'boolean' },
          },
        },
      },
      required: ['website_id'],
    },
  },
  {
    name: 'deploy_site',
    description: 'Deploy the built site to hosting platform',
    input_schema: {
      type: 'object',
      properties: {
        website_id: {
          type: 'string',
          description: 'The ID of the website to deploy',
        },
        environment: {
          type: 'string',
          enum: ['staging', 'production'],
          description: 'Deployment environment',
        },
      },
      required: ['website_id', 'environment'],
    },
  },
  {
    name: 'publish_site',
    description:
      'Complete publishing workflow: validate, build, and deploy site with content',
    input_schema: {
      type: 'object',
      properties: {
        website_id: {
          type: 'string',
          description: 'The ID of the website to publish',
        },
        content_id: {
          type: 'string',
          description: 'The ID of the content being published',
        },
      },
      required: ['website_id', 'content_id'],
    },
  },
]

// ============================================================================
// Engineering Agent Class
// ============================================================================

export class EngineeringAgent extends BaseAgent {
  constructor(agentData: Agent) {
    const config: AgentConfig = {
      name: agentData.name,
      role: agentData.role,
      department: agentData.department,
      capabilities: agentData.capabilities,
      tools: ENGINEERING_TOOLS,
      systemPrompt: `You are ${agentData.name}, an engineering agent at agent.press.

Your role: ${agentData.role}
Department: ${agentData.department}

Core responsibilities:
- Build static websites using Astro from JSON content blocks
- Validate content structure and assets
- Deploy sites to hosting platforms
- Ensure technical quality and performance
- Monitor build and deployment processes

Technical stack:
- Astro for static site generation
- JSON blocks as content source
- Automated build and deployment pipeline

Build process:
1. Validate content structure and assets
2. Prepare build with all required content
3. Generate static site using Astro
4. Optimize assets and performance
5. Deploy to appropriate environment
6. Verify deployment success

Quality checks:
- All content blocks are valid JSON
- All images have alt text
- All links are valid
- Assets are optimized
- Build completes without errors
- Site is accessible after deployment

Available tools:
- prepare_build: Gather and validate content for build
- validate_assets: Check all assets are accessible
- validate_content_structure: Verify JSON block structure
- build_site: Generate static site with Astro
- deploy_site: Deploy to hosting platform
- publish_site: Complete end-to-end publishing workflow`,
    }

    super(config)
  }

  protected async executeTool(
    toolName: string,
    toolInput: any,
    context: AgentContext
  ): Promise<{ content: string | object; is_error?: boolean }> {
    try {
      switch (toolName) {
        case 'prepare_build':
          return await this.prepareBuild(toolInput.website_id, toolInput.content_ids)

        case 'validate_assets':
          return await this.validateAssets(toolInput.content_id)

        case 'validate_content_structure':
          return await this.validateContentStructure(toolInput.content_id)

        case 'build_site':
          return await this.buildSite(toolInput.website_id, toolInput.build_config)

        case 'deploy_site':
          return await this.deploySite(toolInput.website_id, toolInput.environment)

        case 'publish_site':
          return await this.publishSite(
            toolInput.website_id,
            toolInput.content_id,
            context.agentId
          )

        default:
          return {
            content: `Unknown tool: ${toolName}`,
            is_error: true,
          }
      }
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : 'Tool execution failed',
        is_error: true,
      }
    }
  }

  // ============================================================================
  // Tool Implementations
  // ============================================================================

  private async prepareBuild(
    websiteId: string,
    contentIds?: string[]
  ): Promise<{ content: object }> {
    // TODO: Integrate with actual site-builder package in Phase 6
    return {
      content: {
        website_id: websiteId,
        content_count: contentIds?.length || 0,
        status: 'prepared',
        message: 'Build preparation successful (placeholder)',
      },
    }
  }

  private async validateAssets(contentId: string): Promise<{ content: object }> {
    const content = await getContentItem(contentId)
    if (!content) {
      return {
        content: { error: 'Content not found' },
      }
    }

    // Extract image blocks and validate
    const imageBlocks = content.body.filter((block: any) => block.type === 'image')
    const validationResults = imageBlocks.map((block: any) => ({
      url: block.url,
      hasAlt: !!block.alt,
      valid: !!block.url && !!block.alt,
    }))

    const allValid = validationResults.every((r: any) => r.valid)

    return {
      content: {
        valid: allValid,
        total_assets: imageBlocks.length,
        validation_results: validationResults,
        message: allValid
          ? 'All assets valid'
          : 'Some assets missing required attributes',
      },
    }
  }

  private async validateContentStructure(contentId: string): Promise<{ content: object }> {
    const content = await getContentItem(contentId)
    if (!content) {
      return {
        content: { error: 'Content not found' },
      }
    }

    // Validate JSON blocks structure
    const errors: string[] = []

    if (!Array.isArray(content.body)) {
      errors.push('Content body must be an array')
    } else {
      content.body.forEach((block: any, index: number) => {
        if (!block.type) {
          errors.push(`Block ${index}: Missing type`)
        }

        // Validate specific block types
        switch (block.type) {
          case 'image':
            if (!block.url) errors.push(`Block ${index}: Image missing url`)
            if (!block.alt) errors.push(`Block ${index}: Image missing alt text`)
            break
          case 'heading':
            if (!block.level) errors.push(`Block ${index}: Heading missing level`)
            if (!block.text) errors.push(`Block ${index}: Heading missing text`)
            break
          case 'paragraph':
            if (!block.text) errors.push(`Block ${index}: Paragraph missing text`)
            break
        }
      })
    }

    return {
      content: {
        valid: errors.length === 0,
        block_count: Array.isArray(content.body) ? content.body.length : 0,
        errors,
        message: errors.length === 0 ? 'Content structure valid' : 'Validation errors found',
      },
    }
  }

  private async buildSite(
    websiteId: string,
    buildConfig?: any
  ): Promise<{ content: object }> {
    const config = buildConfig || { environment: 'production', optimize: true }

    try {
      // Build using the actual site builder
      const result = await publishWebsite({
        websiteId,
        deployTarget: 'local',
        skipValidation: false,
      })

      if (!result.success) {
        return {
          content: {
            website_id: websiteId,
            status: 'failed',
            error: result.error,
            validation_errors: result.validationErrors,
            message: `Build failed: ${result.error}`,
          },
        }
      }

      return {
        content: {
          website_id: websiteId,
          build_config: config,
          status: 'success',
          build_time: `${result.buildTime}ms`,
          url: result.url,
          message: 'Site built successfully',
        },
      }
    } catch (error) {
      return {
        content: {
          website_id: websiteId,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
          message: 'Build failed with exception',
        },
      }
    }
  }

  private async deploySite(
    websiteId: string,
    environment: string
  ): Promise<{ content: object }> {
    // TODO: Integrate with actual deployment service in Phase 6
    const deployUrl = `https://${environment === 'production' ? 'www' : environment}.example.com`

    return {
      content: {
        website_id: websiteId,
        environment,
        status: 'deployed',
        url: deployUrl,
        deployed_at: new Date().toISOString(),
        message: `Site deployed to ${environment} (placeholder)`,
      },
    }
  }

  private async publishSite(
    websiteId: string,
    contentId: string,
    agentId: string
  ): Promise<{ content: string }> {
    // Step 1: Validate content structure
    const structureValidation = await this.validateContentStructure(contentId)
    if (!structureValidation.content.valid) {
      await events.deployFailed(contentId, 'Content structure validation failed')
      return {
        content: `Content validation failed: ${JSON.stringify(structureValidation.content.errors)}`,
      }
    }

    // Step 2: Validate assets
    const assetValidation = await this.validateAssets(contentId)
    if (!assetValidation.content.valid) {
      await events.deployFailed(contentId, 'Asset validation failed')
      return {
        content: `Asset validation failed: ${assetValidation.content.message}`,
      }
    }

    // Step 3: Build and deploy using the actual site builder
    try {
      const publishResult = await publishWebsite({
        websiteId,
        deployTarget: 'local', // MVP uses local deployment
        skipValidation: false,
      })

      if (!publishResult.success) {
        // Publish failure event
        await events.deployFailed(contentId, publishResult.error || 'Publishing failed')
        return {
          content: `Publishing failed: ${publishResult.error}${publishResult.validationErrors ? ` - ${publishResult.validationErrors.join(', ')}` : ''}`,
        }
      }

      // Step 4: Transition content to published
      await transitionContent(contentId, 'deploy_success', 'EngineeringAgent', agentId)

      // Publish success event
      await events.deploySuccess(contentId, publishResult.url!)

      return {
        content: `Site published successfully!
URL: ${publishResult.url}
Build time: ${publishResult.buildTime}ms
Deploy time: ${publishResult.deployTime}ms

The website has been built and deployed. All content is now live.`,
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      await events.deployFailed(contentId, errorMessage)
      return {
        content: `Publishing failed with exception: ${errorMessage}`,
      }
    }
  }
}
