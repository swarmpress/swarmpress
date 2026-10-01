'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { Textarea } from '../ui/textarea'
import { Badge } from '../ui/badge'
import { Checkbox } from '../ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select'
import { Sparkles, Loader2, X } from 'lucide-react'

// Available section types for selection
const SECTION_OPTIONS = [
  { id: 'hero', label: 'Hero Banner', description: 'Large banner with headline and CTA' },
  { id: 'features', label: 'Features', description: 'Grid of features or benefits' },
  { id: 'content', label: 'Content', description: 'Rich text content area' },
  { id: 'stats', label: 'Statistics', description: 'Key metrics and numbers' },
  { id: 'testimonials', label: 'Testimonials', description: 'Customer quotes' },
  { id: 'faq', label: 'FAQ', description: 'Frequently asked questions' },
  { id: 'cta', label: 'Call to Action', description: 'Conversion-focused section' },
  { id: 'pricing', label: 'Pricing', description: 'Pricing plans or packages' },
  { id: 'team', label: 'Team', description: 'Team member profiles' },
  { id: 'contact', label: 'Contact', description: 'Contact form or info' },
  { id: 'newsletter', label: 'Newsletter', description: 'Email signup form' },
  { id: 'logos', label: 'Logo Cloud', description: 'Partner or client logos' },
]

const TONE_OPTIONS = [
  { value: 'professional', label: 'Professional' },
  { value: 'friendly', label: 'Friendly & Approachable' },
  { value: 'inspiring', label: 'Inspiring & Motivational' },
  { value: 'informative', label: 'Informative & Educational' },
  { value: 'conversational', label: 'Conversational' },
  { value: 'luxurious', label: 'Luxurious & Premium' },
  { value: 'playful', label: 'Playful & Fun' },
]

export interface GenerateQuestionnaire {
  purpose: string
  audience: string
  keySections: string[]
  tone: string
}

interface GenerateSectionsDialogProps {
  isOpen: boolean
  onClose: () => void
  onGenerate: (questionnaire: GenerateQuestionnaire) => Promise<void>
  pageTitle: string
  pageType?: string
  isGenerating?: boolean
}

export function GenerateSectionsDialog({
  isOpen,
  onClose,
  onGenerate,
  pageTitle,
  pageType,
  isGenerating = false,
}: GenerateSectionsDialogProps) {
  const [purpose, setPurpose] = useState('')
  const [audience, setAudience] = useState('')
  const [selectedSections, setSelectedSections] = useState<string[]>(['hero', 'features', 'cta'])
  const [tone, setTone] = useState('professional')

  const handleSectionToggle = (sectionId: string) => {
    setSelectedSections((prev) =>
      prev.includes(sectionId)
        ? prev.filter((id) => id !== sectionId)
        : [...prev, sectionId]
    )
  }

  const handleGenerate = async () => {
    await onGenerate({
      purpose,
      audience,
      keySections: selectedSections,
      tone,
    })
  }

  const handleClose = () => {
    if (!isGenerating) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-purple-500" />
            Generate Sections for "{pageTitle}"
          </DialogTitle>
          <DialogDescription>
            Answer a few questions to help the AI generate the perfect section structure for your page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Purpose */}
          <div className="space-y-2">
            <Label htmlFor="purpose" className="text-sm font-medium">
              What is the purpose of this page? *
            </Label>
            <Textarea
              id="purpose"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g., Introduce our services and convert visitors into leads, showcase our portfolio and build trust..."
              rows={3}
              disabled={isGenerating}
            />
            <p className="text-xs text-muted-foreground">
              Describe what you want this page to achieve for your visitors.
            </p>
          </div>

          {/* Target Audience */}
          <div className="space-y-2">
            <Label htmlFor="audience" className="text-sm font-medium">
              Who is your target audience? *
            </Label>
            <Input
              id="audience"
              value={audience}
              onChange={(e) => setAudience(e.target.value)}
              placeholder="e.g., Small business owners, tourists visiting Cinque Terre, tech-savvy millennials..."
              disabled={isGenerating}
            />
          </div>

          {/* Tone */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Content Tone</Label>
            <Select value={tone} onValueChange={setTone} disabled={isGenerating}>
              <SelectTrigger>
                <SelectValue placeholder="Select a tone" />
              </SelectTrigger>
              <SelectContent>
                {TONE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Section Selection */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Key Sections to Include</Label>
              <span className="text-xs text-muted-foreground">
                {selectedSections.length} selected
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {SECTION_OPTIONS.map((section) => (
                <label
                  key={section.id}
                  className={`
                    flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors
                    ${selectedSections.includes(section.id)
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/20'
                      : 'border-slate-200 hover:border-slate-300 dark:border-slate-800'
                    }
                    ${isGenerating ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <Checkbox
                    checked={selectedSections.includes(section.id)}
                    onCheckedChange={() => handleSectionToggle(section.id)}
                    disabled={isGenerating}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm">{section.label}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {section.description}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Selected Preview */}
          {selectedSections.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Selected sections:</Label>
              <div className="flex flex-wrap gap-1">
                {selectedSections.map((id) => {
                  const section = SECTION_OPTIONS.find((s) => s.id === id)
                  return (
                    <Badge
                      key={id}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/10"
                      onClick={() => !isGenerating && handleSectionToggle(id)}
                    >
                      {section?.label}
                      {!isGenerating && <X className="h-3 w-3 ml-1" />}
                    </Badge>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isGenerating}>
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!purpose || !audience || selectedSections.length === 0 || isGenerating}
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate Sections
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
