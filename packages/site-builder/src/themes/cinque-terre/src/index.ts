/**
 * Cinque Terre Theme
 * A luxury editorial travel magazine theme
 *
 * Usage:
 * 1. Import components from this theme
 * 2. Pass JSON content as props
 * 3. Components render the content with the theme's visual style
 */

// Export types
export * from './types';

// Export registry
export * from './registry';

// Export React components
export { default as Header } from './components/Header';
export { default as Footer } from './components/Footer';
export { default as FeaturedCarousel } from './components/FeaturedCarousel';

// Theme metadata
export const themeInfo = {
    name: 'cinque-terre',
    displayName: 'Cinque Terre Dispatch',
    description: 'A luxury editorial travel magazine theme with rich typography and modern design',
    version: '1.0.0',
    author: 'swarm.press',

    // Features
    features: {
        darkMode: true,
        multiLanguage: true,
        responsive: true,
    },

    // Required dependencies
    dependencies: [
        '@radix-ui/react-slot',
        '@radix-ui/react-dialog',
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
        'embla-carousel-react',
        'lucide-react',
    ],

    // Supported block types
    blockTypes: [
        'hero-section',
        'stats-section',
        'feature-section',
        'village-selector',
        'places-to-stay',
        'featured-carousel',
        'village-intro',
        'eat-drink',
        'newsletter',
        'section-header',
    ],
};
