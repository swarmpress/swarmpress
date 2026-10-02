/**
 * Kit defaults: neutral fallback renderers for every core block, default
 * layouts and chrome. Themes override any subset.
 */
import Blocks from './Blocks.astro'
import BlogArticle from './blocks/BlogArticle.astro'
import BlogIndex from './blocks/BlogIndex.astro'
import Callout from './blocks/Callout.astro'
import Cards from './blocks/Cards.astro'
import ClosingNote from './blocks/ClosingNote.astro'
import CollectionBlock from './blocks/CollectionBlock.astro'
import EditorialIntro from './blocks/EditorialIntro.astro'
import Embed from './blocks/Embed.astro'
import Faq from './blocks/Faq.astro'
import Figure from './blocks/Figure.astro'
import Gallery from './blocks/Gallery.astro'
import Heading from './blocks/Heading.astro'
import Hero from './blocks/Hero.astro'
import List from './blocks/List.astro'
import Paragraph from './blocks/Paragraph.astro'
import Quote from './blocks/Quote.astro'
import SectionHeader from './blocks/SectionHeader.astro'
import Footer from './chrome/Footer.astro'
import Header from './chrome/Header.astro'
import LanguageSwitcher from './chrome/LanguageSwitcher.astro'
import RegionNav from './chrome/RegionNav.astro'
import Article from './layouts/Article.astro'
import Base from './layouts/Base.astro'
import CollectionIndex from './layouts/CollectionIndex.astro'
import CollectionItem from './layouts/CollectionItem.astro'
import NotFound from './layouts/NotFound.astro'
import Page from './layouts/Page.astro'
import Region from './layouts/Region.astro'
import { FALLBACK_RENDERER, type FallbackName } from '../src/blocks/fallback-map'

const BY_NAME: Record<FallbackName, unknown> = {
  Paragraph,
  Heading,
  Hero,
  Figure,
  Gallery,
  Quote,
  List,
  Faq,
  Callout,
  Embed,
  CollectionBlock,
  Cards,
  ClosingNote,
  EditorialIntro,
  SectionHeader,
  BlogArticle,
  BlogIndex,
}

/** Core block type → neutral renderer component. */
export const FALLBACKS: Record<string, unknown> = Object.fromEntries(
  Object.entries(FALLBACK_RENDERER).map(([type, name]) => [type, BY_NAME[name]]),
)

export const DEFAULT_LAYOUTS = { Base, Page, Article, Region, CollectionIndex, CollectionItem, NotFound }
export const DEFAULT_CHROME = { Header, Footer, LanguageSwitcher, RegionNav }
export { Blocks }
