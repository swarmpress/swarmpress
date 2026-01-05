/**
 * Type definitions for Cinque Terre theme components
 * These types define the props that components accept from JSON content
 */

// Common types
export interface LocalizedString {
  en?: string;
  de?: string;
  fr?: string;
  it?: string;
  [locale: string]: string | undefined;
}

export interface Button {
  text: string | LocalizedString;
  url: string | LocalizedString;
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
}

export interface Image {
  src: string;
  alt?: string;
  caption?: string;
}

// Hero Section
export interface HeroProps {
  image?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  buttons?: Button[];
  variant?: 'centered' | 'split-with-image' | 'minimal';
}

// Stats Section
export interface Stat {
  number: string;
  label: string;
  description?: string;
}

export interface StatsProps {
  title?: string;
  subtitle?: string;
  stats: Stat[];
}

// Feature Section
export interface Feature {
  icon?: string;
  title: string;
  description: string;
}

export interface FeatureProps {
  title?: string;
  subtitle?: string;
  features: Feature[];
}

// Village Selector
export interface Village {
  name: string;
  slug?: string;
  description: string;
  image: string;
  tags?: string[];
}

export interface VillageSelectorProps {
  title?: string;
  subtitle?: string;
  villages: Village[];
}

// Places to Stay
export interface Stay {
  name: string;
  village: string;
  special: string;
  price: string;
  image: string;
  url?: string;
}

export interface PlacesToStayProps {
  title?: string;
  eyebrow?: string;
  stays: Stay[];
  viewAllUrl?: string;
}

// Featured Carousel / Stories
export interface Story {
  id: string | number;
  title: string;
  category: string;
  dek?: string;
  excerpt?: string;
  image: string;
  author?: string;
  date?: string;
  readTime?: string;
  url?: string;
  isLead?: boolean;
}

export interface FeaturedCarouselProps {
  title?: string;
  viewAllUrl?: string;
  stories: Story[];
}

// Village Intro
export interface VillageEssentials {
  weather?: string;
  seaTemp?: string;
  seaConditions?: string;
  sunset?: string;
  crowdRhythm?: string;
  bestFelt?: string;
  villageShape?: string;
  foodWine?: string;
  origins?: string;
  shapedBy?: string;
  rating?: string;
  rememberedFor?: string;
}

export interface VillageIntroProps {
  village: string;
  leadStory: Story;
  essentials: VillageEssentials;
  stories?: Story[];
}

// Eat & Drink
export interface Restaurant {
  name: string;
  type: string;
  description: string;
  priceRange: string;
  image: string;
  rating?: number;
  specialty?: string;
  url?: string;
}

export interface EatDrinkProps {
  title?: string;
  subtitle?: string;
  restaurants: Restaurant[];
}

// Navigation
export interface NavItem {
  title: string | LocalizedString;
  url: string | LocalizedString;
  children?: NavItem[];
  isSeparator?: boolean;
}

export interface HeaderProps {
  logo?: string;
  siteName?: string;
  navigation: NavItem[];
  ctaButton?: Button;
}

export interface FooterProps {
  siteName?: string;
  description?: string;
  navigation?: {
    title: string;
    items: NavItem[];
  }[];
  socialLinks?: {
    platform: string;
    url: string;
    icon?: string;
  }[];
  copyright?: string;
}

// Newsletter
export interface NewsletterProps {
  title?: string;
  subtitle?: string;
  placeholder?: string;
  buttonText?: string;
  disclaimer?: string;
}

// Section Header
export interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  centered?: boolean;
}

// ============================================================================
// Editorial Components (Cinque Terre Theme)
// ============================================================================

// Editorial Hero - Large hero with badge, title, subtitle, and background image
export interface EditorialHeroProps {
  title: string;
  subtitle?: string;
  badge?: string;
  image: string;
  height?: string;
}

// Editorial Intro - Centered intro with badge, quote, and two-column content
export interface EditorialIntroProps {
  badge: string;
  quote: string;
  leftContent: string;
  rightContent: string;
}

// Editorial Interlude - Highlighted break between content sections
export interface EditorialInterludeProps {
  badge?: string;
  title: string;
  quote: string;
  interludeType?: 'primary' | 'secondary';
  align?: 'left' | 'right';
  icon?: string;
}

// Editor Note - Expert quote with avatar (Giulia Rossi "Local Perspective")
export interface EditorNoteProps {
  quote: string;
  author?: string;
  role?: string;
  image?: string;
}

// Closing Note - Dark reflective closing section
export interface ClosingNoteAction {
  label: string;
  href: string;
  variant?: 'primary' | 'secondary';
}

export interface ClosingNoteProps {
  badge?: string;
  title: string;
  content: string;
  actions?: ClosingNoteAction[];
  backgroundIcon?: string;
}

// Block type union for ContentRenderer
export type BlockType =
  | 'hero-section'
  | 'stats-section'
  | 'feature-section'
  | 'village-selector'
  | 'places-to-stay'
  | 'featured-carousel'
  | 'village-intro'
  | 'eat-drink'
  | 'newsletter'
  | 'section-header'
  // Editorial blocks
  | 'editorial-hero'
  | 'editorial-intro'
  | 'editorial-interlude'
  | 'editor-note'
  | 'closing-note';

export interface Block {
  type: BlockType;
  [key: string]: unknown;
}
