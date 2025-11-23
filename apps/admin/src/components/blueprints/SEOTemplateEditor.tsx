/**
 * SEOTemplateEditor Component
 * Configure SEO metadata templates for blueprint
 */

import React from 'react'
import type { SEOTemplate } from './BlueprintEditor'

interface SEOTemplateEditorProps {
  template: SEOTemplate
  onChange: (template: SEOTemplate) => void
}

export default function SEOTemplateEditor({ template, onChange }: SEOTemplateEditorProps) {
  function updateTemplate<K extends keyof SEOTemplate>(key: K, value: SEOTemplate[K]) {
    onChange({ ...template, [key]: value })
  }

  return (
    <div className="max-w-4xl">
      <div className="bg-white rounded-lg border-2 border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          🎯 SEO Template
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Define patterns for generating SEO metadata. Use variables like {'{'}title{'}'}, {'{'}keyword{'}'}, {'{'}date{'}'}
          to create dynamic templates.
        </p>

        <div className="space-y-6">
          {/* Title Pattern */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Title Pattern
            </label>
            <input
              type="text"
              value={template.title_pattern || ''}
              onChange={(e) => updateTemplate('title_pattern', e.target.value)}
              placeholder="e.g., {title} | {siteName}"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Pattern for generating page titles. Max 60 characters recommended.
            </p>
            <div className="mt-2 bg-blue-50 rounded p-2 text-xs">
              <strong>Example:</strong> "{'{'}title{'}'} - Complete Guide | {'{'}siteName{'}'}"
              <br />
              <strong>Result:</strong> "React Hooks - Complete Guide | DevBlog"
            </div>
          </div>

          {/* Meta Description Pattern */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Meta Description Pattern
            </label>
            <textarea
              value={template.meta_description_pattern || ''}
              onChange={(e) => updateTemplate('meta_description_pattern', e.target.value)}
              placeholder="e.g., Learn about {keyword}. {summary} Read more at {siteName}."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 font-mono text-sm"
            />
            <p className="text-xs text-gray-500 mt-1">
              Pattern for generating meta descriptions. 150-160 characters recommended.
            </p>
            <div className="mt-2 bg-blue-50 rounded p-2 text-xs">
              <strong>Example:</strong> "Learn about {'{'}keyword{'}'}. {'{'}summary{'}'} Read our complete guide."
              <br />
              <strong>Result:</strong> "Learn about React Hooks. Master state management in functional components. Read our complete guide."
            </div>
          </div>

          {/* Required Keywords */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Required Keywords (comma-separated)
            </label>
            <input
              type="text"
              value={template.required_keywords?.join(', ') || ''}
              onChange={(e) =>
                updateTemplate(
                  'required_keywords',
                  e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                )
              }
              placeholder="e.g., react, javascript, tutorial"
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Keywords that must appear in the content for SEO validation
            </p>
          </div>

          {/* Available Variables */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">📝 Available Variables</h4>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}title{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Page title</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}keyword{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Primary keyword</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}siteName{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Website name</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}category{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Content category</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}summary{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Brief summary</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}date{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Publication date</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}author{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Author name</p>
              </div>
              <div>
                <code className="bg-white px-2 py-1 rounded text-blue-600">{'{'}slug{'}'}</code>
                <p className="text-gray-600 text-xs mt-1">Page URL slug</p>
              </div>
            </div>
          </div>

          {/* Blueprint Examples */}
          <div className="bg-green-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">💡 Blueprint Examples</h4>
            <div className="space-y-3 text-sm text-gray-700">
              <div>
                <strong>Blog Post:</strong>
                <div className="ml-4 mt-1 text-gray-600 font-mono text-xs">
                  Title: "{'{'}title{'}'} | {'{'}siteName{'}'}"
                  <br />
                  Description: "Learn about {'{'}keyword{'}'}. {'{'}summary{'}'}"
                </div>
              </div>
              <div>
                <strong>Product Page:</strong>
                <div className="ml-4 mt-1 text-gray-600 font-mono text-xs">
                  Title: "Buy {'{'}title{'}'} - Best Deals | {'{'}siteName{'}'}"
                  <br />
                  Description: "{'{'}title{'}'}. {'{'}summary{'}'} Free shipping available."
                </div>
              </div>
              <div>
                <strong>Category Page:</strong>
                <div className="ml-4 mt-1 text-gray-600 font-mono text-xs">
                  Title: "{'{'}category{'}'} Articles & Guides | {'{'}siteName{'}'}"
                  <br />
                  Description: "Browse our {'{'}category{'}'} content. Expert guides and tutorials."
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
