/**
 * LinkingRulesEditor Component
 * Configure internal linking rules for blueprint
 */

import React from 'react'
import type { LinkingRules } from './BlueprintEditor'

interface LinkingRulesEditorProps {
  rules: LinkingRules
  onChange: (rules: LinkingRules) => void
}

export default function LinkingRulesEditor({ rules, onChange }: LinkingRulesEditorProps) {
  function updateRule<K extends keyof LinkingRules>(key: K, value: LinkingRules[K]) {
    onChange({ ...rules, [key]: value })
  }

  return (
    <div className="max-w-4xl">
      <div className="bg-white rounded-lg border-2 border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          🔗 Internal Linking Rules
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          Define rules for how pages using this blueprint should link to other pages.
          These rules help maintain a healthy site structure and SEO.
        </p>

        <div className="space-y-6">
          {/* Link Count Limits */}
          <div className="bg-blue-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Link Count Limits</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Minimum Total Links
                </label>
                <input
                  type="number"
                  value={rules.min_total_links || ''}
                  onChange={(e) =>
                    updateRule('min_total_links', parseInt(e.target.value) || undefined)
                  }
                  placeholder="3"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Minimum outgoing internal links required
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Maximum Total Links
                </label>
                <input
                  type="number"
                  value={rules.max_total_links || ''}
                  onChange={(e) =>
                    updateRule('max_total_links', parseInt(e.target.value) || undefined)
                  }
                  placeholder="10"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Maximum outgoing internal links allowed
                </p>
              </div>
            </div>
          </div>

          {/* Page Type Requirements */}
          <div className="bg-purple-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Page Type Requirements</h4>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Must Link To Page Types (comma-separated)
              </label>
              <input
                type="text"
                value={rules.must_link_to_page_type?.join(', ') || ''}
                onChange={(e) =>
                  updateRule(
                    'must_link_to_page_type',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  )
                }
                placeholder="e.g., category, homepage"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Pages must link to at least one page of these types
              </p>
            </div>
          </div>

          {/* Forbidden Slugs */}
          <div className="bg-red-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">Forbidden Links</h4>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Forbidden Slugs (comma-separated)
              </label>
              <input
                type="text"
                value={rules.forbidden_slugs?.join(', ') || ''}
                onChange={(e) =>
                  updateRule(
                    'forbidden_slugs',
                    e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  )
                }
                placeholder="e.g., /admin, /private"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-red-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                Pages should not link to these slugs
              </p>
            </div>
          </div>

          {/* Examples */}
          <div className="bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">💡 Examples</h4>
            <div className="space-y-3 text-sm text-gray-700">
              <div>
                <strong>Blog Post Blueprint:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                  <li>Min links: 3, Max links: 8</li>
                  <li>Must link to: category, related-post</li>
                </ul>
              </div>
              <div>
                <strong>Category Page Blueprint:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                  <li>Min links: 5, Max links: 20</li>
                  <li>Must link to: homepage, article</li>
                </ul>
              </div>
              <div>
                <strong>Landing Page Blueprint:</strong>
                <ul className="list-disc list-inside ml-4 mt-1 text-gray-600">
                  <li>Min links: 1, Max links: 3</li>
                  <li>Focus on conversion, minimal distractions</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
