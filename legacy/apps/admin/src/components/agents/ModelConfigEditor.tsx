'use client'

import * as React from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { ModelConfig } from '@swarm-press/shared'

// ============================================================================
// Types
// ============================================================================

export interface ModelConfigEditorProps {
  value?: ModelConfig
  onChange: (config: ModelConfig) => void
  roleType?: string // For role-specific defaults
}

// Internal type with required values for UI state
interface ResolvedModelConfig {
  model: string
  temperature: number
  max_tokens: number
  top_p?: number
}

// Model options with descriptions
const MODELS = [
  {
    id: 'claude-sonnet-4-5-20250929',
    name: 'Claude Sonnet 4.5',
    description: 'Best balance of speed and intelligence',
    contextWindow: '200K',
    costPerMToken: { input: 3.0, output: 15.0 },
  },
  {
    id: 'claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet',
    description: 'Previous generation, high quality',
    contextWindow: '200K',
    costPerMToken: { input: 3.0, output: 15.0 },
  },
  {
    id: 'claude-3-opus-20240229',
    name: 'Claude 3 Opus',
    description: 'Highest capability, slower',
    contextWindow: '200K',
    costPerMToken: { input: 15.0, output: 75.0 },
  },
  {
    id: 'claude-3-haiku-20240307',
    name: 'Claude 3 Haiku',
    description: 'Fastest, most economical',
    contextWindow: '200K',
    costPerMToken: { input: 0.25, output: 1.25 },
  },
] as const

// Role-specific default configurations
const ROLE_DEFAULTS: Record<string, Partial<ModelConfig>> = {
  writer: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.9,
    max_tokens: 8192,
  },
  editor: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.4,
    max_tokens: 4096,
  },
  engineering: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.2,
    max_tokens: 4096,
  },
  ceo_assistant: {
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0.5,
    max_tokens: 4096,
  },
}

// Temperature presets
const TEMPERATURE_PRESETS = [
  { value: 0.0, label: 'Deterministic', description: 'Always picks most likely token' },
  { value: 0.2, label: 'Low', description: 'Very focused, consistent output' },
  { value: 0.5, label: 'Balanced', description: 'Good mix of creativity and focus' },
  { value: 0.8, label: 'Creative', description: 'More varied, creative output' },
  { value: 1.0, label: 'High', description: 'Maximum variety, more random' },
] as const

// ============================================================================
// Component
// ============================================================================

