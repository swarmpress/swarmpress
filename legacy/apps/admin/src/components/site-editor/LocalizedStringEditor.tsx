'use client'

import { useState } from 'react'
import type { LocalizedString } from '@swarm-press/shared'
import { getLocalizedValue } from '@swarm-press/shared'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Label } from '../ui/label'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../ui/collapsible'
import { AlertCircle, ChevronDown, ChevronRight, Copy, Check } from 'lucide-react'
import { cn } from '../../lib/utils'

// Language display names
const LOCALE_NAMES: Record<string, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
  es: 'Español',
  pt: 'Português',
  nl: 'Nederlands',
  pl: 'Polski',
  ru: 'Русский',
  zh: '中文',
  ja: '日本語',
  ko: '한국어',
}

interface LocalizedStringEditorProps {
  /** The localized value to edit */
  value: LocalizedString | undefined
  /** Callback when value changes */
  onChange: (value: Record<string, string>) => void
  /** Available locales */
  locales: string[]
  /** Default locale (shown first, required) */
  defaultLocale: string
  /** Field label */
  label: string
  /** Use textarea instead of input */
  multiline?: boolean
  /** Number of rows for textarea */
  rows?: number
  /** Placeholder text */
  placeholder?: string
  /** Optional description */
  description?: string
  /** Compact mode - collapsible with only current locale visible */
  compact?: boolean
  /** Current editing locale for compact mode */
  currentLocale?: string
}

/**
 * Editor for LocalizedString values
 * Shows all configured locales with translation status indicators
 */
