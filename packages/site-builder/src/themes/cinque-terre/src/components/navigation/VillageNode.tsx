/**
 * Village Node Component
 *
 * Individual village dot in the coastal spine.
 * Shows the village name and expands to show sections on hover/focus.
 */

import React from 'react';
import { cn } from '../../lib/utils';
import { SectionNav } from './SectionNav';
import type { VillageNodeProps } from '../../types/navigation.types';

export function VillageNode({
  village,
  isActive,
  isExpanded,
  sections,
  activeSection,
  locale,
  onHover,
  onLeave,
}: VillageNodeProps) {
  const villageUrl = `/${locale}/${village.slug}`;

  return (
    <div
      className="village-node relative"
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {/* Village link with dot and label */}
      <a
        href={villageUrl}
        className={cn(
          'relative z-10 flex flex-col items-center gap-1.5 px-3 py-2',
          'rounded-lg transition-all duration-200',
          'hover:bg-muted/50 focus-visible:bg-muted/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          isActive && 'bg-muted/70',
          isExpanded && !isActive && 'bg-muted/30'
        )}
        aria-current={isActive ? 'page' : undefined}
        aria-expanded={isExpanded}
        aria-haspopup="menu"
      >
        {/* Village dot indicator */}
        <span
          className={cn(
            'relative w-3 h-3 rounded-full transition-all duration-300',
            'border-2',
            isActive
              ? 'scale-125 border-transparent'
              : 'bg-background border-border/60 hover:border-primary/60',
            isExpanded && !isActive && 'border-primary/40 scale-110'
          )}
          style={{
            backgroundColor: isActive ? village.color : undefined,
            boxShadow: isActive
              ? `0 0 0 3px ${village.color}20, 0 0 12px ${village.color}40`
              : undefined,
          }}
          aria-hidden="true"
        >
          {/* Pulse animation for active village */}
          {isActive && (
            <span
              className="absolute inset-0 rounded-full animate-ping opacity-30"
              style={{ backgroundColor: village.color }}
              aria-hidden="true"
            />
          )}
        </span>

        {/* Village name */}
        <span
          className={cn(
            'text-[11px] font-medium tracking-wide whitespace-nowrap',
            'transition-colors duration-200',
            isActive
              ? 'text-foreground font-semibold'
              : 'text-muted-foreground',
            isExpanded && !isActive && 'text-foreground'
          )}
        >
          {village.name[locale]}
        </span>
      </a>

      {/* Expanded section navigation dropdown */}
      <SectionNav
        village={village.slug}
        sections={sections}
        activeSection={activeSection}
        locale={locale}
        isVisible={isExpanded}
      />
    </div>
  );
}

export default VillageNode;
