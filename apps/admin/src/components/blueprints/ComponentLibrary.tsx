/**
 * ComponentLibrary Component
 * Draggable component palette for blueprint editor
 */

import React from 'react'

interface ComponentLibraryProps {
  onAddComponent: (type: string) => void
}

const COMPONENT_CATEGORIES = {
  'Content Blocks': [
    { type: 'hero', icon: '🎯', label: 'Hero Section', description: 'Large header with title and CTA' },
    { type: 'paragraph', icon: '📝', label: 'Paragraph', description: 'Text content block' },
    { type: 'heading', icon: '📌', label: 'Heading', description: 'Section heading' },
    { type: 'list', icon: '📋', label: 'List', description: 'Bulleted or numbered list' },
    { type: 'quote', icon: '💬', label: 'Quote', description: 'Blockquote or testimonial' },
  ],
  'Media': [
    { type: 'image', icon: '🖼️', label: 'Image', description: 'Single image with caption' },
    { type: 'gallery', icon: '🎨', label: 'Gallery', description: 'Image gallery grid' },
    { type: 'video', icon: '🎬', label: 'Video', description: 'Embedded video player' },
  ],
  'Interactive': [
    { type: 'cta', icon: '🎯', label: 'Call to Action', description: 'Button or link CTA' },
    { type: 'form', icon: '📝', label: 'Form', description: 'Contact or lead form' },
    { type: 'accordion', icon: '📁', label: 'Accordion', description: 'Expandable sections' },
    { type: 'tabs', icon: '📑', label: 'Tabs', description: 'Tabbed content' },
  ],
  'Structured Data': [
    { type: 'faq', icon: '❓', label: 'FAQ', description: 'Frequently asked questions' },
    { type: 'table', icon: '📊', label: 'Table', description: 'Data table' },
    { type: 'pricing', icon: '💰', label: 'Pricing Table', description: 'Product pricing grid' },
    { type: 'timeline', icon: '⏱️', label: 'Timeline', description: 'Event timeline' },
  ],
  'SEO & Meta': [
    { type: 'breadcrumbs', icon: '🍞', label: 'Breadcrumbs', description: 'Navigation breadcrumbs' },
    { type: 'related-links', icon: '🔗', label: 'Related Links', description: 'Internal link suggestions' },
    { type: 'author-bio', icon: '👤', label: 'Author Bio', description: 'Author information' },
  ],
}

export default function ComponentLibrary({ onAddComponent }: ComponentLibraryProps) {
  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-4 sticky top-24 max-h-[calc(100vh-8rem)] overflow-y-auto">
      <h3 className="font-semibold text-gray-900 mb-4">Component Library</h3>

      <div className="space-y-6">
        {Object.entries(COMPONENT_CATEGORIES).map(([category, components]) => (
          <div key={category}>
            <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
              {category}
            </h4>
            <div className="space-y-1">
              {components.map((component) => (
                <button
                  key={component.type}
                  onClick={() => onAddComponent(component.type)}
                  className="w-full text-left px-3 py-2 rounded-md hover:bg-blue-50 hover:border-blue-200 border border-transparent transition-colors group"
                  title={component.description}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{component.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 group-hover:text-blue-700">
                        {component.label}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {component.description}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t text-xs text-gray-500">
        <p className="mb-2">💡 <strong>Tip:</strong> Click to add components to your blueprint.</p>
        <p>Drag components in the canvas to reorder them.</p>
      </div>
    </div>
  )
}
