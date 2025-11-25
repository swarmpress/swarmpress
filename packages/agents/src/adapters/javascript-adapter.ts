/**
 * JavaScript Tool Adapter
 * Executes user-defined JavaScript code in a secure vm2 sandbox
 *
 * Security model:
 * - Code runs in vm2 sandbox with strict isolation
 * - No access to Node internals (fs, process, child_process, etc.)
 * - Only whitelisted API surface available (api.rest, api.graphql, api.log, etc.)
 * - Timeout enforcement (default 5s, max 30s)
 * - Input/output validation via JSON Schema
 */

import { VM, VMScript } from 'vm2'
import Ajv from 'ajv'
import type { JavaScriptToolConfig, JavaScriptManifest } from '@swarm-press/shared'
import { BaseToolAdapter, type AdapterResult } from './base-adapter'
import { createSandboxAPI } from './sandbox-api'

const ajv = new Ajv({ allErrors: true })

/**
 * JavaScript Tool Adapter
 * Executes user-defined JavaScript in a secure sandbox
 */
export class JavaScriptToolAdapter extends BaseToolAdapter {
  readonly type = 'javascript' as const

  private code: string = ''
  private compiledScript: VMScript | null = null
  private inputSchema: Record<string, unknown> | null = null
  private outputSchema: Record<string, unknown> | null = null
  private timeout: number = 5000
  private allowAsync: boolean = true

  protected async doInitialize(): Promise<void> {
    if (!this.config) {
      throw new Error('JavaScript tool requires configuration')
    }

    const jsConfig = this.config.config as JavaScriptToolConfig

    if (!jsConfig.code) {
      throw new Error('JavaScript tool requires code in config')
    }

    this.code = jsConfig.code
    this.timeout = Math.min(jsConfig.timeout || 5000, 30000) // Max 30 seconds
    this.allowAsync = jsConfig.allowAsync !== false

    // Convert manifest to JSON Schema for validation
    if (jsConfig.manifest?.input) {
      this.inputSchema = this.manifestToJsonSchema(jsConfig.manifest.input)
    }
    if (jsConfig.manifest?.output) {
      this.outputSchema = this.manifestToJsonSchema(jsConfig.manifest.output)
    }

    // Pre-compile the script for faster execution
    // Wrap code in async function if async is allowed
    const wrappedCode = this.allowAsync
      ? `(async () => { ${this.code} })()`
      : `(() => { ${this.code} })()`

    try {
      this.compiledScript = new VMScript(wrappedCode, {
        filename: `${this.config.name}.js`,
      })
    } catch (error) {
      throw new Error(
        `Failed to compile JavaScript: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }

    console.log(
      `[JavaScriptAdapter] Initialized tool "${this.config.name}" with ${this.code.length} bytes of code`
    )
  }

  async execute(input: unknown): Promise<AdapterResult> {
    if (!this.isReady() || !this.compiledScript) {
      return {
        success: false,
        error: 'JavaScript adapter not initialized',
      }
    }

    // Validate input
    if (this.inputSchema) {
      const validate = ajv.compile(this.inputSchema)
      if (!validate(input)) {
        return {
          success: false,
          error: `Input validation failed: ${ajv.errorsText(validate.errors)}`,
        }
      }
    }

    const logs: string[] = []
    const sandboxAPI = createSandboxAPI({
      secrets: this.secrets,
      toolName: this.config?.name || 'unknown',
      logs,
    })

    try {
      const vm = new VM({
        timeout: this.timeout,
        allowAsync: this.allowAsync,
        sandbox: {
          input,
          api: sandboxAPI,
          console: { log: sandboxAPI.log, info: sandboxAPI.log, warn: sandboxAPI.log },
        },
        eval: false,
        wasm: false,
      })

      const result = await vm.run(this.compiledScript)

      // Validate output
      if (this.outputSchema && result !== undefined) {
        const validate = ajv.compile(this.outputSchema)
        if (!validate(result)) {
          return {
            success: false,
            error: `Output validation failed: ${ajv.errorsText(validate.errors)}`,
            data: { logs, partialResult: result },
          }
        }
      }

      return {
        success: true,
        data: result,
        ...(logs.length > 0 && { logs }),
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[JavaScriptAdapter] Execution failed:`, errorMessage)

      // Check for specific error types
      if (errorMessage.includes('Script execution timed out')) {
        return {
          success: false,
          error: `JavaScript execution timed out after ${this.timeout}ms`,
          data: { logs },
        }
      }

      return {
        success: false,
        error: `JavaScript execution failed: ${errorMessage}`,
        data: { logs },
      }
    }
  }

  async dispose(): Promise<void> {
    await super.dispose()
    this.code = ''
    this.compiledScript = null
    this.inputSchema = null
    this.outputSchema = null
  }

  /**
   * Convert manifest format to JSON Schema
   * Manifest format: { fieldName: { type: "string", required: true, description: "..." } }
   * JSON Schema format: { type: "object", properties: {...}, required: [...] }
   */
  private manifestToJsonSchema(
    manifest: JavaScriptManifest['input'] | NonNullable<JavaScriptManifest['output']>
  ): Record<string, unknown> {
    const properties: Record<string, unknown> = {}
    const required: string[] = []

    for (const [key, field] of Object.entries(manifest)) {
      properties[key] = {
        type: field.type,
        ...(field.description && { description: field.description }),
      }
      if (field.required) {
        required.push(key)
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length > 0 && { required }),
    }
  }
}
