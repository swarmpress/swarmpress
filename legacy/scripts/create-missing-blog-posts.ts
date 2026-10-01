#!/usr/bin/env npx tsx
/**
 * Create Missing Blog Posts
 * Generates blog posts that are referenced by homepage components but don't exist yet
 */

import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

const contentPath = process.argv[2] || 'cinqueterre.travel/content'
const resolvedPath = contentPath.startsWith('/') ? contentPath : join(process.cwd(), contentPath)

interface BlogPost {
  slug: string
  title: string
  subtitle: string
  author: string
  authorBio: string
  category: string
  readTime: string
  image: string
  tags: string[]
  intro: string
  sections: { title: string; text: string }[]
  quote?: { text: string; author: string }
}

const blogPosts: BlogPost[] = [
  {
    slug: 'the-perfect-first-timer-itinerary',
    title: "The Perfect First-Timer Itinerary",
    subtitle: "How to see the best of the five villages in just 3 days, from sunrise hikes to sunset aperitivos.",
    author: "Giulia Rossi",
    authorBio: "A native of Riomaggiore who has spent 15 years guiding travelers through her beloved villages. She knows every secret path and hidden restaurant.",
    category: "Itinerary",
    readTime: "12 min read",
    image: "https://images.unsplash.com/photo-1498503182468-3b51cbb6cb24?q=80&w=2670&auto=format&fit=crop",
    tags: ["Itinerary", "First Time", "Planning", "3 Days"],
    intro: "Three days might seem short for five villages, but with the right plan, you can experience the soul of Cinque Terre without rushing. This itinerary balances iconic sights with local secrets, ensuring you leave with memories—not just photos.",
    sections: [
      {
        title: "Day 1: Riomaggiore & Manarola",
        text: "Start in Riomaggiore, the easternmost village. Arrive by train from La Spezia and spend the morning exploring the colorful harbor. For lunch, grab focaccia from a local bakery. In the afternoon, walk or take the train to Manarola. Watch the sunset from the famous Nessun Dorma terrace with a glass of local Sciacchetrà wine."
      },
      {
        title: "Day 2: Corniglia, Vernazza & the Blue Trail",
        text: "Take the train to Corniglia and climb the 382 steps of the Lardarina stairway. This quiet village rewards early risers with empty streets and authentic atmosphere. If the trail is open, hike to Vernazza (2 hours). Otherwise, take the train and spend the afternoon swimming in Vernazza's harbor and exploring its medieval lanes."
      },
      {
        title: "Day 3: Monterosso & Beach Time",
        text: "End in Monterosso, the only village with a proper sandy beach. Rent an umbrella and spend the morning swimming. For a memorable lunch, book a table at Ristorante Miky for their famous anchovies. Before leaving, walk through the old town and visit the Church of San Giovanni Battista."
      }
    ],
    quote: {
      text: "The secret to Cinque Terre isn't seeing everything—it's letting each village surprise you. Slow down, miss a train on purpose, and let the coast work its magic.",
      author: "Giulia Rossi"
    }
  },
  {
    slug: 'best-time-to-visit-and-when-to-skip',
    title: "Best Time to Visit (and When to Skip)",
    subtitle: "Avoid the crowds and find the perfect weather with this month-by-month guide to Cinque Terre.",
    author: "Marco Bianchi",
    authorBio: "A travel writer who has visited Cinque Terre in every season for the past decade, documenting the rhythms of these villages throughout the year.",
    category: "Planning",
    readTime: "8 min read",
    image: "https://images.unsplash.com/photo-1555979863-69fb96e63359?q=80&w=2670&auto=format&fit=crop",
    tags: ["Planning", "Weather", "Crowds", "Seasons"],
    intro: "Cinque Terre can be paradise or pandemonium depending on when you visit. The difference between a magical experience and a frustrating one often comes down to timing. Here's what each season offers.",
    sections: [
      {
        title: "The Sweet Spot: May and September",
        text: "These shoulder months offer the best balance of weather, crowds, and prices. Temperatures hover around 20-25°C, the sea is swimmable (especially September), and trails are less crowded. Book accommodations 2-3 months ahead for the best options."
      },
      {
        title: "When to Skip: July and August",
        text: "Unless you thrive in crowds and heat, avoid peak summer. Trains are packed, trails have traffic jams, and temperatures can exceed 35°C. If you must visit, arrive at villages by 8 AM or after 6 PM, and book restaurants weeks in advance."
      },
      {
        title: "The Hidden Gem: Late October to November",
        text: "Autumn brings grape harvest festivals, dramatic storms over the sea, and nearly empty trails. Some restaurants close, but those open serve the best seasonal dishes. Pack layers and a rain jacket—the weather is unpredictable but rewarding."
      },
      {
        title: "Winter: December to February",
        text: "The quietest time, but many businesses close. The villages feel authentic, prices are lowest, and you'll have the trails to yourself. Perfect for photography and solitude, but bring warm clothes and low expectations for restaurant availability."
      }
    ]
  },
  {
    slug: 'hiking-the-blue-trail-what-to-expect',
    title: "Hiking the Blue Trail: What to Expect",
    subtitle: "Everything you need to know about the Sentiero Azzurro, from difficulty levels to scenic stops.",
    author: "Luca Verdi",
    authorBio: "A certified hiking guide who has walked every trail in Cinque Terre hundreds of times. He knows where to find shade, water, and the best views.",
    category: "Guides",
    readTime: "10 min read",
    image: "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?q=80&w=2670&auto=format&fit=crop",
    tags: ["Hiking", "Blue Trail", "Sentiero Azzurro", "Outdoors"],
    intro: "The Sentiero Azzurro (Blue Trail) is the most famous hiking path in Cinque Terre, connecting all five villages along the coast. But trail closures, permits, and varying difficulty levels mean you need to plan carefully.",
    sections: [
      {
        title: "Trail Overview & Permits",
        text: "The full Blue Trail is about 12 km and takes 5-6 hours. A Cinque Terre Card (€7.50/day) is required for trail access. Check trail status before visiting—sections close frequently for maintenance, especially the famous Via dell'Amore between Riomaggiore and Manarola."
      },
      {
        title: "Section by Section Difficulty",
        text: "Monterosso to Vernazza: Most challenging section (2 hours, steep stairs). Vernazza to Corniglia: Moderate (1.5 hours, some steep sections). Corniglia to Manarola: Easy-moderate (1 hour, mostly flat). Manarola to Riomaggiore: Easy (30 minutes when open, the romantic Via dell'Amore)."
      },
      {
        title: "What to Bring",
        text: "Sturdy hiking shoes (not sandals), at least 1.5 liters of water per person, sunscreen and hat, snacks (trail has no facilities for long stretches), cash for village stops, and a charged phone with offline maps. Start early to avoid midday heat."
      },
      {
        title: "Best Photo Stops",
        text: "The viewpoint above Vernazza (30 minutes into the trail from Monterosso) offers the most iconic view in Cinque Terre. The terraced vineyards between Corniglia and Manarola provide dramatic agricultural landscapes. Time your hike for golden hour if photography is a priority."
      }
    ],
    quote: {
      text: "The Blue Trail isn't about conquering distance—it's about surrendering to the rhythm of the coast. Stop often. Look back. The views behind you are as good as those ahead.",
      author: "Luca Verdi"
    }
  },
  {
    slug: 'a-photographers-guide-to-manarola-at-sunset',
    title: "A Photographer's Guide to Manarola at Sunset",
    subtitle: "Best angles, times, and settings for capturing the most photogenic village in Cinque Terre.",
    author: "Elena Moretti",
    authorBio: "A professional travel photographer whose images of Cinque Terre have been featured in National Geographic and Condé Nast Traveller.",
    category: "Photography",
    readTime: "6 min read",
    image: "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop",
    tags: ["Photography", "Manarola", "Sunset", "Tips"],
    intro: "Manarola at sunset is one of the most photographed scenes in Italy—and for good reason. Those colorful houses cascading down to the sea, bathed in golden light, create an image that stays with you forever. Here's how to capture it perfectly.",
    sections: [
      {
        title: "The Classic Viewpoint",
        text: "The famous shot is taken from the cemetery pathway and rocks below it, just past the church on the south side of the village. Arrive at least 90 minutes before sunset to claim your spot—serious photographers set up tripods early. The best positions are on the flat rocks near the water."
      },
      {
        title: "Timing Is Everything",
        text: "Check sunset times for your specific date. The magic happens in the 30 minutes before and after sunset. As the sun dips, the houses glow orange, then pink, then the village lights flicker on. Blue hour (20-40 minutes after sunset) creates the most dramatic images with the lights reflected in the sea."
      },
      {
        title: "Camera Settings",
        text: "For sunset: ISO 100-400, aperture f/8-f/11 for sharpness, shutter speed varies with light. For blue hour: ISO 400-800, aperture f/8, shutter 1-8 seconds (tripod essential). Shoot RAW for maximum editing flexibility. A polarizing filter can reduce glare on the water."
      },
      {
        title: "Alternative Angles",
        text: "For something different, try the viewing platform near Nessun Dorma—it's higher and shows more of the terraced hillsides. Or descend to the harbor and shoot upward toward the village. In the morning, the view from the trail toward Corniglia catches beautiful soft light on the village."
      }
    ],
    quote: {
      text: "Everyone photographs Manarola. The challenge isn't getting the shot—it's finding your own perspective. Move around. Try new angles. Let the light guide you.",
      author: "Elena Moretti"
    }
  },
  {
    slug: 'local-train-and-ferry-cheatsheet',
    title: "Local Train & Ferry Cheatsheet",
    subtitle: "Master the logistics of moving between villages with this complete transportation guide.",
    author: "Giulia Rossi",
    authorBio: "Born and raised in Riomaggiore, Giulia has been navigating Cinque Terre's trains and ferries since childhood. She knows every shortcut and schedule quirk.",
    category: "Transport",
    readTime: "7 min read",
    image: "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop",
    tags: ["Transport", "Trains", "Ferries", "Getting Around"],
    intro: "Getting between the five villages is half the adventure—and half the frustration if you're not prepared. Trains run frequently but can be crowded; ferries offer stunning views but depend on weather. Here's everything you need to know.",
    sections: [
      {
        title: "The Train System",
        text: "Trains connect all five villages plus La Spezia and Levanto. Service runs every 15-30 minutes during the day. Journey time between each village is just 2-5 minutes. Buy a Cinque Terre Card for unlimited train travel—it pays for itself after 3-4 trips and includes trail access."
      },
      {
        title: "Ferry Services",
        text: "Ferries operate March-November, weather permitting. They connect Monterosso, Vernazza, Manarola, and Riomaggiore (not Corniglia—no harbor). Single tickets cost €5-15 depending on distance. Day passes available. Ferries offer the best views of the villages from the sea—worth it even if you don't need the transport."
      },
      {
        title: "Pro Tips for Avoiding Crowds",
        text: "Trains between 10 AM and 4 PM are packed in peak season. Either travel early morning or during dinner hours. Always have your ticket ready—inspectors are strict and fines are €50+. The last trains run around 11 PM, but verify current schedules as they change seasonally."
      },
      {
        title: "When Trains Don't Run",
        text: "Strikes happen occasionally—usually announced in advance. Bad weather can suspend both trains (flooding in tunnels) and ferries (rough seas). Have a backup plan: stay in one village and enjoy it deeply, or arrange a private boat transfer if you must move."
      }
    ]
  },
  {
    slug: 'where-to-stay-hotel-vs-airbnb',
    title: "Where to Stay: Hotel vs. Airbnb",
    subtitle: "Pros and cons for every type of traveler, plus insider tips on the best neighborhoods.",
    author: "Sofia Neri",
    authorBio: "A hospitality consultant who has stayed in over 50 different accommodations across Cinque Terre while researching the best options for travelers.",
    category: "Accommodation",
    readTime: "5 min read",
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?q=80&w=2670&auto=format&fit=crop",
    tags: ["Accommodation", "Hotels", "Airbnb", "Where to Stay"],
    intro: "Where you sleep in Cinque Terre shapes your entire experience. Hotels offer convenience; vacation rentals offer authenticity. Here's how to choose—and which neighborhoods to prioritize.",
    sections: [
      {
        title: "The Case for Hotels",
        text: "Hotels offer daily cleaning, breakfast, and reliable amenities. In villages with steep stairs (all of them), hotels near the station or harbor mean less climbing with luggage. Best options: Porto Roca in Monterosso (cliff-top infinity pool), La Torretta Lodge in Manarola (tower suite with views), or Mada Charm in Vernazza (harbor views)."
      },
      {
        title: "The Case for Vacation Rentals",
        text: "Airbnbs and local rentals let you live like a local—cooking with market ingredients, hanging laundry on the line, listening to neighbors' conversations through ancient walls. They're often cheaper for groups and offer more space. Book directly with local owners when possible to support the community."
      },
      {
        title: "Best Village to Stay In",
        text: "Vernazza: Most photogenic, lively evening scene, central location. Manarola: Best sunset views, quieter than Vernazza, great for photographers. Monterosso: Best for families (beach), most restaurants, easiest access. Riomaggiore: Vibrant nightlife, good for young travelers. Corniglia: Quietest, most authentic, requires climbing stairs."
      },
      {
        title: "Booking Strategy",
        text: "Book 3-6 months ahead for peak season. Look for cancellation policies—weather can disrupt plans. Avoid ground-floor rooms near the harbor (noise). Ask about luggage transfer services—many accommodations offer help carrying bags up the stairs for a fee."
      }
    ]
  },
  {
    slug: 'the-ultimate-guide-to-cinque-terre-wines',
    title: "The Ultimate Guide to Cinque Terre Wines",
    subtitle: "From crisp whites to rare Sciacchetrà, discover the ancient winemaking traditions of the Ligurian coast.",
    author: "Marco Bianchi",
    authorBio: "A sommelier and wine writer who has spent years documenting the heroic viticulture of Cinque Terre's terraced vineyards.",
    category: "Food & Drink",
    readTime: "8 min read",
    image: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=2632&auto=format&fit=crop",
    tags: ["Wine", "Food & Drink", "Sciacchetrà", "Local Culture"],
    intro: "The wines of Cinque Terre are produced through 'heroic viticulture'—grapes grown on impossibly steep terraces, harvested by hand, carried by monorail or on farmers' backs. This isn't industrial wine; it's liquid history.",
    sections: [
      {
        title: "Cinque Terre DOC White",
        text: "The classic white wine of the region, made primarily from Bosco, Albarola, and Vermentino grapes. Expect crisp acidity, mineral notes from the sea-salt air, and flavors of citrus and white flowers. Perfect with the local seafood. Best producers: Cantina Cinque Terre, Buranco, Possa."
      },
      {
        title: "Sciacchetrà: The Rare Dessert Wine",
        text: "This golden nectar is made from the same grapes, but they're dried on racks for months before pressing. The result is intensely sweet, with notes of honey, apricot, and Mediterranean herbs. Only 3,000 bottles are produced annually. Expect to pay €30-50 for a small bottle—and it's worth every euro."
      },
      {
        title: "Where to Taste",
        text: "Enoteca Internazionale in Monterosso offers flights with knowledgeable staff. Cantina de Mananan in Corniglia has a terrace with views over the vineyards. Nessun Dorma in Manarola pairs wines with their famous bruschetta. For vineyard visits, contact Cantina Cinque Terre to arrange a tour."
      },
      {
        title: "Pairing Local Wine with Local Food",
        text: "Cinque Terre white pairs beautifully with acciughe (local anchovies), trofie al pesto, and any fresh seafood. Sciacchetrà shines with aged cheeses, cantucci biscuits, or simply sipped alone after dinner. The local restaurants know these pairings—ask for recommendations."
      }
    ],
    quote: {
      text: "Every sip of Cinque Terre wine carries the taste of the terraces—the stone walls built by hand, the salt wind, the stubborn vines that cling to the cliff. This is wine with a story.",
      author: "Marco Bianchi"
    }
  },
  {
    slug: 'hidden-gems-corniglias-quiet-streets',
    title: "Hidden Gems: Corniglia's Quiet Streets",
    subtitle: "Why the least-visited village might be the most rewarding, and what secrets await those who climb.",
    author: "Sofia Neri",
    authorBio: "A travel writer who spent a month living in Corniglia, discovering the rhythms and secrets of the quietest Cinque Terre village.",
    category: "Villages",
    readTime: "5 min read",
    image: "https://images.unsplash.com/photo-1498503182468-3b51cbb6cb24?q=80&w=2670&auto=format&fit=crop",
    tags: ["Corniglia", "Villages", "Hidden Gems", "Off the Beaten Path"],
    intro: "Most tourists see Corniglia only from the train window—that cluster of houses perched impossibly high above the sea. Those who climb the 382 steps discover something the other villages have lost: authentic, unhurried Ligurian village life.",
    sections: [
      {
        title: "The Lardarina Climb",
        text: "The famous staircase of 382 steps (or take the shuttle bus) is your initiation into Corniglia. It's steep and can be hot, but it serves a purpose: it keeps the crowds away. By the time you reach the top, you've earned your arrival. The views from the top are spectacular."
      },
      {
        title: "The Main Street Secret",
        text: "Via Fieschi, the main pedestrian street, is where locals actually live. Unlike the tourist-focused main drags of other villages, here you'll find residents chatting on benches, laundry hanging between buildings, and shops that cater to locals first. The pace is noticeably slower."
      },
      {
        title: "Best Hidden Spots",
        text: "The terrace behind the Church of San Pietro offers the best views and is usually empty. Alberto Gelateria makes gelato with honey from local bees. The small wine bar at the end of Via Fieschi serves glasses of local wine for half what you'd pay in Vernazza. The path toward Guvano beach starts here—an adventure for another day."
      },
      {
        title: "Why Stay Overnight",
        text: "Corniglia transforms after the day-trippers leave. Evening meals are intimate, stars are visible (less light pollution), and sunrise over the sea is yours alone. Accommodation is limited but excellent—book the few rooms well in advance and enjoy having the village to yourself."
      }
    ]
  },
  {
    slug: 'packing-list-what-to-bring-for-a-fall-trip',
    title: "Packing List: What to Bring for a Fall Trip",
    subtitle: "Essential items for visiting Cinque Terre in September, October, and November.",
    author: "Giulia Rossi",
    authorBio: "A local guide who has helped hundreds of travelers prepare for every season in Cinque Terre.",
    category: "Tips",
    readTime: "6 min read",
    image: "https://images.unsplash.com/photo-1515444744559-7be63e1600de?q=80&w=2670&auto=format&fit=crop",
    tags: ["Packing", "Fall", "Tips", "What to Bring"],
    intro: "Fall in Cinque Terre is magical—grape harvests, dramatic skies, and fewer crowds. But the weather is unpredictable, ranging from beach-worthy sunshine to Mediterranean storms. Pack smart and you'll be ready for anything.",
    sections: [
      {
        title: "Footwear: The Most Important Decision",
        text: "Bring sturdy, broken-in hiking shoes or boots for the trails. Lightweight sneakers work for village exploration. Leave heels and dress shoes at home—the cobblestones are unforgiving. If swimming is on your list, water shoes protect feet from rocky entries."
      },
      {
        title: "Layers for Changeable Weather",
        text: "Pack a lightweight rain jacket (not an umbrella—useless on windy trails). Bring layers: mornings can be cool, afternoons warm, evenings chilly. A light fleece or sweater, a few t-shirts, and one warmer layer for evenings. Quick-dry fabrics are your friend."
      },
      {
        title: "Beach & Swimming Gear",
        text: "September water temperatures are perfect for swimming. Pack a swimsuit even in October—warm days happen. A small travel towel saves space. Reef-safe sunscreen protects both you and the marine environment."
      },
      {
        title: "Don't Forget",
        text: "Day pack for hikes (one that's comfortable for 3+ hours). Reusable water bottle (refill stations exist). Small first aid kit with blister treatment. Portable phone charger. Cash—smaller shops don't take cards. Offline maps downloaded (service is spotty on trails)."
      }
    ]
  },
  {
    slug: 'day-trip-to-portovenere',
    title: "Day Trip to Portovenere",
    subtitle: "Why the 'sixth village' deserves a full day, and how to get there by ferry or bus.",
    author: "Giulia Rossi",
    authorBio: "A local guide who considers Portovenere an essential part of any Cinque Terre itinerary.",
    category: "Guides",
    readTime: "7 min read",
    image: "https://images.unsplash.com/photo-1555979863-69fb96e63359?q=80&w=2670&auto=format&fit=crop",
    tags: ["Portovenere", "Day Trip", "Guides", "Beyond Cinque Terre"],
    intro: "Technically not part of Cinque Terre, Portovenere sits at the tip of the peninsula that forms the Gulf of La Spezia. Its striped church, medieval fortress, and Byron's Grotto make it an unmissable addition to any Cinque Terre itinerary.",
    sections: [
      {
        title: "Getting There",
        text: "By ferry: Boats run from Monterosso, Vernazza, Manarola, and Riomaggiore (45-90 minutes depending on stops). By bus: Take the train to La Spezia, then bus P or 11 (30 minutes). The ferry is slower but offers spectacular coastal views. Consider ferry one way, bus the other."
      },
      {
        title: "The Church of San Pietro",
        text: "The black-and-white striped church perched on the rocky promontory is Portovenere's icon. Built in 1198, it sits on the site of an ancient temple to Venus. The views from the church terrace are extraordinary—especially at sunset."
      },
      {
        title: "Byron's Grotto",
        text: "The sea cave beneath the church is named for Lord Byron, who allegedly swam across the bay to visit Shelley in Lerici. You can peek into the grotto from above, or arrange a boat tour to enter it. The swimming here is excellent for strong swimmers."
      },
      {
        title: "What Else to Do",
        text: "Climb to Castello Doria for panoramic views. Lunch in the colorful Piazza Spallanzani. Take a boat to Palmaria Island for hiking and swimming. Browse the narrow medieval lanes for local crafts. End with aperitivo watching the sunset paint the church golden."
      }
    ],
    quote: {
      text: "Portovenere has the beauty of Cinque Terre with a fraction of the crowds. It's not an alternative—it's a necessary addition to the experience.",
      author: "Giulia Rossi"
    }
  },
  {
    slug: 'local-festivals-in-november',
    title: "Local Festivals in November",
    subtitle: "Discover the cultural celebrations that make visiting in the off-season special.",
    author: "Marco Bianchi",
    authorBio: "A cultural journalist who documents the traditional festivals and celebrations of the Ligurian coast.",
    category: "News",
    readTime: "4 min read",
    image: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=2632&auto=format&fit=crop",
    tags: ["Festivals", "November", "Local Culture", "Events"],
    intro: "November in Cinque Terre brings a quieter energy—but it's far from boring. Traditional festivals, food celebrations, and cultural events give visitors a glimpse into authentic village life that summer tourists never see.",
    sections: [
      {
        title: "All Saints' Day (November 1)",
        text: "A national holiday when Italians visit cemeteries to honor the dead. In Cinque Terre, this is a poignant day—many families have generations buried in the tiny village cemeteries overlooking the sea. Visitors are welcome to observe, respectfully."
      },
      {
        title: "Olive Harvest Season",
        text: "November marks the beginning of the olive harvest. Watch farmers collecting olives on the terraces, and look for fresh-pressed olive oil in local shops. Some agriturismi offer harvest experiences—a hands-on way to connect with the land."
      },
      {
        title: "Feast of San Martino (November 11)",
        text: "This celebration marks the end of the grape harvest and the opening of new wine. In villages across Cinque Terre, locals gather to taste the season's first wines, often paired with roasted chestnuts. Ask at local wine bars about events."
      },
      {
        title: "What to Expect",
        text: "Some restaurants and shops close for the season, but those that stay open welcome visitors warmly. The weather can be dramatic—storms create spectacular waves and moody skies. Bring layers, embrace the quiet, and enjoy having the villages to yourself."
      }
    ]
  }
]

