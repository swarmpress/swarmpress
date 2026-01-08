/**
 * Village Content Configuration
 *
 * Loads comprehensive content data for each of the five Cinque Terre villages
 * from JSON files in the content submodule.
 *
 * Components use this data to render village-specific content based on the
 * village prop passed from the URL.
 */

import fs from 'fs';
import path from 'path';
import type { VillageSlug, SupportedLanguage } from '../types/navigation.types';

export interface VillageHeroContent {
  image: string;
  imageAlt: Record<SupportedLanguage, string>;
  tagline: Record<SupportedLanguage, string>;
  title: Record<SupportedLanguage, string>;
  subtitle: Record<SupportedLanguage, string>;
  primaryCta: {
    label: Record<SupportedLanguage, string>;
    href: string;
  };
  secondaryCta: {
    label: Record<SupportedLanguage, string>;
    href: string;
  };
}

export interface VillageIntroContent {
  leadStory: {
    title: Record<SupportedLanguage, string>;
    excerpt: Record<SupportedLanguage, string>;
    author: string;
    date: string;
    readTime: string;
    category: string;
    image: string;
  };
  essentials: {
    title: Record<SupportedLanguage, string>;
    subtitle: Record<SupportedLanguage, string>;
    today: {
      weather: string;
      seaTemp: string;
      seaConditions: string;
      sunset: string;
    };
    experience: {
      crowdRhythm: string;
      bestFelt: string;
      villageShape: string;
      foodWine: string;
    };
    character: {
      origins: string;
      shapedBy: string;
      rating: string;
      rememberedFor: string;
    };
  };
}

export interface VillageContentData {
  slug: VillageSlug;
  hero: VillageHeroContent;
  intro: VillageIntroContent;
  seo: {
    title: Record<SupportedLanguage, string>;
    description: Record<SupportedLanguage, string>;
  };
}

// Path to village config JSON files in the content submodule
const VILLAGE_CONFIG_DIR = process.env.VILLAGE_CONFIG_DIR || '/Users/drietsch/agentpress/cinqueterre.travel/content/config/villages';

// Cache for loaded village content
let villageContentCache: Record<VillageSlug, VillageContentData> | null = null;

/**
 * Load all village content from JSON files
 */
function loadVillageContent(): Record<VillageSlug, VillageContentData> {
  if (villageContentCache) {
    return villageContentCache;
  }

  const villages: VillageSlug[] = ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso'];
  const content: Record<string, VillageContentData> = {};

  for (const village of villages) {
    const filePath = path.join(VILLAGE_CONFIG_DIR, `${village}.json`);

    try {
      if (fs.existsSync(filePath)) {
        const jsonContent = fs.readFileSync(filePath, 'utf-8');
        content[village] = JSON.parse(jsonContent) as VillageContentData;
      } else {
        console.warn(`Village config file not found: ${filePath}`);
      }
    } catch (error) {
      console.error(`Error loading village config for ${village}:`, error);
    }
  }

  villageContentCache = content as Record<VillageSlug, VillageContentData>;
  return villageContentCache;
}

/**
 * Get village content by slug
 */
export function getVillageContent(slug: string): VillageContentData | undefined {
  const content = loadVillageContent();
  return content[slug as VillageSlug];
}

/**
 * Get all village content
 */
export function getAllVillageContent(): VillageContentData[] {
  const content = loadVillageContent();
  return Object.values(content);
}

/**
 * Export VILLAGE_CONTENT for backward compatibility
 * This provides direct access to the content object if needed
 */
export const VILLAGE_CONTENT: Record<VillageSlug, VillageContentData> = new Proxy(
  {} as Record<VillageSlug, VillageContentData>,
  {
    get(target, prop) {
      const content = loadVillageContent();
      return content[prop as VillageSlug];
    },
    ownKeys() {
      return ['riomaggiore', 'manarola', 'corniglia', 'vernazza', 'monterosso'];
    },
    getOwnPropertyDescriptor() {
      return { enumerable: true, configurable: true };
    },
  }
);
