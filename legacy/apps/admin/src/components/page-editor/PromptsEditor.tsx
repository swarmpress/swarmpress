'use client'

import { useState, useEffect } from 'react'
import type {
  InlinePrompt,
  PageAIHints,
  ResolvedAgentAssignment,
  FieldHintsMap,
  TextFieldHint,
  MediaFieldHint,
  SectionFieldDefinition,
} from '@swarm-press/shared'
import {
  getContentFields,
  getTextFields,
  getMediaFields,
  isTextFieldType,
  isMediaFieldType,
} from '@swarm-press/shared'
import { Label } from '../ui/label'
import { Input } from '../ui/input'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar'
import { Separator } from '../ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible'
import { X, Plus, Users, Link2, PenLine, BookOpen, Image, ChevronDown, Camera } from 'lucide-react'

/**
 * Agent info for display in prompts panel
 */
export interface AssignedAgentInfo {
  departmentName: string
  agentId: string | null
  agentName?: string
  agentAvatarUrl?: string
  inherited: boolean
  fromNodeTitle?: string
}

interface PromptsEditorProps {
  prompts?: InlinePrompt
  aiHints?: PageAIHints
  onChange: (prompts: InlinePrompt | undefined, aiHints?: PageAIHints) => void
  /** Assigned agents for this page (Writer, Editor, Media) */
  assignedAgents?: AssignedAgentInfo[]
  /** Inherited perspective value from parent page */
  inheritedPerspective?: 'first_person' | 'second_person' | 'third_person'
  /** Section type for field-level hints */
  sectionType?: string
}

