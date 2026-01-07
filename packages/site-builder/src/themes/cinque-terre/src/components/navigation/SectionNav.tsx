/**
 * Section Navigation Component
 *
 * Dropdown showing available sections for an expanded village.
 * Appears below the village node on hover/focus.
 */

import React from 'react';
import {
  MapPin,
  Compass,
  Utensils,
  Bed,
  Camera,
  Mountain,
  Waves,
  Calendar,
  Sun,
  Train,
  Home,
  Ship,
  ChefHat,
  FileText,
  HelpCircle,
  Map,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { SectionNavProps, Section, SupportedLanguage, VillageSlug } from '../../types/navigation.types';

/**
 * Build URL for a section
 * - When village is provided, creates village-scoped URL: /en/riomaggiore/restaurants
 * - When no village, uses hubPath for hub pages: /en/culinary
 */
function buildSectionUrl(
  locale: SupportedLanguage,
  village: VillageSlug | null,
  section: Section
): string {
  // If we're in a village context, use village-scoped URLs
  if (village) {
    return `/${locale}/${village}/${section.slug}`;
  }
  // Otherwise use hubPath for hub pages
  const path = section.hubPath || section.slug;
  return `/${locale}/${path}`;
}

// Map icon names to Lucide components
const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  MapPin,
  Compass,
  Utensils,
  Bed,
  Camera,
  Mountain,
  Waves,
  Calendar,
  Sun,
  Train,
  Home,
  Ship,
  ChefHat,
  FileText,
  HelpCircle,
  Map,
};

export function SectionNav({
  village,
  sections,
  activeSection,
  locale,
  isVisible,
}: SectionNavProps) {
  if (!isVisible) {
    return null;
  }

  return (
    <div
      className={cn(
        'absolute top-full left-1/2 -translate-x-1/2 pt-3 z-50',
        'transition-all duration-200 ease-out',
        isVisible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 -translate-y-2 pointer-events-none'
      )}
    >
      {/* Arrow pointer */}
      <div
        className="absolute top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-card border-l border-t border-border rotate-45"
        aria-hidden="true"
      />

      {/* Dropdown container */}
      <div
        className={cn(
          'relative bg-card border border-border rounded-xl shadow-xl',
          'p-2 min-w-[220px] max-w-[280px]'
        )}
      >
        <ul className="space-y-0.5" role="menu" aria-label={`Sections in ${village}`}>
          {sections.map((section) => {
            const IconComponent = ICON_MAP[section.icon];
            const sectionUrl = buildSectionUrl(locale, village, section);
            const isActive = activeSection === section.slug;

            return (
              <li key={section.slug} role="none">
                <a
                  href={sectionUrl}
                  role="menuitem"
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm',
                    'transition-colors duration-150',
                    'hover:bg-muted',
                    isActive && 'bg-muted text-primary font-medium'
                  )}
                  aria-current={isActive ? 'page' : undefined}
                >
                  {IconComponent && (
                    <IconComponent
                      className={cn(
                        'w-4 h-4 flex-shrink-0',
                        isActive ? 'text-primary' : 'text-muted-foreground'
                      )}
                      aria-hidden="true"
                    />
                  )}
                  <span className="truncate">{section.name[locale]}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export default SectionNav;
