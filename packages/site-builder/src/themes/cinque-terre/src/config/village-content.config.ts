/**
 * Village Content Configuration
 *
 * Comprehensive content data for each of the five Cinque Terre villages.
 * Components use this data to render village-specific content based on the
 * village prop passed from the URL.
 */

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

export const VILLAGE_CONTENT: Record<VillageSlug, VillageContentData> = {
  riomaggiore: {
    slug: 'riomaggiore',
    seo: {
      title: {
        en: 'Riomaggiore | Cinque Terre Dispatch',
        de: 'Riomaggiore | Cinque Terre Dispatch',
        fr: 'Riomaggiore | Cinque Terre Dispatch',
        it: 'Riomaggiore | Cinque Terre Dispatch',
      },
      description: {
        en: 'Discover Riomaggiore, the easternmost village of Cinque Terre. Colorful cliffside houses, stunning harbor views, and authentic Italian charm.',
        de: 'Entdecken Sie Riomaggiore, das östlichste Dorf der Cinque Terre. Bunte Klippenhäuser, atemberaubende Hafenblicke und authentischer italienischer Charme.',
        fr: 'Découvrez Riomaggiore, le village le plus oriental des Cinque Terre. Maisons colorées sur les falaises, vues imprenables sur le port et charme italien authentique.',
        it: 'Scopri Riomaggiore, il villaggio più orientale delle Cinque Terre. Case colorate sulla scogliera, viste mozzafiato sul porto e autentico fascino italiano.',
      },
    },
    hero: {
      image: 'https://images.unsplash.com/photo-1534445867742-43195f401b6c?q=80&w=2670&auto=format&fit=crop',
      imageAlt: {
        en: 'Riomaggiore colorful houses on the cliff',
        de: 'Riomaggiore bunte Häuser an der Klippe',
        fr: 'Maisons colorées de Riomaggiore sur la falaise',
        it: 'Case colorate di Riomaggiore sulla scogliera',
      },
      tagline: {
        en: 'Cinque Terre',
        de: 'Cinque Terre',
        fr: 'Cinque Terre',
        it: 'Cinque Terre',
      },
      title: {
        en: 'Riomaggiore',
        de: 'Riomaggiore',
        fr: 'Riomaggiore',
        it: 'Riomaggiore',
      },
      subtitle: {
        en: 'The easternmost jewel of Cinque Terre, where pastel houses tumble down steep cliffs to meet the turquoise sea.',
        de: 'Das östlichste Juwel der Cinque Terre, wo pastellfarbene Häuser steile Klippen hinab zum türkisfarbenen Meer stürzen.',
        fr: 'Le joyau le plus oriental des Cinque Terre, où les maisons pastel dégringolent les falaises abruptes pour rejoindre la mer turquoise.',
        it: 'Il gioiello più orientale delle Cinque Terre, dove le case color pastello scendono ripide scogliere per incontrare il mare turchese.',
      },
      primaryCta: {
        label: {
          en: 'Explore Riomaggiore',
          de: 'Riomaggiore erkunden',
          fr: 'Explorer Riomaggiore',
          it: 'Esplora Riomaggiore',
        },
        href: '#villages',
      },
      secondaryCta: {
        label: {
          en: 'Plan Your Visit',
          de: 'Ihren Besuch planen',
          fr: 'Planifier votre visite',
          it: 'Pianifica la tua visita',
        },
        href: '#plan',
      },
    },
    intro: {
      leadStory: {
        title: {
          en: 'Riomaggiore, Where the Sea Meets the Soul',
          de: 'Riomaggiore, Wo das Meer die Seele trifft',
          fr: 'Riomaggiore, Où la mer rencontre l\'âme',
          it: 'Riomaggiore, Dove il mare incontra l\'anima',
        },
        excerpt: {
          en: 'Riomaggiore welcomes you like an old friend, instantly familiar and endlessly charming. Colorful, sun-washed streets cling to the cliffs, guiding you down toward the water. Below, the endless blue of the Ligurian Sea unfolds, setting the rhythm for life in this timeless coastal village.',
          de: 'Riomaggiore begrüßt Sie wie einen alten Freund, sofort vertraut und endlos charmant. Bunte, sonnendurchflutete Straßen klammern sich an die Klippen und führen Sie hinunter zum Wasser.',
          fr: 'Riomaggiore vous accueille comme un vieil ami, instantanément familier et infiniment charmant. Des rues colorées baignées de soleil s\'accrochent aux falaises, vous guidant vers l\'eau.',
          it: 'Riomaggiore ti accoglie come un vecchio amico, immediatamente familiare e infinitamente affascinante. Strade colorate e soleggiate si aggrappano alle scogliere, guidandoti verso l\'acqua.',
        },
        author: 'Giulia Rossi',
        date: 'Oct 15, 2023',
        readTime: '8 min read',
        category: 'Guides',
        image: 'https://images.unsplash.com/photo-1534445867742-43195f401b6c?q=80&w=2670&auto=format&fit=crop',
      },
      essentials: {
        title: {
          en: 'Riomaggiore Essentials 2026',
          de: 'Riomaggiore Essentials 2026',
          fr: 'Essentiels Riomaggiore 2026',
          it: 'Essenziali Riomaggiore 2026',
        },
        subtitle: {
          en: 'Today\'s atmosphere and real-time details, grounded in Riomaggiore\'s timeless character',
          de: 'Heutige Atmosphäre und Echtzeit-Details, verwurzelt in Riomaggiores zeitlosem Charakter',
          fr: 'Ambiance du jour et détails en temps réel, ancrés dans le caractère intemporel de Riomaggiore',
          it: 'Atmosfera di oggi e dettagli in tempo reale, radicati nel carattere senza tempo di Riomaggiore',
        },
        today: {
          weather: '☀️ 23°C, light breeze',
          seaTemp: '🌊 21°C',
          seaConditions: 'Calm to moderate',
          sunset: '20:47',
        },
        experience: {
          crowdRhythm: 'Lively day, quiet eve',
          bestFelt: 'Slowly, on foot',
          villageShape: 'Rising to the sky',
          foodWine: 'Simple, honest flavors',
        },
        character: {
          origins: 'Born in 8th Century',
          shapedBy: 'Sea, stone, patience',
          rating: '4.6/5',
          rememberedFor: '"Views that linger"',
        },
      },
    },
  },
  manarola: {
    slug: 'manarola',
    seo: {
      title: {
        en: 'Manarola | Cinque Terre Dispatch',
        de: 'Manarola | Cinque Terre Dispatch',
        fr: 'Manarola | Cinque Terre Dispatch',
        it: 'Manarola | Cinque Terre Dispatch',
      },
      description: {
        en: 'Explore Manarola, the most photogenic village of Cinque Terre. Famous for its vibrant harbor, wine terraces, and the beloved Via dell\'Amore.',
        de: 'Entdecken Sie Manarola, das fotogenste Dorf der Cinque Terre. Berühmt für seinen lebhaften Hafen, Weinterrassen und die beliebte Via dell\'Amore.',
        fr: 'Explorez Manarola, le village le plus photogénique des Cinque Terre. Célèbre pour son port vibrant, ses terrasses viticoles et la Via dell\'Amore.',
        it: 'Esplora Manarola, il villaggio più fotogenico delle Cinque Terre. Famoso per il suo vivace porto, le terrazze vinicole e l\'amata Via dell\'Amore.',
      },
    },
    hero: {
      image: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop',
      imageAlt: {
        en: 'Manarola at sunset with colorful buildings',
        de: 'Manarola bei Sonnenuntergang mit bunten Gebäuden',
        fr: 'Manarola au coucher du soleil avec des bâtiments colorés',
        it: 'Manarola al tramonto con edifici colorati',
      },
      tagline: {
        en: 'Cinque Terre',
        de: 'Cinque Terre',
        fr: 'Cinque Terre',
        it: 'Cinque Terre',
      },
      title: {
        en: 'Manarola',
        de: 'Manarola',
        fr: 'Manarola',
        it: 'Manarola',
      },
      subtitle: {
        en: 'The most photographed village in Cinque Terre, where ancient vineyards cascade down to a tiny harbor filled with colorful boats.',
        de: 'Das meistfotografierte Dorf der Cinque Terre, wo uralte Weinberge zu einem kleinen Hafen voller bunter Boote hinabkaskadieren.',
        fr: 'Le village le plus photographié des Cinque Terre, où d\'anciens vignobles descendent en cascade vers un petit port rempli de bateaux colorés.',
        it: 'Il villaggio più fotografato delle Cinque Terre, dove antichi vigneti scendono a cascata verso un piccolo porto pieno di barche colorate.',
      },
      primaryCta: {
        label: {
          en: 'Explore Manarola',
          de: 'Manarola erkunden',
          fr: 'Explorer Manarola',
          it: 'Esplora Manarola',
        },
        href: '#villages',
      },
      secondaryCta: {
        label: {
          en: 'Plan Your Visit',
          de: 'Ihren Besuch planen',
          fr: 'Planifier votre visite',
          it: 'Pianifica la tua visita',
        },
        href: '#plan',
      },
    },
    intro: {
      leadStory: {
        title: {
          en: 'Manarola, The Wine-Maker\'s Paradise',
          de: 'Manarola, Das Paradies der Winzer',
          fr: 'Manarola, Le Paradis des Vignerons',
          it: 'Manarola, Il Paradiso dei Viticoltori',
        },
        excerpt: {
          en: 'Manarola enchants with its dramatic cliffs and ancient wine terraces. The village\'s famous Sciacchetrà wine has been produced here for centuries, while the harbor creates one of Italy\'s most iconic vistas at sunset.',
          de: 'Manarola verzaubert mit seinen dramatischen Klippen und alten Weinterrassen. Der berühmte Sciacchetrà-Wein des Dorfes wird hier seit Jahrhunderten produziert.',
          fr: 'Manarola enchante avec ses falaises dramatiques et ses anciennes terrasses viticoles. Le célèbre vin Sciacchetrà du village est produit ici depuis des siècles.',
          it: 'Manarola incanta con le sue scogliere drammatiche e le antiche terrazze viticole. Il famoso vino Sciacchetrà del villaggio viene prodotto qui da secoli.',
        },
        author: 'Marco Bianchi',
        date: 'Oct 18, 2023',
        readTime: '7 min read',
        category: 'Wine & Culture',
        image: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop',
      },
      essentials: {
        title: {
          en: 'Manarola Essentials 2026',
          de: 'Manarola Essentials 2026',
          fr: 'Essentiels Manarola 2026',
          it: 'Essenziali Manarola 2026',
        },
        subtitle: {
          en: 'Today\'s atmosphere and real-time details, grounded in Manarola\'s winemaking heritage',
          de: 'Heutige Atmosphäre und Echtzeit-Details, verwurzelt in Manarolas Weinbau-Erbe',
          fr: 'Ambiance du jour et détails en temps réel, ancrés dans le patrimoine viticole de Manarola',
          it: 'Atmosfera di oggi e dettagli in tempo reale, radicati nel patrimonio viticolo di Manarola',
        },
        today: {
          weather: '⛅ 22°C, partly cloudy',
          seaTemp: '🌊 20°C',
          seaConditions: 'Gentle waves',
          sunset: '20:45',
        },
        experience: {
          crowdRhythm: 'Sunset rush, morning calm',
          bestFelt: 'With a glass of Sciacchetrà',
          villageShape: 'Terraced and tumbling',
          foodWine: 'Wine-forward, seafood rich',
        },
        character: {
          origins: 'Roman-era foundations',
          shapedBy: 'Wine, waves, wanderers',
          rating: '4.8/5',
          rememberedFor: '"The perfect sunset"',
        },
      },
    },
  },
  corniglia: {
    slug: 'corniglia',
    seo: {
      title: {
        en: 'Corniglia | Cinque Terre Dispatch',
        de: 'Corniglia | Cinque Terre Dispatch',
        fr: 'Corniglia | Cinque Terre Dispatch',
        it: 'Corniglia | Cinque Terre Dispatch',
      },
      description: {
        en: 'Discover Corniglia, the only Cinque Terre village perched high on a promontory. 382 steps lead to authentic village life and panoramic views.',
        de: 'Entdecken Sie Corniglia, das einzige Cinque Terre-Dorf hoch auf einem Vorgebirge. 382 Stufen führen zum authentischen Dorfleben und Panoramablicken.',
        fr: 'Découvrez Corniglia, le seul village des Cinque Terre perché sur un promontoire. 382 marches mènent à la vie de village authentique et aux vues panoramiques.',
        it: 'Scopri Corniglia, l\'unico villaggio delle Cinque Terre arroccato su un promontorio. 382 gradini portano alla vita autentica del villaggio e alle viste panoramiche.',
      },
    },
    hero: {
      image: 'https://images.unsplash.com/photo-1529260830199-42c24126f198?q=80&w=2676&auto=format&fit=crop',
      imageAlt: {
        en: 'Corniglia perched high on the cliffs',
        de: 'Corniglia hoch auf den Klippen thronend',
        fr: 'Corniglia perchée sur les falaises',
        it: 'Corniglia arroccata sulle scogliere',
      },
      tagline: {
        en: 'Cinque Terre',
        de: 'Cinque Terre',
        fr: 'Cinque Terre',
        it: 'Cinque Terre',
      },
      title: {
        en: 'Corniglia',
        de: 'Corniglia',
        fr: 'Corniglia',
        it: 'Corniglia',
      },
      subtitle: {
        en: 'The quiet heart of Cinque Terre, perched 100 meters above the sea. Climb 382 steps to find vineyards, olive groves, and the most authentic village life.',
        de: 'Das ruhige Herz der Cinque Terre, 100 Meter über dem Meer thronend. Erklimmen Sie 382 Stufen zu Weinbergen, Olivenhainen und dem authentischsten Dorfleben.',
        fr: 'Le cœur tranquille des Cinque Terre, perché à 100 mètres au-dessus de la mer. Grimpez 382 marches pour trouver vignobles, oliveraies et la vie de village la plus authentique.',
        it: 'Il cuore tranquillo delle Cinque Terre, arroccato 100 metri sopra il mare. Salite 382 gradini per trovare vigneti, uliveti e la vita di villaggio più autentica.',
      },
      primaryCta: {
        label: {
          en: 'Explore Corniglia',
          de: 'Corniglia erkunden',
          fr: 'Explorer Corniglia',
          it: 'Esplora Corniglia',
        },
        href: '#villages',
      },
      secondaryCta: {
        label: {
          en: 'Plan Your Visit',
          de: 'Ihren Besuch planen',
          fr: 'Planifier votre visite',
          it: 'Pianifica la tua visita',
        },
        href: '#plan',
      },
    },
    intro: {
      leadStory: {
        title: {
          en: 'Corniglia, The Village Above the Clouds',
          de: 'Corniglia, Das Dorf über den Wolken',
          fr: 'Corniglia, Le Village au-dessus des Nuages',
          it: 'Corniglia, Il Villaggio sopra le Nuvole',
        },
        excerpt: {
          en: 'Corniglia rewards those who make the climb. Perched high on a rocky promontory, this is the only Cinque Terre village without direct sea access, yet its panoramic views and peaceful streets make every step worthwhile.',
          de: 'Corniglia belohnt diejenigen, die den Aufstieg wagen. Hoch auf einem Felsvorsprung thronend, ist dies das einzige Cinque Terre-Dorf ohne direkten Meerzugang.',
          fr: 'Corniglia récompense ceux qui font l\'ascension. Perché sur un promontoire rocheux, c\'est le seul village des Cinque Terre sans accès direct à la mer.',
          it: 'Corniglia premia coloro che affrontano la salita. Arroccato su un promontorio roccioso, è l\'unico villaggio delle Cinque Terre senza accesso diretto al mare.',
        },
        author: 'Elena Moretti',
        date: 'Oct 20, 2023',
        readTime: '6 min read',
        category: 'Hidden Gems',
        image: 'https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?q=80&w=2670&auto=format&fit=crop',
      },
      essentials: {
        title: {
          en: 'Corniglia Essentials 2026',
          de: 'Corniglia Essentials 2026',
          fr: 'Essentiels Corniglia 2026',
          it: 'Essenziali Corniglia 2026',
        },
        subtitle: {
          en: 'Today\'s atmosphere and real-time details, grounded in Corniglia\'s hilltop serenity',
          de: 'Heutige Atmosphäre und Echtzeit-Details, verwurzelt in Corniglias Hügelruhe',
          fr: 'Ambiance du jour et détails en temps réel, ancrés dans la sérénité de Corniglia',
          it: 'Atmosfera di oggi e dettagli in tempo reale, radicati nella serenità collinare di Corniglia',
        },
        today: {
          weather: '🌤️ 21°C, cool breeze',
          seaTemp: '🌊 20°C',
          seaConditions: 'View from above',
          sunset: '20:46',
        },
        experience: {
          crowdRhythm: 'Peaceful all day',
          bestFelt: 'Walking slowly, looking up',
          villageShape: 'Compact and cozy',
          foodWine: 'Honey, focaccia, local wine',
        },
        character: {
          origins: 'Named for Roman family',
          shapedBy: 'Steps, vines, solitude',
          rating: '4.5/5',
          rememberedFor: '"The quiet one"',
        },
      },
    },
  },
  vernazza: {
    slug: 'vernazza',
    seo: {
      title: {
        en: 'Vernazza | Cinque Terre Dispatch',
        de: 'Vernazza | Cinque Terre Dispatch',
        fr: 'Vernazza | Cinque Terre Dispatch',
        it: 'Vernazza | Cinque Terre Dispatch',
      },
      description: {
        en: 'Experience Vernazza, often called the crown jewel of Cinque Terre. Medieval towers, a natural harbor, and the iconic waterfront piazza await.',
        de: 'Erleben Sie Vernazza, oft als Kronjuwel der Cinque Terre bezeichnet. Mittelalterliche Türme, ein Naturhafen und die ikonische Piazza am Wasser erwarten Sie.',
        fr: 'Découvrez Vernazza, souvent appelée le joyau des Cinque Terre. Tours médiévales, port naturel et l\'emblématique piazza en bord de mer vous attendent.',
        it: 'Vivi Vernazza, spesso chiamata il gioiello della corona delle Cinque Terre. Torri medievali, un porto naturale e l\'iconica piazza sul lungomare ti aspettano.',
      },
    },
    hero: {
      image: 'https://images.unsplash.com/photo-1499678329028-101435549a4e?q=80&w=2670&auto=format&fit=crop',
      imageAlt: {
        en: 'Vernazza harbor with colorful buildings',
        de: 'Vernazza Hafen mit bunten Gebäuden',
        fr: 'Port de Vernazza avec des bâtiments colorés',
        it: 'Porto di Vernazza con edifici colorati',
      },
      tagline: {
        en: 'Cinque Terre',
        de: 'Cinque Terre',
        fr: 'Cinque Terre',
        it: 'Cinque Terre',
      },
      title: {
        en: 'Vernazza',
        de: 'Vernazza',
        fr: 'Vernazza',
        it: 'Vernazza',
      },
      subtitle: {
        en: 'The crown jewel of Cinque Terre, where medieval towers guard a perfect natural harbor. The waterfront piazza is Italy\'s most romantic gathering place.',
        de: 'Das Kronjuwel der Cinque Terre, wo mittelalterliche Türme einen perfekten Naturhafen bewachen. Die Piazza am Wasser ist Italiens romantischster Treffpunkt.',
        fr: 'Le joyau des Cinque Terre, où des tours médiévales gardent un port naturel parfait. La piazza en bord de mer est le lieu de rassemblement le plus romantique d\'Italie.',
        it: 'Il gioiello della corona delle Cinque Terre, dove torri medievali custodiscono un perfetto porto naturale. La piazza sul lungomare è il luogo di ritrovo più romantico d\'Italia.',
      },
      primaryCta: {
        label: {
          en: 'Explore Vernazza',
          de: 'Vernazza erkunden',
          fr: 'Explorer Vernazza',
          it: 'Esplora Vernazza',
        },
        href: '#villages',
      },
      secondaryCta: {
        label: {
          en: 'Plan Your Visit',
          de: 'Ihren Besuch planen',
          fr: 'Planifier votre visite',
          it: 'Pianifica la tua visita',
        },
        href: '#plan',
      },
    },
    intro: {
      leadStory: {
        title: {
          en: 'Vernazza, Where History Meets the Sea',
          de: 'Vernazza, Wo Geschichte auf das Meer trifft',
          fr: 'Vernazza, Où l\'Histoire Rencontre la Mer',
          it: 'Vernazza, Dove la Storia Incontra il Mare',
        },
        excerpt: {
          en: 'Vernazza captivates with its medieval charm and natural harbor. Once a maritime power, its Doria Castle still watches over the village, while the piazza fills each evening with locals and travelers sharing wine and stories.',
          de: 'Vernazza fasziniert mit seinem mittelalterlichen Charme und Naturhafen. Einst eine Seemacht, wacht sein Doria-Schloss noch immer über das Dorf.',
          fr: 'Vernazza captive par son charme médiéval et son port naturel. Ancienne puissance maritime, son château Doria veille toujours sur le village.',
          it: 'Vernazza affascina con il suo fascino medievale e il porto naturale. Un tempo potenza marittima, il suo Castello Doria veglia ancora sul villaggio.',
        },
        author: 'Luca Verdi',
        date: 'Oct 22, 2023',
        readTime: '9 min read',
        category: 'History & Culture',
        image: 'https://images.unsplash.com/photo-1592345279419-959d784e8aad?q=80&w=2670&auto=format&fit=crop',
      },
      essentials: {
        title: {
          en: 'Vernazza Essentials 2026',
          de: 'Vernazza Essentials 2026',
          fr: 'Essentiels Vernazza 2026',
          it: 'Essenziali Vernazza 2026',
        },
        subtitle: {
          en: 'Today\'s atmosphere and real-time details, grounded in Vernazza\'s maritime legacy',
          de: 'Heutige Atmosphäre und Echtzeit-Details, verwurzelt in Vernazzas maritimem Erbe',
          fr: 'Ambiance du jour et détails en temps réel, ancrés dans l\'héritage maritime de Vernazza',
          it: 'Atmosfera di oggi e dettagli in tempo reale, radicati nell\'eredità marittima di Vernazza',
        },
        today: {
          weather: '☀️ 24°C, sunny',
          seaTemp: '🌊 22°C',
          seaConditions: 'Perfect for swimming',
          sunset: '20:48',
        },
        experience: {
          crowdRhythm: 'Busy but magical',
          bestFelt: 'Evening on the piazza',
          villageShape: 'Embracing the harbor',
          foodWine: 'Anchovies, pesto, prosecco',
        },
        character: {
          origins: '11th Century maritime',
          shapedBy: 'Trade, towers, tradition',
          rating: '4.9/5',
          rememberedFor: '"The perfect village"',
        },
      },
    },
  },
  monterosso: {
    slug: 'monterosso',
    seo: {
      title: {
        en: 'Monterosso al Mare | Cinque Terre Dispatch',
        de: 'Monterosso al Mare | Cinque Terre Dispatch',
        fr: 'Monterosso al Mare | Cinque Terre Dispatch',
        it: 'Monterosso al Mare | Cinque Terre Dispatch',
      },
      description: {
        en: 'Discover Monterosso al Mare, the largest Cinque Terre village. Beautiful sandy beaches, excellent restaurants, and the famous lemon groves await.',
        de: 'Entdecken Sie Monterosso al Mare, das größte Cinque Terre-Dorf. Schöne Sandstrände, ausgezeichnete Restaurants und die berühmten Zitronenhaine erwarten Sie.',
        fr: 'Découvrez Monterosso al Mare, le plus grand village des Cinque Terre. Belles plages de sable, excellents restaurants et les célèbres citronniers vous attendent.',
        it: 'Scopri Monterosso al Mare, il villaggio più grande delle Cinque Terre. Belle spiagge sabbiose, ottimi ristoranti e i famosi limoneti ti aspettano.',
      },
    },
    hero: {
      image: 'https://images.unsplash.com/photo-1555979863-69fb96e63359?q=80&w=2670&auto=format&fit=crop',
      imageAlt: {
        en: 'Monterosso beach and old town',
        de: 'Monterosso Strand und Altstadt',
        fr: 'Plage de Monterosso et vieille ville',
        it: 'Spiaggia di Monterosso e centro storico',
      },
      tagline: {
        en: 'Cinque Terre',
        de: 'Cinque Terre',
        fr: 'Cinque Terre',
        it: 'Cinque Terre',
      },
      title: {
        en: 'Monterosso',
        de: 'Monterosso',
        fr: 'Monterosso',
        it: 'Monterosso',
      },
      subtitle: {
        en: 'The largest of the five villages, blessed with sandy beaches, fragrant lemon groves, and the finest restaurants on the Ligurian coast.',
        de: 'Das größte der fünf Dörfer, gesegnet mit Sandstränden, duftenden Zitronenhainen und den besten Restaurants an der ligurischen Küste.',
        fr: 'Le plus grand des cinq villages, béni avec des plages de sable, des citronniers parfumés et les meilleurs restaurants de la côte ligure.',
        it: 'Il più grande dei cinque villaggi, benedetto da spiagge sabbiose, profumati limoneti e i migliori ristoranti della costa ligure.',
      },
      primaryCta: {
        label: {
          en: 'Explore Monterosso',
          de: 'Monterosso erkunden',
          fr: 'Explorer Monterosso',
          it: 'Esplora Monterosso',
        },
        href: '#villages',
      },
      secondaryCta: {
        label: {
          en: 'Plan Your Visit',
          de: 'Ihren Besuch planen',
          fr: 'Planifier votre visite',
          it: 'Pianifica la tua visita',
        },
        href: '#plan',
      },
    },
    intro: {
      leadStory: {
        title: {
          en: 'Monterosso, Where Beach Life Begins',
          de: 'Monterosso, Wo das Strandleben beginnt',
          fr: 'Monterosso, Où Commence la Vie de Plage',
          it: 'Monterosso, Dove Inizia la Vita da Spiaggia',
        },
        excerpt: {
          en: 'Monterosso is where Cinque Terre meets the beach. The only village with real sandy shores, it divides between the historic old town and the modern Fegina quarter, both blessed with excellent restaurants and that famous Ligurian light.',
          de: 'Monterosso ist, wo Cinque Terre auf den Strand trifft. Das einzige Dorf mit echten Sandstränden, teilt es sich zwischen der historischen Altstadt und dem modernen Viertel Fegina.',
          fr: 'Monterosso est là où les Cinque Terre rencontrent la plage. Le seul village avec de vraies plages de sable, il se divise entre la vieille ville historique et le quartier moderne de Fegina.',
          it: 'Monterosso è dove le Cinque Terre incontrano la spiaggia. L\'unico villaggio con vere spiagge sabbiose, si divide tra il centro storico e il moderno quartiere di Fegina.',
        },
        author: 'Sofia Neri',
        date: 'Oct 25, 2023',
        readTime: '8 min read',
        category: 'Beaches & Life',
        image: 'https://images.unsplash.com/photo-1555979863-69fb96e63359?q=80&w=2670&auto=format&fit=crop',
      },
      essentials: {
        title: {
          en: 'Monterosso Essentials 2026',
          de: 'Monterosso Essentials 2026',
          fr: 'Essentiels Monterosso 2026',
          it: 'Essenziali Monterosso 2026',
        },
        subtitle: {
          en: 'Today\'s atmosphere and real-time details, grounded in Monterosso\'s beach culture',
          de: 'Heutige Atmosphäre und Echtzeit-Details, verwurzelt in Monterossos Strandkultur',
          fr: 'Ambiance du jour et détails en temps réel, ancrés dans la culture de plage de Monterosso',
          it: 'Atmosfera di oggi e dettagli in tempo reale, radicati nella cultura balneare di Monterosso',
        },
        today: {
          weather: '☀️ 25°C, perfect beach day',
          seaTemp: '🌊 23°C',
          seaConditions: 'Calm, great for swimming',
          sunset: '20:50',
        },
        experience: {
          crowdRhythm: 'Beach by day, dining by night',
          bestFelt: 'Sand between your toes',
          villageShape: 'Split between old and new',
          foodWine: 'Lemons, anchovies, limoncello',
        },
        character: {
          origins: 'Monastery roots, 1000 AD',
          shapedBy: 'Sun, sand, hospitality',
          rating: '4.7/5',
          rememberedFor: '"The beach village"',
        },
      },
    },
  },
};

/**
 * Get village content by slug
 */
export function getVillageContent(slug: string): VillageContentData | undefined {
  return VILLAGE_CONTENT[slug as VillageSlug];
}

/**
 * Get all village content
 */
export function getAllVillageContent(): VillageContentData[] {
  return Object.values(VILLAGE_CONTENT);
}