export function PromptsEditor({
  prompts,
  aiHints,
  onChange,
  assignedAgents,
  inheritedPerspective = 'third_person',
  sectionType,
}: PromptsEditorProps) {
  const [localPrompts, setLocalPrompts] = useState<InlinePrompt>(prompts || {})
  const [localHints, setLocalHints] = useState<PageAIHints>(aiHints || {})
  const [newKeyword, setNewKeyword] = useState('')
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())

  // Update local state when props change
  useEffect(() => {
    setLocalPrompts(prompts || {})
    setLocalHints(aiHints || {})
  }, [prompts, aiHints])

  // Get content fields for this section type
  const textFields = sectionType ? getTextFields(sectionType) : []
  const mediaFields = sectionType ? getMediaFields(sectionType) : []
  const hasContentFields = textFields.length > 0 || mediaFields.length > 0

  // Get the Writer, Editor, and Media agents from assignments
  const writerAgent = assignedAgents?.find(
    (a) => a.departmentName === 'Writers Room' || a.departmentName.toLowerCase().includes('writer')
  )
  const editorAgent = assignedAgents?.find(
    (a) => a.departmentName === 'Editorial' || a.departmentName.toLowerCase().includes('editor')
  )
  const mediaAgent = assignedAgents?.find(
    (a) => a.departmentName === 'Media Production' || a.departmentName.toLowerCase().includes('media')
  )

  // Determine effective perspective (local or inherited)
  const effectivePerspective = localPrompts.perspective || inheritedPerspective
  const isPerspectiveInherited = !localPrompts.perspective

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

  // Handle per-field hint changes
  const handleFieldHintChange = (fieldName: string, hint: TextFieldHint | MediaFieldHint | undefined) => {
    const currentHints = localPrompts.fieldHints || {}
    let updatedHints: FieldHintsMap

    if (!hint || Object.keys(hint).length === 0) {
      // Remove the hint if empty
      const { [fieldName]: _, ...rest } = currentHints
      updatedHints = rest
    } else {
      updatedHints = { ...currentHints, [fieldName]: hint }
    }

    handlePromptChange('fieldHints', Object.keys(updatedHints).length > 0 ? updatedHints : undefined)
  }

  const toggleFieldExpanded = (fieldName: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldName)) {
        next.delete(fieldName)
      } else {
        next.add(fieldName)
      }
      return next
    })
  }

  return (
    <div className="space-y-6">
      {/* Assigned Agents Section */}
      {assignedAgents && assignedAgents.length > 0 && (
        <>
          <div className="space-y-3">
            <Label className="text-xs font-medium flex items-center gap-2">
              <Users className="h-3.5 w-3.5" />
              Assigned Agents
            </Label>
            <p className="text-[10px] text-muted-foreground -mt-1">
              Content will be written and reviewed by these agents
            </p>

            <div className="space-y-2">
              {/* Writer Agent */}
              {writerAgent && (
                <div className="flex items-center gap-3 p-2 rounded-md bg-slate-50 dark:bg-slate-900">
                  <PenLine className="h-4 w-4 text-blue-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Writer</div>
                    {writerAgent.agentId ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={writerAgent.agentAvatarUrl} />
                          <AvatarFallback className="text-[8px]">
                            {writerAgent.agentName?.slice(0, 2).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground truncate">
                          {writerAgent.agentName}
                        </span>
                        {writerAgent.inherited && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            <Link2 className="h-2.5 w-2.5 mr-0.5" />
                            inherited
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Not assigned</span>
                    )}
                  </div>
                </div>
              )}

              {/* Editor Agent */}
              {editorAgent && (
                <div className="flex items-center gap-3 p-2 rounded-md bg-slate-50 dark:bg-slate-900">
                  <BookOpen className="h-4 w-4 text-purple-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Editor</div>
                    {editorAgent.agentId ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={editorAgent.agentAvatarUrl} />
                          <AvatarFallback className="text-[8px]">
                            {editorAgent.agentName?.slice(0, 2).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground truncate">
                          {editorAgent.agentName}
                        </span>
                        {editorAgent.inherited && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            <Link2 className="h-2.5 w-2.5 mr-0.5" />
                            inherited
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Not assigned</span>
                    )}
                  </div>
                </div>
              )}

              {/* Media Production Agent */}
              {mediaAgent && (
                <div className="flex items-center gap-3 p-2 rounded-md bg-slate-50 dark:bg-slate-900">
                  <Camera className="h-4 w-4 text-emerald-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium">Media</div>
                    {mediaAgent.agentId ? (
                      <div className="flex items-center gap-2 mt-0.5">
                        <Avatar className="h-5 w-5">
                          <AvatarImage src={mediaAgent.agentAvatarUrl} />
                          <AvatarFallback className="text-[8px]">
                            {mediaAgent.agentName?.slice(0, 2).toUpperCase() || '?'}
                          </AvatarFallback>
                        </Avatar>
                        <span className="text-xs text-muted-foreground truncate">
                          {mediaAgent.agentName}
                        </span>
                        {mediaAgent.inherited && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1">
                            <Link2 className="h-2.5 w-2.5 mr-0.5" />
                            inherited
                          </Badge>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground italic">Not assigned</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <p className="text-[10px] text-muted-foreground">
              Content will be written and reviewed by these agents.
              Manage assignments in the Site Editor.
            </p>
          </div>

          <Separator />
        </>
      )}

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
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">Perspective</Label>
          {isPerspectiveInherited && (
            <Badge variant="outline" className="text-[9px] h-4 px-1.5">
              <Link2 className="h-2.5 w-2.5 mr-0.5" />
              inherited
            </Badge>
          )}
        </div>
        <Select
          value={localPrompts.perspective || 'inherited'}
          onValueChange={(value) => {
            if (value === 'inherited') {
              // Remove local override to use inherited value
              handlePromptChange('perspective', undefined)
            } else {
              handlePromptChange(
                'perspective',
                value as 'first_person' | 'second_person' | 'third_person'
              )
            }
          }}
        >
          <SelectTrigger className={`h-8 text-sm ${isPerspectiveInherited ? 'border-dashed' : ''}`}>
            <SelectValue>
              {isPerspectiveInherited ? (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Link2 className="h-3 w-3" />
                  Inherited ({effectivePerspective === 'first_person' ? 'We, Our' :
                    effectivePerspective === 'second_person' ? 'You, Your' : 'They, It'})
                </span>
              ) : (
                localPrompts.perspective === 'first_person' ? 'First Person (We, Our)' :
                localPrompts.perspective === 'second_person' ? 'Second Person (You, Your)' :
                'Third Person (They, It)'
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="inherited">
              <span className="flex items-center gap-1.5">
                <Link2 className="h-3 w-3 text-muted-foreground" />
                Inherited ({inheritedPerspective === 'first_person' ? 'We, Our' :
                  inheritedPerspective === 'second_person' ? 'You, Your' : 'They, It'})
              </span>
            </SelectItem>
            <SelectItem value="first_person">First Person (We, Our)</SelectItem>
            <SelectItem value="second_person">Second Person (You, Your)</SelectItem>
            <SelectItem value="third_person">Third Person (They, It)</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[10px] text-muted-foreground">
          Default is "Third Person" unless overridden
        </p>
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

      {/* Content Fields with Per-Field Hints */}
      {hasContentFields && (
        <>
          <Separator />
          <div className="space-y-4">
            <div>
              <Label className="text-xs font-medium">Content Fields</Label>
              <p className="text-[10px] text-muted-foreground mt-1">
                Optional per-field hints for fine-grained control
              </p>
            </div>

            {/* Text Fields (Writer Agent) */}
            {textFields.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <PenLine className="h-3.5 w-3.5 text-blue-500" />
                  <span className="text-xs font-medium">Text Fields</span>
                  <span className="text-[10px] text-muted-foreground">(Writer Agent)</span>
                </div>
                <div className="space-y-1">
                  {textFields.map((field) => (
                    <TextFieldHintEditor
                      key={field.name}
                      field={field}
                      hint={(localPrompts.fieldHints?.[field.name] as TextFieldHint) || {}}
                      isExpanded={expandedFields.has(field.name)}
                      onToggle={() => toggleFieldExpanded(field.name)}
                      onChange={(hint) => handleFieldHintChange(field.name, hint)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Media Fields (Media Production Agent) */}
            {mediaFields.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Camera className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-xs font-medium">Media Fields</span>
                  <span className="text-[10px] text-muted-foreground">(Media Agent)</span>
                </div>
                <div className="space-y-1">
                  {mediaFields.map((field) => (
                    <MediaFieldHintEditor
                      key={field.name}
                      field={field}
                      hint={(localPrompts.fieldHints?.[field.name] as MediaFieldHint) || {}}
                      isExpanded={expandedFields.has(field.name)}
                      onToggle={() => toggleFieldExpanded(field.name)}
                      onChange={(hint) => handleFieldHintChange(field.name, hint)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ============================================================================
// Field Hint Editors
// ============================================================================

interface TextFieldHintEditorProps {
  field: SectionFieldDefinition
  hint: TextFieldHint
  isExpanded: boolean
  onToggle: () => void
  onChange: (hint: TextFieldHint | undefined) => void
}

function TextFieldHintEditor({
  field,
  hint,
  isExpanded,
  onToggle,
  onChange,
}: TextFieldHintEditorProps) {
  const hasHint = hint.prompt || hint.tone || hint.maxLength

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between p-2 rounded-md bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
            />
            <span className="text-xs font-medium">{field.label}</span>
            {field.required && (
              <span className="text-[10px] text-red-500">*</span>
            )}
            {hasHint && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                has hint
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{field.description}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-3 border border-t-0 rounded-b-md bg-white dark:bg-slate-950 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px]">Prompt</Label>
            <Input
              value={hint.prompt || ''}
              onChange={(e) => onChange({ ...hint, prompt: e.target.value || undefined })}
              className="h-7 text-xs"
              placeholder={`Instructions for ${field.label.toLowerCase()}...`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Tone Override</Label>
              <Input
                value={hint.tone || ''}
                onChange={(e) => onChange({ ...hint, tone: e.target.value || undefined })}
                className="h-7 text-xs"
                placeholder="e.g., casual"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Max Length</Label>
              <Input
                type="number"
                value={hint.maxLength || ''}
                onChange={(e) =>
                  onChange({ ...hint, maxLength: parseInt(e.target.value) || undefined })
                }
                className="h-7 text-xs"
                placeholder="chars"
              />
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

interface MediaFieldHintEditorProps {
  field: SectionFieldDefinition
  hint: MediaFieldHint
  isExpanded: boolean
  onToggle: () => void
  onChange: (hint: MediaFieldHint | undefined) => void
}

function MediaFieldHintEditor({
  field,
  hint,
  isExpanded,
  onToggle,
  onChange,
}: MediaFieldHintEditorProps) {
  const hasHint = hint.prompt || hint.style || hint.mood || hint.aspectRatio

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <CollapsibleTrigger className="w-full">
        <div className="flex items-center justify-between p-2 rounded-md bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
          <div className="flex items-center gap-2">
            <ChevronDown
              className={`h-3 w-3 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
            />
            <Image className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs font-medium">{field.label}</span>
            {hasHint && (
              <Badge variant="secondary" className="text-[9px] h-4 px-1">
                has hint
              </Badge>
            )}
          </div>
          <span className="text-[10px] text-muted-foreground">{field.description}</span>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="p-3 border border-t-0 rounded-b-md bg-white dark:bg-slate-950 space-y-3">
          <div className="space-y-1">
            <Label className="text-[10px]">Description</Label>
            <textarea
              value={hint.prompt || ''}
              onChange={(e) => onChange({ ...hint, prompt: e.target.value || undefined })}
              className="w-full h-14 px-2 py-1.5 text-xs border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-ring"
              placeholder={`Describe the desired ${field.label.toLowerCase()}...`}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[10px]">Style</Label>
              <Select
                value={hint.style || ''}
                onValueChange={(value) =>
                  onChange({ ...hint, style: (value || undefined) as MediaFieldHint['style'] })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Select style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="photographic">Photographic</SelectItem>
                  <SelectItem value="illustration">Illustration</SelectItem>
                  <SelectItem value="icon">Icon</SelectItem>
                  <SelectItem value="3d-render">3D Render</SelectItem>
                  <SelectItem value="artistic">Artistic</SelectItem>
                  <SelectItem value="minimal">Minimal</SelectItem>
                  <SelectItem value="stock-photo">Stock Photo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px]">Aspect Ratio</Label>
              <Select
                value={hint.aspectRatio || ''}
                onValueChange={(value) =>
                  onChange({
                    ...hint,
                    aspectRatio: (value || undefined) as MediaFieldHint['aspectRatio'],
                  })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="Select ratio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="1:1">1:1 Square</SelectItem>
                  <SelectItem value="4:3">4:3</SelectItem>
                  <SelectItem value="16:9">16:9 Widescreen</SelectItem>
                  <SelectItem value="3:2">3:2</SelectItem>
                  <SelectItem value="2:3">2:3 Portrait</SelectItem>
                  <SelectItem value="9:16">9:16 Vertical</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Mood</Label>
            <Input
              value={hint.mood || ''}
              onChange={(e) => onChange({ ...hint, mood: e.target.value || undefined })}
              className="h-7 text-xs"
              placeholder="e.g., warm, inviting, professional"
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
