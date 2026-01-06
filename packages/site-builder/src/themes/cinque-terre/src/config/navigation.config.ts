/**
 * Coastal Spine Navigation Configuration
 *
 * Defines the villages and sections for the navigation system.
 * Villages are ordered geographically from south (Riomaggiore) to north (Monterosso).
 */

import type {
  Village,
  Section,
  SupportedLanguage,
  VillageSlug,
  SectionSlug,
} from '../types/navigation.types';

// Villages in geographic order (south to north along the coast)
export const VILLAGES: Village[] = [
  {
    slug: 'riomaggiore',
    name: {
      en: 'Riomaggiore',
      de: 'Riomaggiore',
      fr: 'Riomaggiore',
      it: 'Riomaggiore',
    },
    order: 1,
    color: 'var(--color-riomaggiore, #C67B5C)', // Warm terracotta
  },
  {
    slug: 'manarola',
    name: {
      en: 'Manarola',
      de: 'Manarola',
      fr: 'Manarola',
      it: 'Manarola',
    },
    order: 2,
    color: 'var(--color-manarola, #8B4B6D)', // Deep wine
  },
  {
    slug: 'corniglia',
    name: {
      en: 'Corniglia',
      de: 'Corniglia',
      fr: 'Corniglia',
      it: 'Corniglia',
    },
    order: 3,
    color: 'var(--color-corniglia, #7A9E7E)', // Sage green
  },
  {
    slug: 'vernazza',
    name: {
      en: 'Vernazza',
      de: 'Vernazza',
      fr: 'Vernazza',
      it: 'Vernazza',
    },
    order: 4,
    color: 'var(--color-vernazza, #5B8BA0)', // Ocean blue
  },
  {
    slug: 'monterosso',
    name: {
      en: 'Monterosso',
      de: 'Monterosso al Mare',
      fr: 'Monterosso',
      it: 'Monterosso al Mare',
    },
    order: 5,
    color: 'var(--color-monterosso, #C4A35A)', // Sandy gold
  },
];