export function LocalizedStringEditor({
  value,
  onChange,
  locales,
  defaultLocale,
  label,
  multiline = false,
  rows = 3,
  placeholder,
  description,
  compact = false,
  currentLocale,
}: LocalizedStringEditorProps) {
  const [isExpanded, setIsExpanded] = useState(!compact)
  const [copiedLocale, setCopiedLocale] = useState<string | null>(null)

  // Convert value to object if string
  const normalizedValue: Record<string, unknown> =
    typeof value === 'string'
      ? { [defaultLocale]: value }
      : value || {}

  // Helper to safely get string value, unwrapping nested structures like { en: { en: "..." } }
  const getStringValue = (val: unknown, locale: string = defaultLocale): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>
      // Try the requested locale, then 'en', then first value
      const nested = record[locale] ?? record['en'] ?? Object.values(record)[0]
      return getStringValue(nested, locale) // Recursive unwrap
    }
    return ''
  }

  // Helper to safely check if a value is a non-empty string (unwrapping nested structures)
  const isNonEmptyString = (val: unknown, locale: string = defaultLocale): boolean => {
    const str = getStringValue(val, locale)
    return str.trim() !== ''
  }

  // Get translation status
  const getTranslationStatus = () => {
    const filledLocales = locales.filter(
      (locale) => isNonEmptyString(normalizedValue[locale], locale)
    )
    return {
      filled: filledLocales.length,
      total: locales.length,
      missing: locales.filter(
        (locale) => !isNonEmptyString(normalizedValue[locale], locale)
      ),
    }
  }

  const status = getTranslationStatus()
  const hasDefaultValue = isNonEmptyString(normalizedValue[defaultLocale], defaultLocale)

  // Update a single locale value
  const updateLocale = (locale: string, newValue: string) => {
    // Convert normalizedValue to Record<string, string> for onChange
    const stringValues: Record<string, string> = {}
    for (const key of Object.keys(normalizedValue)) {
      stringValues[key] = getStringValue(normalizedValue[key], key)
    }
    stringValues[locale] = newValue
    onChange(stringValues)
  }

  // Copy from default locale to another locale
  const copyFromDefault = (targetLocale: string) => {
    if (hasDefaultValue) {
      updateLocale(targetLocale, getStringValue(normalizedValue[defaultLocale], defaultLocale))
      setCopiedLocale(targetLocale)
      setTimeout(() => setCopiedLocale(null), 1500)
    }
  }

  const InputComponent = multiline ? Textarea : Input

  // Compact mode - single locale with expandable all-locales section
  if (compact && currentLocale) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{label} ({currentLocale.toUpperCase()})</Label>
          {status.missing.length > 0 && (
            <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
              {status.filled}/{status.total}
            </Badge>
          )}
        </div>
        <InputComponent
          value={getStringValue(normalizedValue[currentLocale], currentLocale)}
          onChange={(e) => updateLocale(currentLocale, e.target.value)}
          placeholder={placeholder}
          rows={multiline ? rows : undefined}
        />
        {description && (
          <p className="text-[10px] text-muted-foreground">{description}</p>
        )}

        {/* Expandable all-locales section */}
        {locales.length > 1 && (
          <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              All translations
              {status.missing.length > 0 && (
                <AlertCircle className="h-3 w-3 text-amber-500 ml-1" />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 space-y-2">
              {locales.filter(l => l !== currentLocale).map((locale) => (
                <div key={locale} className="flex gap-2 items-start">
                  <div className="w-8 pt-2">
                    <Badge
                      variant={isNonEmptyString(normalizedValue[locale], locale) ? 'secondary' : 'outline'}
                      className={cn(
                        'text-[10px] w-full justify-center',
                        !isNonEmptyString(normalizedValue[locale], locale) && 'text-amber-600 border-amber-300'
                      )}
                    >
                      {locale.toUpperCase()}
                    </Badge>
                  </div>
                  <div className="flex-1">
                    <InputComponent
                      value={getStringValue(normalizedValue[locale], locale)}
                      onChange={(e) => updateLocale(locale, e.target.value)}
                      placeholder={placeholder || `${LOCALE_NAMES[locale] || locale} translation...`}
                      rows={multiline ? Math.max(2, rows - 1) : undefined}
                      className="text-sm"
                    />
                  </div>
                  {hasDefaultValue && !isNonEmptyString(normalizedValue[locale], locale) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => copyFromDefault(locale)}
                      title={`Copy from ${defaultLocale.toUpperCase()}`}
                    >
                      {copiedLocale === locale ? (
                        <Check className="h-3 w-3 text-green-500" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    )
  }

  // Full mode - tabbed interface
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        {status.missing.length > 0 && (
          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
            <AlertCircle className="h-3 w-3 mr-1" />
            {status.missing.length} missing
          </Badge>
        )}
      </div>

      <Tabs defaultValue={defaultLocale} className="w-full">
        <TabsList className="w-full h-8">
          {locales.map((locale) => (
            <TabsTrigger
              key={locale}
              value={locale}
              className={cn(
                'flex-1 text-xs gap-1',
                !isNonEmptyString(normalizedValue[locale], locale) && locale !== defaultLocale && 'text-amber-600'
              )}
            >
              {locale.toUpperCase()}
              {locale === defaultLocale && <span className="text-[9px] opacity-50">*</span>}
              {!isNonEmptyString(normalizedValue[locale], locale) && locale !== defaultLocale && (
                <AlertCircle className="h-2.5 w-2.5" />
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {locales.map((locale) => (
          <TabsContent key={locale} value={locale} className="mt-2">
            <div className="space-y-2">
              <InputComponent
                value={getStringValue(normalizedValue[locale], locale)}
                onChange={(e) => updateLocale(locale, e.target.value)}
                placeholder={placeholder || `Enter ${LOCALE_NAMES[locale] || locale} text...`}
                rows={multiline ? rows : undefined}
              />
              {locale !== defaultLocale && hasDefaultValue && !isNonEmptyString(normalizedValue[locale], locale) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => copyFromDefault(locale)}
                >
                  {copiedLocale === locale ? (
                    <>
                      <Check className="h-3 w-3 mr-1 text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3 mr-1" />
                      Copy from {defaultLocale.toUpperCase()}
                    </>
                  )}
                </Button>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>

      {description && (
        <p className="text-[10px] text-muted-foreground">{description}</p>
      )}
    </div>
  )
}

/**
 * Simple helper to check translation completeness
 */
export function getTranslationCompleteness(
  value: LocalizedString | undefined,
  locales: string[],
  defaultLocale: string = 'en'
): { filled: number; total: number; percentage: number } {
  const normalizedValue: Record<string, unknown> =
    typeof value === 'string' ? { [defaultLocale]: value } : value || {}

  // Recursive unwrap function for nested structures like { en: { en: "..." } }
  const getStr = (val: unknown, locale: string): string => {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const record = val as Record<string, unknown>
      const nested = record[locale] ?? record['en'] ?? Object.values(record)[0]
      return getStr(nested, locale)
    }
    return ''
  }

  const filled = locales.filter(
    (locale) => getStr(normalizedValue[locale], locale).trim() !== ''
  ).length

  return {
    filled,
    total: locales.length,
    percentage: locales.length > 0 ? Math.round((filled / locales.length) * 100) : 0,
  }
}
