'use client'

import { useState, useEffect } from 'react'
import type { InlinePrompt, PageAIHints } from '@swarm-press/shared'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Slider } from '../ui/slider'
import { X, Plus } from 'lucide-react'

interface PromptsEditorProps {
  prompts?: InlinePrompt
  aiHints?: PageAIHints
  onChange: (prompts: InlinePrompt | undefined, aiHints?: PageAIHints) => void
}

export function PromptsEditor({ prompts, aiHints, onChange }: PromptsEditorProps) {
  const [localPrompts, setLocalPrompts] = useState<InlinePrompt>(prompts || {})
  const [localHints, setLocalHints] = useState<PageAIHints>(aiHints || {})
  const [newKeyword, setNewKeyword] = useState('')

  // Update local state when props change
  useEffect(() => {
    setLocalPrompts(prompts || {})
    setLocalHints(aiHints || {})
  }, [prompts, aiHints])

  const handlePromptChange = (field: keyof InlinePrompt, value: any) => {
    const updated = { ...localPrompts, [field]: value || undefined }
    // Clean up undefined/empty fields
    Object.keys(updated).forEach((key) => {
      const val = updated[key as keyof InlinePrompt]
      if (val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
        delete updated[key as keyof InlinePrompt]
      }
    })
    setLocalPrompts(updated)
    onChange(Object.keys(updated).length > 0 ? updated : undefined, localHints)
  }

  const handleHintChange = (field: keyof PageAIHints, value: any) => {
    const updated = { ...localHints, [field]: value || undefined }
    // Clean up undefined/empty fields
    Object.keys(updated).forEach((key) => {
      const val = updated[key as keyof PageAIHints]
      if (val === undefined || val === '' || (Array.isArray(val) && val.length === 0)) {
        delete updated[key as keyof PageAIHints]
      }
    })
    setLocalHints(updated)
    onChange(localPrompts, Object.keys(updated).length > 0 ? updated : undefined)
  }

  const addKeyword = () => {
    if (newKeyword.trim()) {
      const currentKeywords = localPrompts.keywords || []
      if (!currentKeywords.includes(newKeyword.trim())) {
        handlePromptChange('keywords', [...currentKeywords, newKeyword.trim()])
      }
      setNewKeyword('')
    }
  }

  const removeKeyword = (keyword: string) => {
    const currentKeywords = localPrompts.keywords || []
    handlePromptChange('keywords', currentKeywords.filter((k) => k !== keyword))
  }

  return (
    <div className="space-y-6">
      {/* AI Purpose */}
      <div className="space-y-2">
        <Label htmlFor="purpose" className="text-xs font-medium">
          Purpose
        </Label>
        <p className="text-[10px] text-muted-foreground">
          What should this section accomplish?
        </p>
        <textarea
          id="purpose"
          value={localHints.purpose || ''}
          onChange={(e) => handleHintChange('purpose', e.target.value)}
          className="w-full h-16 px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g., Introduce visitors to the five villages of Cinque Terre..."
        />
      </div>

      {/* Writing Prompt */}
      <div className="space-y-2">
        <Label htmlFor="writingPrompt" className="text-xs font-medium">
          Writing Prompt
        </Label>
        <p className="text-[10px] text-muted-foreground">
          Instructions for the AI writer
        </p>
        <textarea
          id="writingPrompt"
          value={localPrompts.writingPrompt || ''}
          onChange={(e) => handlePromptChange('writingPrompt', e.target.value)}
          className="w-full h-24 px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Write compelling copy that highlights the unique character of each village..."
        />
      </div>

      {/* Tone Selection */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Tone</Label>
        <Select
          value={localPrompts.tone || ''}
          onValueChange={(value) => handlePromptChange('tone', value)}
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select tone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="professional">Professional</SelectItem>
            <SelectItem value="casual">Casual</SelectItem>
            <SelectItem value="friendly">Friendly</SelectItem>
            <SelectItem value="authoritative">Authoritative</SelectItem>
            <SelectItem value="inspirational">Inspirational</SelectItem>
            <SelectItem value="informative">Informative</SelectItem>
            <SelectItem value="welcoming">Welcoming</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Perspective */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">Perspective</Label>
        <Select
          value={localPrompts.perspective || ''}
          onValueChange={(value) =>
            handlePromptChange(
              'perspective',
              value as 'first_person' | 'second_person' | 'third_person'
            )
          }
        >
          <SelectTrigger className="h-8 text-sm">
            <SelectValue placeholder="Select perspective" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="first_person">First Person (We, Our)</SelectItem>
            <SelectItem value="second_person">Second Person (You, Your)</SelectItem>
            <SelectItem value="third_person">Third Person (They, It)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Word Count Range */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Word Count Range</Label>
          <span className="text-xs text-muted-foreground">
            {localPrompts.minWordCount || 50} - {localPrompts.maxWordCount || 500} words
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Min</Label>
            <Input
              type="number"
              min={0}
              max={localPrompts.maxWordCount || 1000}
              value={localPrompts.minWordCount || ''}
              onChange={(e) =>
                handlePromptChange('minWordCount', parseInt(e.target.value) || undefined)
              }
              className="h-8 text-sm"
              placeholder="50"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Max</Label>
            <Input
              type="number"
              min={localPrompts.minWordCount || 0}
              value={localPrompts.maxWordCount || ''}
              onChange={(e) =>
                handlePromptChange('maxWordCount', parseInt(e.target.value) || undefined)
              }
              className="h-8 text-sm"
              placeholder="500"
            />
          </div>
        </div>
      </div>

      {/* Keywords */}
      <div className="space-y-2">
        <Label className="text-xs font-medium">SEO Keywords</Label>
        <p className="text-[10px] text-muted-foreground">
          Keywords to naturally include in the content
        </p>
        <div className="flex gap-2">
          <Input
            value={newKeyword}
            onChange={(e) => setNewKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addKeyword())}
            className="h-8 text-sm flex-1"
            placeholder="Add keyword..."
          />
          <Button size="sm" variant="outline" onClick={addKeyword}>
            <Plus className="h-3 w-3" />
          </Button>
        </div>
        {localPrompts.keywords && localPrompts.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {localPrompts.keywords.map((keyword) => (
              <Badge
                key={keyword}
                variant="secondary"
                className="text-xs flex items-center gap-1"
              >
                {keyword}
                <button
                  onClick={() => removeKeyword(keyword)}
                  className="ml-1 hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Audience */}
      <div className="space-y-2">
        <Label htmlFor="audience" className="text-xs font-medium">
          Target Audience
        </Label>
        <Input
          id="audience"
          value={localHints.audience || ''}
          onChange={(e) => handleHintChange('audience', e.target.value)}
          className="h-8 text-sm"
          placeholder="e.g., Travelers interested in Italian coastal towns..."
        />
      </div>

      {/* Style Guide */}
      <div className="space-y-2">
        <Label htmlFor="style" className="text-xs font-medium">
          Style Guidelines
        </Label>
        <textarea
          id="style"
          value={localHints.style || ''}
          onChange={(e) => handleHintChange('style', e.target.value)}
          className="w-full h-16 px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="e.g., Use vivid descriptions, include sensory details..."
        />
      </div>
    </div>
  )
}
