/**
 * ComponentLibrary Component
 * Draggable component palette for blueprint editor
 *
 * Contains all 123 section components organized by category
 */

import React, { useState } from 'react'
import { ChevronDown, ChevronRight, Search } from 'lucide-react'

interface ComponentDef {
  type: string
  variant: string
  icon: string
  label: string
  description: string
}

interface ComponentLibraryProps {
  onAddComponent: (type: string, variant: string) => void
}

const COMPONENT_CATEGORIES: Record<string, ComponentDef[]> = {
  'Hero Sections': [
    { type: 'hero', variant: 'simple-centered', icon: '🎯', label: 'Simple Centered', description: 'Clean centered hero with title and CTA' },
    { type: 'hero', variant: 'simple-centered-with-background', icon: '🎯', label: 'Centered with Background', description: 'Centered hero with background image' },
    { type: 'hero', variant: 'split-with-image', icon: '🎯', label: 'Split with Image', description: 'Two-column hero with side image' },
    { type: 'hero', variant: 'with-angled-image', icon: '🎯', label: 'Angled Image', description: 'Hero with angled image overlay' },
    { type: 'hero', variant: 'with-app-screenshot', icon: '🎯', label: 'App Screenshot', description: 'Hero showcasing app interface' },
    { type: 'hero', variant: 'with-image-tiles', icon: '🎯', label: 'Image Tiles', description: 'Hero with grid of images' },
    { type: 'hero', variant: 'with-offset-image', icon: '🎯', label: 'Offset Image', description: 'Hero with offset positioned image' },
    { type: 'hero', variant: 'with-phone-mockup', icon: '🎯', label: 'Phone Mockup', description: 'Hero with mobile phone mockup' },
  ],
  'Header Sections': [
    { type: 'header', variant: 'simple', icon: '📋', label: 'Simple', description: 'Basic page header' },
    { type: 'header', variant: 'simple-with-eyebrow', icon: '📋', label: 'Simple with Eyebrow', description: 'Header with eyebrow text' },
    { type: 'header', variant: 'simple-with-background-image', icon: '📋', label: 'Simple with Background', description: 'Header with background image' },
    { type: 'header', variant: 'centered', icon: '📋', label: 'Centered', description: 'Centered page header' },
    { type: 'header', variant: 'centered-with-eyebrow', icon: '📋', label: 'Centered with Eyebrow', description: 'Centered header with eyebrow' },
    { type: 'header', variant: 'centered-with-background-image', icon: '📋', label: 'Centered with Background', description: 'Centered header with background' },
    { type: 'header', variant: 'with-cards', icon: '📋', label: 'With Cards', description: 'Header with card elements' },
    { type: 'header', variant: 'with-stats', icon: '📋', label: 'With Stats', description: 'Header with statistics' },
  ],
  'Feature Sections': [
    { type: 'features', variant: 'simple', icon: '🧩', label: 'Simple', description: 'Basic feature list' },
    { type: 'features', variant: 'simple-3x2-grid', icon: '🧩', label: '3x2 Grid', description: 'Six features in 3x2 grid' },
    { type: 'features', variant: 'centered-2x2-grid', icon: '🧩', label: 'Centered 2x2', description: 'Four features centered' },
    { type: 'features', variant: 'offset-2x2-grid', icon: '🧩', label: 'Offset 2x2', description: 'Four features offset layout' },
    { type: 'features', variant: 'offset-with-feature-list', icon: '🧩', label: 'Offset with List', description: 'Features with offset list' },
    { type: 'features', variant: 'three-column-with-large-icons', icon: '🧩', label: '3 Col Large Icons', description: 'Three columns with large icons' },
    { type: 'features', variant: 'three-column-with-small-icons', icon: '🧩', label: '3 Col Small Icons', description: 'Three columns with small icons' },
    { type: 'features', variant: 'contained-in-panel', icon: '🧩', label: 'Contained Panel', description: 'Features in contained panel' },
    { type: 'features', variant: 'with-product-screenshot', icon: '🧩', label: 'Product Screenshot', description: 'Features with product image' },
    { type: 'features', variant: 'with-product-screenshot-on-left', icon: '🧩', label: 'Screenshot Left', description: 'Screenshot on left side' },
    { type: 'features', variant: 'with-product-screenshot-panel', icon: '🧩', label: 'Screenshot Panel', description: 'Screenshot in panel' },
    { type: 'features', variant: 'with-large-screenshot', icon: '🧩', label: 'Large Screenshot', description: 'Features with large image' },
    { type: 'features', variant: 'with-large-bordered-screenshot', icon: '🧩', label: 'Bordered Screenshot', description: 'Screenshot with border' },
    { type: 'features', variant: 'with-code-example-panel', icon: '🧩', label: 'Code Example', description: 'Features with code panel' },
    { type: 'features', variant: 'with-testimonial', icon: '🧩', label: 'With Testimonial', description: 'Features with quote' },
  ],
  'Content Sections': [
    { type: 'content', variant: 'centered', icon: '📝', label: 'Centered', description: 'Centered content block' },
    { type: 'content', variant: 'split-with-image', icon: '📝', label: 'Split with Image', description: 'Content with side image' },
    { type: 'content', variant: 'two-columns-with-screenshot', icon: '📝', label: 'Two Columns Screenshot', description: 'Two column with screenshot' },
    { type: 'content', variant: 'with-image-tiles', icon: '📝', label: 'Image Tiles', description: 'Content with image grid' },
    { type: 'content', variant: 'with-sticky-product-screenshot', icon: '📝', label: 'Sticky Screenshot', description: 'Content with sticky image' },
    { type: 'content', variant: 'with-testimonial', icon: '📝', label: 'With Testimonial', description: 'Content with quote' },
    { type: 'content', variant: 'with-testimonial-and-stats', icon: '📝', label: 'Testimonial + Stats', description: 'Content with quote and stats' },
  ],
  'CTA Sections': [
    { type: 'cta', variant: 'simple-centered', icon: '📣', label: 'Simple Centered', description: 'Basic centered call-to-action' },
    { type: 'cta', variant: 'simple-stacked', icon: '📣', label: 'Simple Stacked', description: 'Stacked CTA layout' },
    { type: 'cta', variant: 'simple-justified', icon: '📣', label: 'Simple Justified', description: 'Justified CTA layout' },
    { type: 'cta', variant: 'simple-centered-on-brand', icon: '📣', label: 'Centered on Brand', description: 'CTA on brand color' },
    { type: 'cta', variant: 'simple-centered-with-gradient', icon: '📣', label: 'With Gradient', description: 'CTA with gradient background' },
    { type: 'cta', variant: 'simple-justified-on-subtle-brand', icon: '📣', label: 'Justified Subtle', description: 'Subtle brand background' },
    { type: 'cta', variant: 'centered-on-dark-panel', icon: '📣', label: 'Dark Panel', description: 'CTA on dark background' },
    { type: 'cta', variant: 'split-with-image', icon: '📣', label: 'Split with Image', description: 'CTA with side image' },
    { type: 'cta', variant: 'dark-panel-with-app-screenshot', icon: '📣', label: 'Dark + Screenshot', description: 'Dark panel with app image' },
    { type: 'cta', variant: 'two-columns-with-photo', icon: '📣', label: 'Two Columns Photo', description: 'Two column with photo' },
    { type: 'cta', variant: 'with-image-tiles', icon: '📣', label: 'Image Tiles', description: 'CTA with image grid' },
  ],
  'Stats Sections': [
    { type: 'stats', variant: 'simple', icon: '📊', label: 'Simple', description: 'Basic statistics display' },
    { type: 'stats', variant: 'simple-grid', icon: '📊', label: 'Simple Grid', description: 'Stats in grid layout' },
    { type: 'stats', variant: 'with-description', icon: '📊', label: 'With Description', description: 'Stats with text description' },
    { type: 'stats', variant: 'with-two-column-description', icon: '📊', label: 'Two Column Description', description: 'Stats with two column text' },
    { type: 'stats', variant: 'split-with-image', icon: '📊', label: 'Split with Image', description: 'Stats beside image' },
    { type: 'stats', variant: 'stepped', icon: '📊', label: 'Stepped', description: 'Stepped statistics layout' },
    { type: 'stats', variant: 'timeline', icon: '📊', label: 'Timeline', description: 'Stats as timeline' },
    { type: 'stats', variant: 'with-background-image', icon: '📊', label: 'Background Image', description: 'Stats over background' },
  ],
  'Testimonial Sections': [
    { type: 'testimonials', variant: 'simple-centered', icon: '💬', label: 'Simple Centered', description: 'Single centered testimonial' },
    { type: 'testimonials', variant: 'with-large-avatar', icon: '💬', label: 'Large Avatar', description: 'Testimonial with large photo' },
    { type: 'testimonials', variant: 'with-star-rating', icon: '💬', label: 'Star Rating', description: 'Testimonial with rating' },
    { type: 'testimonials', variant: 'side-by-side', icon: '💬', label: 'Side by Side', description: 'Two testimonials side by side' },
    { type: 'testimonials', variant: 'grid', icon: '💬', label: 'Grid', description: 'Multiple testimonials grid' },
    { type: 'testimonials', variant: 'subtle-grid', icon: '💬', label: 'Subtle Grid', description: 'Grid with subtle styling' },
    { type: 'testimonials', variant: 'with-background-image', icon: '💬', label: 'Background Image', description: 'Testimonial over image' },
    { type: 'testimonials', variant: 'with-overlapping-image', icon: '💬', label: 'Overlapping Image', description: 'Quote with overlapping photo' },
  ],
  'FAQ Sections': [
    { type: 'faq', variant: 'centered-accordion', icon: '❓', label: 'Centered Accordion', description: 'Expandable FAQ list' },
    { type: 'faq', variant: 'offset-with-supporting-text', icon: '❓', label: 'Offset with Text', description: 'FAQ with side description' },
    { type: 'faq', variant: 'side-by-side', icon: '❓', label: 'Side by Side', description: 'Two column FAQ' },
    { type: 'faq', variant: 'two-columns', icon: '❓', label: 'Two Columns', description: 'FAQ in two columns' },
    { type: 'faq', variant: 'two-columns-with-centered-intro', icon: '❓', label: '2 Col Centered Intro', description: 'Two columns with intro' },
    { type: 'faq', variant: 'three-columns', icon: '❓', label: 'Three Columns', description: 'FAQ in three columns' },
    { type: 'faq', variant: 'three-columns-with-centered-intro', icon: '❓', label: '3 Col Centered Intro', description: 'Three columns with intro' },
  ],
  'Team Sections': [
    { type: 'team', variant: 'with-small-images', icon: '👥', label: 'Small Images', description: 'Team with small photos' },
    { type: 'team', variant: 'with-medium-images', icon: '👥', label: 'Medium Images', description: 'Team with medium photos' },
    { type: 'team', variant: 'with-large-images', icon: '👥', label: 'Large Images', description: 'Team with large photos' },
    { type: 'team', variant: 'with-vertical-images', icon: '👥', label: 'Vertical Images', description: 'Portrait orientation photos' },
    { type: 'team', variant: 'full-width-vertical-images', icon: '👥', label: 'Full Width Vertical', description: 'Large vertical photos' },
    { type: 'team', variant: 'grid-round-images', icon: '👥', label: 'Grid Round', description: 'Circular team photos' },
    { type: 'team', variant: 'grid-large-round-images', icon: '👥', label: 'Large Round', description: 'Large circular photos' },
    { type: 'team', variant: 'large-grid-with-cards', icon: '👥', label: 'Cards', description: 'Team in card format' },
    { type: 'team', variant: 'with-image-and-paragraph', icon: '👥', label: 'Image + Paragraph', description: 'Team with bio text' },
  ],
  'Contact Sections': [
    { type: 'contact', variant: 'simple-centered', icon: '📧', label: 'Simple Centered', description: 'Basic contact info' },
    { type: 'contact', variant: 'centered', icon: '📧', label: 'Centered', description: 'Centered contact section' },
    { type: 'contact', variant: 'four-column', icon: '📧', label: 'Four Column', description: 'Multiple contact options' },
    { type: 'contact', variant: 'side-by-side-grid', icon: '📧', label: 'Side by Side Grid', description: 'Contact info in grid' },
    { type: 'contact', variant: 'split-with-image', icon: '📧', label: 'Split with Image', description: 'Contact with side image' },
    { type: 'contact', variant: 'split-with-pattern', icon: '📧', label: 'Split with Pattern', description: 'Contact with pattern bg' },
    { type: 'contact', variant: 'with-testimonial', icon: '📧', label: 'With Testimonial', description: 'Contact with quote' },
  ],
  'Pricing Sections': [
    { type: 'pricing', variant: 'single-price', icon: '💰', label: 'Single Price', description: 'One pricing option' },
    { type: 'pricing', variant: 'two-tiers', icon: '💰', label: 'Two Tiers', description: 'Two pricing options' },
    { type: 'pricing', variant: 'two-tiers-with-extra', icon: '💰', label: 'Two + Extra', description: 'Two tiers with add-on' },
    { type: 'pricing', variant: 'three-tiers', icon: '💰', label: 'Three Tiers', description: 'Three pricing options' },
    { type: 'pricing', variant: 'three-tiers-emphasized', icon: '💰', label: '3 Tiers Emphasized', description: 'Three with featured tier' },
    { type: 'pricing', variant: 'three-tiers-with-dividers', icon: '💰', label: '3 Tiers Dividers', description: 'Three with divider lines' },
    { type: 'pricing', variant: 'three-tiers-with-toggle', icon: '💰', label: '3 Tiers Toggle', description: 'Three with billing toggle' },
    { type: 'pricing', variant: 'three-tiers-with-comparison', icon: '💰', label: '3 Tiers Comparison', description: 'Three with feature table' },
    { type: 'pricing', variant: 'four-tiers-with-toggle', icon: '💰', label: 'Four Tiers Toggle', description: 'Four with billing toggle' },
    { type: 'pricing', variant: 'with-comparison-table', icon: '💰', label: 'Comparison Table', description: 'Full feature comparison' },
  ],
  'Newsletter Sections': [
    { type: 'newsletter', variant: 'simple-stacked', icon: '📰', label: 'Simple Stacked', description: 'Stacked newsletter form' },
    { type: 'newsletter', variant: 'simple-side-by-side', icon: '📰', label: 'Side by Side', description: 'Inline form layout' },
    { type: 'newsletter', variant: 'simple-side-by-side-on-brand', icon: '📰', label: 'Side by Side Brand', description: 'Inline on brand color' },
    { type: 'newsletter', variant: 'centered-card', icon: '📰', label: 'Centered Card', description: 'Form in card container' },
    { type: 'newsletter', variant: 'side-by-side-on-card', icon: '📰', label: 'Card Side by Side', description: 'Inline form in card' },
    { type: 'newsletter', variant: 'side-by-side-with-details', icon: '📰', label: 'With Details', description: 'Form with extra info' },
  ],
  'Blog Sections': [
    { type: 'blog', variant: 'single-column', icon: '📰', label: 'Single Column', description: 'Single column blog list' },
    { type: 'blog', variant: 'single-column-with-images', icon: '📰', label: 'Single + Images', description: 'Single column with images' },
    { type: 'blog', variant: 'three-column', icon: '📰', label: 'Three Column', description: 'Three column blog grid' },
    { type: 'blog', variant: 'three-column-with-images', icon: '📰', label: '3 Col + Images', description: 'Three column with images' },
    { type: 'blog', variant: 'three-column-with-background-images', icon: '📰', label: '3 Col Background', description: 'Cards with bg images' },
    { type: 'blog', variant: 'with-featured-post', icon: '📰', label: 'Featured Post', description: 'Highlighted main post' },
    { type: 'blog', variant: 'with-photo-and-list', icon: '📰', label: 'Photo + List', description: 'Photo with article list' },
  ],
  'Logo Cloud Sections': [
    { type: 'logo-cloud', variant: 'simple', icon: '🏢', label: 'Simple', description: 'Basic logo display' },
    { type: 'logo-cloud', variant: 'simple-left-aligned', icon: '🏢', label: 'Left Aligned', description: 'Logos aligned left' },
    { type: 'logo-cloud', variant: 'simple-with-heading', icon: '🏢', label: 'With Heading', description: 'Logos with title' },
    { type: 'logo-cloud', variant: 'simple-with-cta', icon: '🏢', label: 'With CTA', description: 'Logos with call-to-action' },
    { type: 'logo-cloud', variant: 'grid', icon: '🏢', label: 'Grid', description: 'Logos in grid layout' },
    { type: 'logo-cloud', variant: 'split-with-logos-on-right', icon: '🏢', label: 'Split Right', description: 'Text left, logos right' },
  ],
  'Bento Grid Sections': [
    { type: 'bento-grid', variant: 'three-column', icon: '🧱', label: 'Three Column', description: 'Three column bento layout' },
    { type: 'bento-grid', variant: 'two-row', icon: '🧱', label: 'Two Row', description: 'Two row bento layout' },
    { type: 'bento-grid', variant: 'two-row-three-column-second-row', icon: '🧱', label: 'Complex Grid', description: 'Mixed column layout' },
  ],
  'Footer Sections': [
    { type: 'footer', variant: 'simple-centered', icon: '🔚', label: 'Simple Centered', description: 'Basic centered footer' },
    { type: 'footer', variant: 'simple-with-social-links', icon: '🔚', label: 'With Social', description: 'Footer with social icons' },
    { type: 'footer', variant: 'four-column-simple', icon: '🔚', label: '4 Column Simple', description: 'Four column footer' },
    { type: 'footer', variant: 'four-column-with-newsletter', icon: '🔚', label: '4 Col Newsletter', description: 'Four columns + signup' },
    { type: 'footer', variant: 'four-column-with-newsletter-below', icon: '🔚', label: '4 Col News Below', description: 'Newsletter below columns' },
    { type: 'footer', variant: 'four-column-with-mission', icon: '🔚', label: '4 Col Mission', description: 'Footer with mission text' },
    { type: 'footer', variant: 'four-column-with-cta', icon: '🔚', label: '4 Col CTA', description: 'Four columns with CTA' },
  ],
  'Collections': [
    { type: 'collection', variant: 'embed', icon: '📦', label: 'Collection Embed', description: 'Embed collection items (POIs, Events, etc.)' },
    { type: 'collection', variant: 'grid', icon: '📦', label: 'Collection Grid', description: 'Collection in grid layout' },
    { type: 'collection', variant: 'list', icon: '📦', label: 'Collection List', description: 'Collection as list' },
    { type: 'collection', variant: 'carousel', icon: '📦', label: 'Collection Carousel', description: 'Collection as carousel' },
  ],
}

