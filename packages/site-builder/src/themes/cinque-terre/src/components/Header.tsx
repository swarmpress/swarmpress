/**
 * Header Component
 *
 * Feature-flagged wrapper that switches between the legacy navigation
 * and the new Coastal Spine navigation system.
 */

import React from 'react';
import HeaderLegacy from './HeaderLegacy';
import { CoastalSpine } from './navigation/CoastalSpine';
import { MobileNav } from './navigation/MobileNav';
import { FEATURES } from '../config/features.config';
import type { SupportedLanguage } from '../types/navigation.types';

interface HeaderProps {
  currentPath?: string;
  locale?: SupportedLanguage;
  [key: string]: unknown; // Allow legacy props to pass through
}

export default function Header({
  currentPath = '/',
  locale = 'en',
  ...legacyProps
}: HeaderProps) {
  // Check feature flag - if not enabled, use legacy header
  if (!FEATURES.useCoastalSpineNav) {
    return <HeaderLegacy {...legacyProps} />;
  }

  // New Coastal Spine Navigation
  return (
    <header className="sticky top-0 z-50 w-full bg-background/95 backdrop-blur-md border-b border-border/40">
      <div className="container mx-auto px-4 lg:px-8">
        {/* Desktop Navigation - hidden on mobile */}
        <div className="hidden lg:block py-4">
          <CoastalSpine currentPath={currentPath} locale={locale} />
        </div>

        {/* Mobile Navigation - hidden on desktop */}
        <div className="lg:hidden">
          <MobileNav currentPath={currentPath} locale={locale} />
        </div>
      </div>
    </header>
  );
}