export function ModelConfigEditor({
  value,
  onChange,
  roleType,
}: ModelConfigEditorProps) {
  // Get defaults based on role type
  const defaults = roleType
    ? ROLE_DEFAULTS[roleType.toLowerCase()] || ROLE_DEFAULTS.writer
    : ROLE_DEFAULTS.writer

  // Merge with current value (resolved to have required values for UI)
  const config: ResolvedModelConfig = {
    model: value?.model || defaults.model || 'claude-sonnet-4-5-20250929',
    temperature: value?.temperature ?? defaults.temperature ?? 0.7,
    max_tokens: value?.max_tokens ?? defaults.max_tokens ?? 4096,
    top_p: value?.top_p,
  }

  // Find current model info
  const currentModel = MODELS.find((m) => m.id === config.model) || MODELS[0]

  // Estimate cost per call based on max tokens
  const estimatedCost = React.useMemo(() => {
    const inputCost = (config.max_tokens / 1_000_000) * currentModel.costPerMToken.input
    const outputCost = (config.max_tokens / 1_000_000) * currentModel.costPerMToken.output
    return (inputCost + outputCost).toFixed(4)
  }, [config.max_tokens, currentModel])

  // Update handler
  const updateConfig = (updates: Partial<ModelConfig>) => {
    onChange({ ...config, ...updates })
  }

  // Get closest temperature preset
  const closestPreset = TEMPERATURE_PRESETS.reduce((prev, curr) =>
    Math.abs(curr.value - config.temperature) < Math.abs(prev.value - config.temperature)
      ? curr
      : prev
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Model Configuration</CardTitle>
        <CardDescription>
          Configure the Claude model and sampling parameters for this agent
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Model Selection */}
        <div className="space-y-2">
          <Label htmlFor="model">Model</Label>
          <Select
            value={config.model}
            onValueChange={(model) => updateConfig({ model })}
          >
            <SelectTrigger id="model">
              <SelectValue placeholder="Select model" />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  <div className="flex flex-col">
                    <span>{model.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {model.description} ({model.contextWindow} context)
                    </span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Cost: ${currentModel.costPerMToken.input}/MTok input, ${currentModel.costPerMToken.output}/MTok output
          </p>
        </div>

        {/* Temperature */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="temperature">Temperature</Label>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{config.temperature.toFixed(2)}</span>
              <span className="text-xs text-muted-foreground">({closestPreset.label})</span>
            </div>
          </div>
          <Slider
            id="temperature"
            min={0}
            max={1}
            step={0.05}
            value={[config.temperature]}
            onValueChange={([temperature]) => updateConfig({ temperature })}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>Deterministic</span>
            <span>Creative</span>
          </div>
          <p className="text-xs text-muted-foreground">
            {closestPreset.description}
          </p>

          {/* Temperature Presets */}
          <div className="flex flex-wrap gap-2">
            {TEMPERATURE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => updateConfig({ temperature: preset.value })}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  Math.abs(config.temperature - preset.value) < 0.01
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-secondary text-secondary-foreground border-border hover:bg-secondary/80'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Max Tokens */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="max_tokens">Max Output Tokens</Label>
            <span className="text-sm font-medium">{config.max_tokens.toLocaleString()}</span>
          </div>
          <Slider
            id="max_tokens"
            min={256}
            max={16384}
            step={256}
            value={[config.max_tokens]}
            onValueChange={([max_tokens]) => updateConfig({ max_tokens })}
          />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>256 (short)</span>
            <span>16,384 (long)</span>
          </div>
          <Input
            type="number"
            value={config.max_tokens}
            onChange={(e) => {
              const value = parseInt(e.target.value) || 4096
              updateConfig({ max_tokens: Math.min(16384, Math.max(256, value)) })
            }}
            className="w-24"
            min={256}
            max={16384}
          />
        </div>

        {/* Top P (optional) */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="top_p">Top P (Nucleus Sampling)</Label>
            <span className="text-sm font-medium">
              {config.top_p !== undefined ? config.top_p.toFixed(2) : 'Not set'}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Controls diversity via nucleus sampling. Leave unset to use default.
          </p>
          <div className="flex items-center gap-4">
            <Slider
              id="top_p"
              min={0}
              max={1}
              step={0.05}
              value={config.top_p !== undefined ? [config.top_p] : [0.9]}
              onValueChange={([top_p]) => updateConfig({ top_p })}
              disabled={config.top_p === undefined}
            />
            <button
              type="button"
              onClick={() =>
                updateConfig({ top_p: config.top_p !== undefined ? undefined : 0.9 })
              }
              className="px-2 py-1 text-xs rounded border transition-colors bg-secondary text-secondary-foreground border-border hover:bg-secondary/80"
            >
              {config.top_p !== undefined ? 'Clear' : 'Set'}
            </button>
          </div>
        </div>

        {/* Estimated Cost */}
        <div className="rounded-lg bg-muted p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Estimated Cost Per Call</span>
            <span className="text-lg font-bold">${estimatedCost}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Based on max tokens. Actual cost depends on input/output length.
          </p>
        </div>

        {/* Role Defaults */}
        {roleType && (
          <div className="pt-2 border-t">
            <button
              type="button"
              onClick={() => {
                const roleDefaults = ROLE_DEFAULTS[roleType.toLowerCase()]
                if (roleDefaults) {
                  onChange(roleDefaults as ModelConfig)
                }
              }}
              className="text-xs text-primary hover:underline"
            >
              Reset to {roleType} defaults
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default ModelConfigEditor