// Count total components
const TOTAL_COMPONENTS = Object.values(COMPONENT_CATEGORIES).reduce(
  (sum, category) => sum + category.length,
  0
)

export default function ComponentLibrary({ onAddComponent }: ComponentLibraryProps) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(['Hero Sections']))
  const [searchQuery, setSearchQuery] = useState('')

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  // Filter components by search query
  const filteredCategories = searchQuery.trim()
    ? Object.entries(COMPONENT_CATEGORIES).reduce(
        (acc, [category, components]) => {
          const filtered = components.filter(
            (c) =>
              c.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
              c.variant.toLowerCase().includes(searchQuery.toLowerCase())
          )
          if (filtered.length > 0) {
            acc[category] = filtered
          }
          return acc
        },
        {} as Record<string, ComponentDef[]>
      )
    : COMPONENT_CATEGORIES

  const matchCount = searchQuery.trim()
    ? Object.values(filteredCategories).reduce((sum, c) => sum + c.length, 0)
    : TOTAL_COMPONENTS

  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-4 sticky top-24 max-h-[calc(100vh-8rem)] overflow-hidden flex flex-col">
      <div className="flex-shrink-0">
        <h3 className="font-semibold text-gray-900 mb-1">Component Library</h3>
        <p className="text-xs text-gray-500 mb-3">
          {matchCount} component{matchCount !== 1 ? 's' : ''} available
        </p>

        {/* Search input */}
        <div className="relative mb-4">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {Object.entries(filteredCategories).map(([category, components]) => (
          <div key={category}>
            <button
              onClick={() => toggleCategory(category)}
              className="w-full flex items-center gap-2 px-2 py-2 text-left hover:bg-gray-50 rounded-md transition-colors"
            >
              {expandedCategories.has(category) ? (
                <ChevronDown className="h-4 w-4 text-gray-500 flex-shrink-0" />
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-500 flex-shrink-0" />
              )}
              <span className="text-sm font-medium text-gray-700">{category}</span>
              <span className="text-xs text-gray-400 ml-auto">{components.length}</span>
            </button>

            {expandedCategories.has(category) && (
              <div className="ml-2 space-y-0.5 pb-2">
                {components.map((component) => (
                  <button
                    key={`${component.type}-${component.variant}`}
                    onClick={() => onAddComponent(component.type, component.variant)}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 hover:border-blue-200 border border-transparent transition-colors group"
                    title={component.description}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-base flex-shrink-0">{component.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 group-hover:text-blue-700">
                          {component.label}
                        </div>
                        <div className="text-xs text-gray-500 truncate">{component.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {Object.keys(filteredCategories).length === 0 && (
          <div className="text-center py-8 text-gray-500">
            <p className="text-sm">No components match "{searchQuery}"</p>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 mt-4 pt-4 border-t text-xs text-gray-500">
        <p className="mb-2">
          <strong>Tip:</strong> Click to add components to your blueprint.
        </p>
        <p>Drag components in the canvas to reorder them.</p>
      </div>
    </div>
  )
}

// Export for use in other components
export { COMPONENT_CATEGORIES, type ComponentDef }
