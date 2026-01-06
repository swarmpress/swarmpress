/**
 * Mobile Navigation Component
 *
 * Sheet-based navigation for mobile devices.
 * Shows villages as expandable sections with nested section links.
 */

import React, { useState } from 'react';
import { Menu, ChevronRight, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from '../../ui/sheet';
import {
  VILLAGES,
  getNavSections,
  LANGUAGE_NAMES,
  SUPPORTED_LANGUAGES,
} from '../../config/navigation.config';
import {
  useNavigationState,
  buildLanguageSwitchUrl,
} from './useNavigationState';
import type { Section, SupportedLanguage } from '../../types/navigation.types';

/**
 * Build URL for a section - uses hubPath for existing editorial pages
 */
function buildSectionUrl(
  locale: SupportedLanguage,
  section: Section
): string {
  // Use hubPath if defined, otherwise fall back to section slug
  const path = section.hubPath || section.slug;
  return `/${locale}/${path}`;
}
import type { MobileNavProps, VillageSlug } from '../../types/navigation.types';


export function MobileNav({ currentPath, locale }: MobileNavProps) {
  const [expandedVillage, setExpandedVillage] = useState<VillageSlug | null>(
    null
  );
  const [isOpen, setIsOpen] = useState(false);
  const navState = useNavigationState(currentPath);
  const sections = getNavSections();

  // Toggle village expansion
  const toggleVillage = (villageSlug: VillageSlug) => {
    setExpandedVillage(
      expandedVillage === villageSlug ? null : villageSlug
    );
  };

  return (
    <div className="flex items-center justify-between w-full py-3 px-4">
      {/* Hamburger menu trigger */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <button
            className={cn(
              'p-2 -m-2 rounded-lg',
              'text-muted-foreground hover:text-foreground hover:bg-muted',
              'transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            )}
            aria-label="Open navigation menu"
          >
            <Menu className="w-6 h-6" />
          </button>
        </SheetTrigger>

        <SheetContent
          side="left"
          className="w-[300px] sm:w-[340px] overflow-y-auto p-0"
        >
          {/* Header */}
          <div className="sticky top-0 bg-background border-b border-border px-5 py-4">
            <SheetTitle className="font-serif text-xl font-bold tracking-tight">
              Cinque Terre
            </SheetTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Explore the five villages
            </p>
          </div>

          {/* Village list */}
          <nav className="px-3 py-4">
            <ul className="space-y-1">
              {VILLAGES.map((village) => {
                const isExpanded = expandedVillage === village.slug;
                const isActive = navState.activeVillage === village.slug;

                return (
                  <li key={village.slug}>
                    {/* Village header (expandable) */}
                    <button
                      onClick={() => toggleVillage(village.slug)}
                      className={cn(
                        'w-full flex items-center justify-between',
                        'px-3 py-3 rounded-lg text-left',
                        'transition-colors duration-150',
                        'hover:bg-muted',
                        isActive && 'text-primary font-medium'
                      )}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex items-center gap-3">
                        {/* Village color dot */}
                        <span
                          className={cn(
                            'w-2.5 h-2.5 rounded-full flex-shrink-0',
                            isActive ? '' : 'opacity-60'
                          )}
                          style={{ backgroundColor: village.color }}
                          aria-hidden="true"
                        />
                        <span className="text-base">{village.name[locale]}</span>
                      </div>
                      <ChevronRight
                        className={cn(
                          'w-4 h-4 text-muted-foreground transition-transform duration-200',
                          isExpanded && 'rotate-90'
                        )}
                        aria-hidden="true"
                      />
                    </button>

                    {/* Expanded sections */}
                    {isExpanded && (
                      <ul className="ml-5 pl-3 border-l border-border/50 py-2 space-y-0.5">
                        {sections.map((section) => {
                          const url = buildSectionUrl(locale, section);
                          const isActiveSection =
                            isActive &&
                            navState.activeSection === section.slug;

                          return (
                            <li key={section.slug}>
                              <a
                                href={url}
                                className={cn(
                                  'block py-2 px-3 text-sm rounded-md',
                                  'transition-colors duration-150',
                                  'hover:bg-muted hover:text-foreground',
                                  isActiveSection
                                    ? 'text-primary font-medium bg-muted/50'
                                    : 'text-muted-foreground'
                                )}
                                onClick={() => setIsOpen(false)}
                              >
                                {section.name[locale]}
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Divider */}
          <div className="mx-5 border-t border-border" />

          {/* Language selector */}
          <div className="px-5 py-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-3">
              Language
            </p>
            <div className="flex flex-wrap gap-2">
              {SUPPORTED_LANGUAGES.map((lang) => {
                const url = buildLanguageSwitchUrl(lang, navState);
                const isSelected = lang === locale;

                return (
                  <a
                    key={lang}
                    href={url}
                    className={cn(
                      'px-4 py-2 text-sm rounded-lg border transition-colors duration-150',
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border hover:border-primary/50 hover:bg-muted'
                    )}
                    onClick={() => setIsOpen(false)}
                  >
                    {LANGUAGE_NAMES[lang]}
                  </a>
                );
              })}
            </div>
          </div>

          {/* Footer actions */}
          <div className="px-5 py-4 border-t border-border mt-auto">
            <a
              href="#subscribe"
              className={cn(
                'flex items-center justify-center gap-2 w-full',
                'px-4 py-3 rounded-lg',
                'bg-primary text-primary-foreground font-medium',
                'hover:bg-primary/90 transition-colors duration-150'
              )}
              onClick={() => setIsOpen(false)}
            >
              Subscribe to Newsletter
            </a>
          </div>
        </SheetContent>
      </Sheet>

      {/* Logo/Title */}
      <a
        href={`/${locale}`}
        className="font-serif text-lg font-bold tracking-tight hover:text-primary transition-colors"
      >
        Cinque Terre
      </a>

      {/* Search button */}
      <button
        className={cn(
          'p-2 -m-2 rounded-lg',
          'text-muted-foreground hover:text-foreground hover:bg-muted',
          'transition-colors duration-150',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
        )}
        aria-label="Search"
      >
        <Search className="w-5 h-5" />
      </button>
    </div>
  );
}

export default MobileNav;
