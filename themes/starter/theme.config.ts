/**
 * Starter theme — a clean, accessible, niche-agnostic editorial magazine.
 *
 * Everything here is optional: files under layouts/, chrome/ and blocks/ are
 * discovered by convention. Listing them explicitly documents the contract
 * and lets a site swap a single piece.
 */
import { defineTheme } from '@swarm-press/site-kit'
import tokens from './tokens.json'

import Article from './layouts/Article.astro'
import Base from './layouts/Base.astro'

import Footer from './chrome/Footer.astro'
import Header from './chrome/Header.astro'
import LanguageSwitcher from './chrome/LanguageSwitcher.astro'
import RegionNav from './chrome/RegionNav.astro'

import Callout from './blocks/callout.astro'
import ClosingNote from './blocks/closing-note.astro'
import CollectionWithInterludes from './blocks/collection-with-interludes.astro'
import EditorialHero from './blocks/editorial-hero.astro'
import EditorialIntro from './blocks/editorial-intro.astro'
import FaqSection from './blocks/faq-section.astro'
import Gallery from './blocks/gallery.astro'
import Heading from './blocks/heading.astro'
import Image from './blocks/image.astro'
import Paragraph from './blocks/paragraph.astro'
import Quote from './blocks/quote.astro'

import KeyFacts from './blocks/key-facts/Component.astro'
import keyFactsSchema from './blocks/key-facts/schema.json'

export default defineTheme({
  name: 'starter',
  tokens,
  // Page, Region, CollectionIndex, CollectionItem and NotFound use the kit defaults.
  layouts: { Base, Article },
  chrome: { Header, Footer, LanguageSwitcher, RegionNav },
  blocks: {
    'editorial-hero': EditorialHero,
    'editorial-intro': EditorialIntro,
    'collection-with-interludes': CollectionWithInterludes,
    'closing-note': ClosingNote,
    'faq-section': FaqSection,
    paragraph: Paragraph,
    heading: Heading,
    image: Image,
    gallery: Gallery,
    quote: Quote,
    callout: Callout,
  },
  customBlocks: [{ name: 'key-facts', component: KeyFacts, schema: keyFactsSchema }],
  islands: {},
})