// Content sections available per village
// hubPath maps to existing editorial pages (e.g., 'culinary' -> /en/culinary)
export const SECTIONS: Section[] = [
  {
    slug: 'overview',
    name: {
      en: 'Overview',
      de: 'Überblick',
      fr: 'Aperçu',
      it: 'Panoramica',
    },
    icon: 'MapPin',
    order: 0,
    showInNav: true,
    hubPath: 'village', // /en/village
  },
  {
    slug: 'things-to-do',
    name: {
      en: 'Things to Do',
      de: 'Aktivitäten',
      fr: 'À faire',
      it: 'Cosa fare',
    },
    icon: 'Compass',
    order: 1,
    showInNav: true,
    hubPath: 'things-to-do', // /en/things-to-do
  },
  {
    slug: 'restaurants',
    name: {
      en: 'Restaurants',
      de: 'Restaurants',
      fr: 'Restaurants',
      it: 'Ristoranti',
    },
    icon: 'Utensils',
    order: 2,
    showInNav: true,
    hubPath: 'culinary', // /en/culinary
  },
  {
    slug: 'hotels',
    name: {
      en: 'Hotels',
      de: 'Hotels',
      fr: 'Hôtels',
      it: 'Hotel',
    },
    icon: 'Bed',
    order: 3,
    showInNav: true,
    hubPath: 'accommodations', // /en/accommodations
  },
  {
    slug: 'sights',
    name: {
      en: 'Sights',
      de: 'Sehenswürdigkeiten',
      fr: 'Sites',
      it: 'Attrazioni',
    },
    icon: 'Camera',
    order: 4,
    showInNav: true,
    hubPath: 'sights', // /en/sights
  },
  {
    slug: 'hiking',
    name: {
      en: 'Hiking',
      de: 'Wandern',
      fr: 'Randonnée',
      it: 'Escursioni',
    },
    icon: 'Mountain',
    order: 5,
    showInNav: true,
    hubPath: 'itinerary', // /en/itinerary (hiking trails as itinerary)
  },
  {
    slug: 'beaches',
    name: {
      en: 'Beaches',
      de: 'Strände',
      fr: 'Plages',
      it: 'Spiagge',
    },
    icon: 'Waves',
    order: 6,
    showInNav: true,
    hubPath: 'sights', // No dedicated beach page, use sights
  },
  {
    slug: 'events',
    name: {
      en: 'Events',
      de: 'Veranstaltungen',
      fr: 'Événements',
      it: 'Eventi',
    },
    icon: 'Calendar',
    order: 7,
    showInNav: true,
    hubPath: 'events', // /en/events
  },
  {
    slug: 'weather',
    name: {
      en: 'Weather',
      de: 'Wetter',
      fr: 'Météo',
      it: 'Meteo',
    },
    icon: 'Sun',
    order: 8,
    showInNav: true,
    hubPath: 'weather', // /en/weather
  },
  {
    slug: 'getting-here',
    name: {
      en: 'Getting Here',
      de: 'Anreise',
      fr: 'Comment y aller',
      it: 'Come arrivare',
    },
    icon: 'Train',
    order: 9,
    showInNav: true,
    hubPath: 'transportation', // /en/transportation
  },
  // Hidden from main nav but still accessible
  {
    slug: 'apartments',
    name: {
      en: 'Apartments',
      de: 'Ferienwohnungen',
      fr: 'Appartements',
      it: 'Appartamenti',
    },
    icon: 'Home',
    order: 10,
    showInNav: false,
  },
  {
    slug: 'boat-tours',
    name: {
      en: 'Boat Tours',
      de: 'Bootstouren',
      fr: 'Excursions en bateau',
      it: 'Tour in barca',
    },
    icon: 'Ship',
    order: 11,
    showInNav: false,
  },
  {
    slug: 'culinary',
    name: {
      en: 'Culinary',
      de: 'Kulinarisches',
      fr: 'Gastronomie',
      it: 'Gastronomia',
    },
    icon: 'ChefHat',
    order: 12,
    showInNav: false,
  },
  {
    slug: 'blog',
    name: {
      en: 'Blog',
      de: 'Blog',
      fr: 'Blog',
      it: 'Blog',
    },
    icon: 'FileText',
    order: 13,
    showInNav: false,
  },
  {
    slug: 'faq',
    name: {
      en: 'FAQ',
      de: 'FAQ',
      fr: 'FAQ',
      it: 'FAQ',
    },
    icon: 'HelpCircle',
    order: 14,
    showInNav: false,
  },
  {
    slug: 'maps',
    name: {
      en: 'Maps',
      de: 'Karten',
      fr: 'Cartes',
      it: 'Mappe',
    },
    icon: 'Map',
    order: 15,
    showInNav: false,
  },
];

// Supported languages
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['en', 'de', 'fr', 'it'];

// Language display names (in their own language)
export const LANGUAGE_NAMES: Record<SupportedLanguage, string> = {
  en: 'English',
  de: 'Deutsch',
  fr: 'Français',
  it: 'Italiano',
};

// Helper functions

/**
 * Get a village by its slug
 */
export function getVillage(slug: string): Village | undefined {
  return VILLAGES.find((v) => v.slug === slug);
}

/**
 * Get a section by its slug
 */
export function getSection(slug: string): Section | undefined {
  return SECTIONS.find((s) => s.slug === slug);
}

/**
 * Get sections visible in the main navigation
 */
export function getNavSections(): Section[] {
  return SECTIONS.filter((s) => s.showInNav).sort((a, b) => a.order - b.order);
}

/**
 * Get all sections sorted by order
 */
export function getAllSections(): Section[] {
  return [...SECTIONS].sort((a, b) => a.order - b.order);
}

/**
 * Check if a string is a valid village slug
 */
export function isVillageSlug(slug: string): slug is VillageSlug {
  return VILLAGES.some((v) => v.slug === slug);
}

/**
 * Check if a string is a valid section slug
 */
export function isSectionSlug(slug: string): slug is SectionSlug {
  return SECTIONS.some((s) => s.slug === slug);
}

/**
 * Check if a string is a valid language code
 */
export function isSupportedLanguage(lang: string): lang is SupportedLanguage {
  return SUPPORTED_LANGUAGES.includes(lang as SupportedLanguage);
}
