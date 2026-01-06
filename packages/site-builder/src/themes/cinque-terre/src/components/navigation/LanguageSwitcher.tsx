/**
 * Language Switcher Component
 *
 * Dropdown for switching between supported languages.
 * Preserves current village and section context when switching.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_NAMES,
} from '../../config/navigation.config';
import {
  useNavigationState,
  buildLanguageSwitchUrl,
} from './useNavigationState';
import type {
  LanguageSwitcherProps,
  SupportedLanguage,
} from '../../types/navigation.types';

export function LanguageSwitcher({
  currentLang,
  currentPath,
}: LanguageSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const navState = useNavigationState(currentPath);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close dropdown on Escape key
  useEffect(() => {
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg transition-colors',
          'hover:bg-muted text-muted-foreground hover:text-foreground',
          isOpen && 'bg-muted text-foreground'
        )}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Current language: ${LANGUAGE_NAMES[currentLang]}. Click to change language.`}
      >
        <Globe className="w-4 h-4" aria-hidden="true" />
        <span className="uppercase font-medium tracking-wide">{currentLang}</span>
        <ChevronDown
          className={cn(
            'w-3 h-3 transition-transform duration-200',
            isOpen && 'rotate-180'
          )}
          aria-hidden="true"
        />
      </button>

      {/* Dropdown menu */}
      {isOpen && (
        <div
          className={cn(
            'absolute right-0 top-full mt-2',
            'bg-card border border-border rounded-xl shadow-lg',
            'py-1.5 min-w-[160px] z-50',
            'animate-in fade-in-0 zoom-in-95 duration-150'
          )}
          role="listbox"
          aria-label="Select language"
        >
          {SUPPORTED_LANGUAGES.map((lang) => {
            const url = buildLanguageSwitchUrl(lang, navState);
            const isSelected = lang === currentLang;

            return (
              <a
                key={lang}
                href={url}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'flex items-center justify-between px-4 py-2.5 text-sm transition-colors',
                  'hover:bg-muted',
                  isSelected && 'bg-muted/50 text-primary font-medium'
                )}
                onClick={() => setIsOpen(false)}
              >
                <span>{LANGUAGE_NAMES[lang]}</span>
                <span className="text-xs text-muted-foreground uppercase font-mono">
                  {lang}
                </span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default LanguageSwitcher;
