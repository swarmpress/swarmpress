/**
 * Coastal Spine Navigation Component
 *
 * The main navigation component representing the Cinque Terre coastline.
 * Villages are displayed as nodes along a horizontal spine.
 * Hovering over a village expands to show section navigation.
 */

import React, { useState, useCallback } from 'react';
import { Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { VillageNode } from './VillageNode';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useNavigationState } from './useNavigationState';
import { VILLAGES, getNavSections } from '../../config/navigation.config';
import type { CoastalSpineProps, VillageSlug } from '../../types/navigation.types';

export function CoastalSpine({ currentPath, locale }: CoastalSpineProps) {
  const navState = useNavigationState(currentPath);
  const sections = getNavSections();

  // Track which village is being hovered (for desktop expansion)
  const [hoveredVillage, setHoveredVillage] = useState<VillageSlug | null>(null);

  // Determine which village should be expanded:
  // - On hover: the hovered village
  // - Otherwise: the active village from URL (if any)
  const expandedVillage = hoveredVillage ?? navState.activeVillage;

  const handleVillageHover = useCallback((village: VillageSlug) => {
    setHoveredVillage(village);
  }, []);

  const handleVillageLeave = useCallback(() => {
    setHoveredVillage(null);
  }, []);

  return (
    <nav
      className="coastal-spine relative"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-between w-full">
        {/* Logo / Home link */}
        <a
          href={`/${locale}`}
          className={cn(
            'font-serif text-xl font-bold tracking-tight',
            'text-foreground hover:text-primary transition-colors duration-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded'
          )}
        >
          Cinque Terre
        </a>

        {/* Coastal spine - villages in geographic order */}
        <div
          className="relative flex items-center"
          onMouseLeave={handleVillageLeave}
          role="menubar"
          aria-label="Villages"
        >
          {/* Visual connecting line */}
          <div
            className="absolute inset-y-0 left-4 right-4 flex items-center pointer-events-none"
            aria-hidden="true"
          >
            <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-60" />
          </div>

          {/* Village nodes */}
          {VILLAGES.map((village, index) => {
            const isActive = navState.activeVillage === village.slug;
            const isExpanded = expandedVillage === village.slug;

            return (
              <React.Fragment key={village.slug}>
                {/* Connecting segment between villages */}
                {index > 0 && (
                  <div
                    className={cn(
                      'w-6 h-px transition-colors duration-300',
                      // Highlight segment if either adjacent village is active/expanded
                      (isExpanded ||
                        expandedVillage === VILLAGES[index - 1]?.slug)
                        ? 'bg-primary/30'
                        : 'bg-border/40'
                    )}
                    aria-hidden="true"
                  />
                )}

                <VillageNode
                  village={village}
                  isActive={isActive}
                  isExpanded={isExpanded}
                  sections={sections}
                  activeSection={
                    isActive ? navState.activeSection : null
                  }
                  locale={locale}
                  onHover={() => handleVillageHover(village.slug)}
                />
              </React.Fragment>
            );
          })}
        </div>

        {/* Right side: utilities */}
        <div className="flex items-center gap-2">
          {/* Language switcher */}
          <LanguageSwitcher currentLang={locale} currentPath={currentPath} />

          {/* Search button */}
          <button
            className={cn(
              'p-2 rounded-lg',
              'text-muted-foreground hover:text-foreground hover:bg-muted',
              'transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            )}
            aria-label="Search"
          >
            <Search className="w-4 h-4" />
          </button>

          {/* Subscribe CTA */}
          <a
            href="#subscribe"
            className={cn(
              'px-4 py-2 text-sm font-medium rounded-full',
              'bg-primary text-primary-foreground',
              'hover:bg-primary/90 transition-colors duration-150',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2'
            )}
          >
            Subscribe
          </a>
        </div>
      </div>
    </nav>
  );
}

export default CoastalSpine;