async function createBlogPost(post: BlogPost): Promise<void> {
  const blogDir = join(resolvedPath, 'blog')
  const pagesBlogDir = join(resolvedPath, 'pages', 'blog')

  // Ensure directories exist
  if (!existsSync(blogDir)) {
    await mkdir(blogDir, { recursive: true })
  }
  if (!existsSync(pagesBlogDir)) {
    await mkdir(pagesBlogDir, { recursive: true })
  }

  const content = {
    id: post.slug,
    slug: {
      en: `/en/blog/${post.slug}`,
      de: `/de/blog/${post.slug}`,
      fr: `/fr/blog/${post.slug}`,
      it: `/it/blog/${post.slug}`
    },
    title: {
      en: `${post.title} | The Dispatch`
    },
    page_type: "blog-article",
    seo: {
      title: {
        en: `${post.title} | The Dispatch`
      },
      description: {
        en: post.subtitle
      }
    },
    template: "cinque-terre-blog-article",
    body: [
      {
        type: "blog-article",
        post: {
          title: post.title,
          subtitle: post.subtitle,
          author: post.author,
          authorBio: post.authorBio,
          date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }),
          readTime: post.readTime,
          category: post.category,
          image: post.image,
          tags: post.tags
        },
        content: {
          intro: post.intro,
          sections: post.sections,
          ...(post.quote ? { quote: post.quote } : {})
        }
      }
    ],
    metadata: {
      page_type: "blog-article"
    },
    status: "published",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }

  const blogPath = join(blogDir, `${post.slug}.json`)
  const pagesBlogPath = join(pagesBlogDir, `${post.slug}.json`)

  await writeFile(blogPath, JSON.stringify(content, null, 2))
  await writeFile(pagesBlogPath, JSON.stringify(content, null, 2))

  console.log(`  ✅ Created: ${post.slug}`)
}

async function main(): Promise<void> {
  console.log('\n📝 Creating Missing Blog Posts')
  console.log('================================\n')
  console.log(`📁 Content path: ${resolvedPath}\n`)

  // Check which posts already exist
  const existing = new Set<string>()
  const blogDir = join(resolvedPath, 'blog')
  if (existsSync(blogDir)) {
    const { readdir } = await import('fs/promises')
    const files = await readdir(blogDir)
    files.forEach(f => {
      if (f.endsWith('.json')) {
        existing.add(f.replace('.json', ''))
      }
    })
  }

  console.log(`📊 Found ${existing.size} existing blog posts`)
  console.log(`📋 Will create ${blogPosts.length} blog posts\n`)

  let created = 0
  let skipped = 0

  for (const post of blogPosts) {
    if (existing.has(post.slug)) {
      console.log(`  ⏭️  Skipped (exists): ${post.slug}`)
      skipped++
    } else {
      await createBlogPost(post)
      created++
    }
  }

  console.log('\n================================')
  console.log(`✅ Created: ${created}`)
  console.log(`⏭️  Skipped: ${skipped}`)
  console.log(`📊 Total blog posts: ${existing.size + created}`)
}

main().catch(console.error)
