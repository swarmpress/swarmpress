#!/usr/bin/env tsx

import { readFileSync, writeFileSync } from 'fs';
import { glob } from 'glob';

// Standard footer for all pages
const footer = {
  type: "footer-section",
  variant: "4-column-simple",
  companyName: "Cinqueterre.travel",
  companyDescription: "Ihr kompletter Reiseführer zu Italiens schönsten Küstendörfern.",
  copyright: "© 2025 Cinqueterre.travel. Alle Rechte vorbehalten.",
  columns: [
    {
      title: "Dörfer",
      links: [
        { label: "Monterosso", url: "/de/monterosso" },
        { label: "Vernazza", url: "/de/vernazza" },
        { label: "Corniglia", url: "/de/corniglia" },
        { label: "Manarola", url: "/de/manarola" },
        { label: "Riomaggiore", url: "/de/riomaggiore" }
      ]
    },
    {
      title: "Reiseplanung",
      links: [
        { label: "Anreise", url: "/de/cinque-terre/getting-here" },
        { label: "Unterkünfte", url: "/de/cinque-terre/hotels" },
        { label: "Wanderwege", url: "/de/cinque-terre/hiking" },
        { label: "Wetter", url: "/de/cinque-terre/weather" }
      ]
    },
    {
      title: "Erleben",
      links: [
        { label: "Restaurants", url: "/de/cinque-terre/restaurants" },
        { label: "Aktivitäten", url: "/de/cinque-terre/things-to-do" },
        { label: "Strände", url: "/de/cinque-terre/beaches" },
        { label: "Bootstouren", url: "/de/cinque-terre/boat-tours" }
      ]
    },
    {
      title: "Hilfe",
      links: [
        { label: "FAQ", url: "/de/cinque-terre/faq" },
        { label: "Karten", url: "/de/cinque-terre/maps" },
        { label: "Insider-Tipps", url: "/de/cinque-terre/insights" }
      ]
    }
  ],
  socialLinks: [
    { platform: "instagram", url: "https://instagram.com/cinqueterre" },
    { platform: "facebook", url: "https://facebook.com/cinqueterre" }
  ]
};

// Content templates by page type
const pageContent: Record<string, any> = {
  apartments: {
    hero: {
      eyebrow: "Ferienwohnungen",
      title: "Ferienwohnungen in {CITY}",
      subtitle: "Erleben Sie das authentische Leben in {CITY_DAT} in komfortablen Ferienwohnungen. Genießen Sie die Freiheit einer eigenen Küche, lokale Märkte und das Gefühl, wie ein Einheimischer zu leben.",
      buttons: [
        { text: "Wohnungen durchsuchen", url: "#apartments", variant: "primary" },
        { text: "Hotels ansehen", url: "{PREFIX}/hotels", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80"
    },
    features: [
      { icon: "home", title: "Komplette Wohnungen", description: "Voll ausgestattete Apartments mit Küche, Wohnbereich und allem Komfort eines Zuhauses." },
      { icon: "map-pin", title: "Zentrale Lagen", description: "Wohnungen im Herzen des Dorfes, nur wenige Schritte von Hafen, Geschäften und Restaurants entfernt." },
      { icon: "users", title: "Ideal für Familien", description: "Geräumige Optionen mit mehreren Schlafzimmern für Familien und Gruppen." },
      { icon: "eye", title: "Balkone & Terrassen", description: "Viele Apartments mit privaten Außenbereichen und spektakulärem Meerblick." },
      { icon: "clock", title: "Flexible Aufenthalte", description: "Wochenend-Kurztrips bis zu mehrwöchigen Aufenthalten möglich." },
      { icon: "coffee", title: "Lokale Erfahrung", description: "Einkaufen auf Märkten, selbst kochen mit ligurischen Zutaten – leben Sie wie ein Local." }
    ],
    stats: [
      { value: "150+", label: "Ferienwohnungen" },
      { value: "€70-300", label: "Preis/Nacht" },
      { value: "4.6★", label: "Gästebewertung" },
      { value: "75%", label: "Mit Meerblick" }
    ],
    cta: {
      title: "Finden Sie Ihre perfekte Ferienwohnung",
      subtitle: "Buchen Sie Ihre Unterkunft und erleben Sie {CITY_ACC} wie ein Einheimischer.",
      buttons: [
        { text: "Alle Unterkünfte", url: "{PREFIX}/hotels", variant: "primary" },
        { text: "Anreise planen", url: "/de/cinque-terre/getting-here", variant: "secondary" }
      ]
    }
  },

  "boat-tours": {
    hero: {
      eyebrow: "Bootstouren",
      title: "Bootstouren ab {CITY}",
      subtitle: "Erleben Sie die Cinque Terre vom Wasser aus – die spektakulärste Perspektive auf die bunten Dörfer und dramatischen Klippen. Sunset-Cruises, Schwimmpausen und versteckte Buchten inklusive.",
      buttons: [
        { text: "Touren entdecken", url: "#boat-tours", variant: "primary" },
        { text: "Strände ansehen", url: "{PREFIX}/beaches", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=1200&q=80"
    },
    features: [
      { icon: "anchor", title: "Panorama-Bootstouren", description: "2-3 Stunden Küstenfahrt mit Blick auf alle fünf Dörfer und Fotostopps vor den schönsten Kulissen." },
      { icon: "sun", title: "Sunset Cruises", description: "Romantische Abendfahrten mit Aperitivo, Musik und unvergesslichem Sonnenuntergang über dem Meer." },
      { icon: "waves", title: "Schwimm-Stopps", description: "Baden in kristallklaren Buchten, die nur vom Wasser aus erreichbar sind." },
      { icon: "fish", title: "Schnorchel-Ausflüge", description: "Entdecken Sie die Unterwasserwelt des Marineschutzgebiets mit Ausrüstung inklusive." },
      { icon: "wine-glass", title: "Wein & Aperitivo", description: "Lokale Weine, Prosecco und typische ligurische Snacks an Bord." },
      { icon: "camera", title: "Fotografen-Favorit", description: "Die beste Perspektive für ikonische Cinque Terre Aufnahmen vom Meer aus." }
    ],
    stats: [
      { value: "15+", label: "Tour-Anbieter" },
      { value: "€25-80", label: "Preis/Person" },
      { value: "Apr-Okt", label: "Saison" },
      { value: "2-6h", label: "Tour-Dauer" }
    ],
    cta: {
      title: "Buchen Sie Ihr Boots-Abenteuer",
      subtitle: "Erleben Sie die Cinque Terre vom schönsten Aussichtspunkt – dem Mittelmeer!",
      buttons: [
        { text: "Aktivitäten ansehen", url: "{PREFIX}/things-to-do", variant: "primary" },
        { text: "Wetter prüfen", url: "/de/cinque-terre/weather", variant: "secondary" }
      ]
    }
  },

  "getting-here": {
    hero: {
      eyebrow: "Anreise",
      title: "Anreise nach {CITY}",
      subtitle: "Planen Sie Ihre Anreise zu {CITY_DAT}. Ob mit dem Zug, Auto, Bus oder Flugzeug – wir zeigen Ihnen die besten Routen, Verbindungen und praktische Tipps für eine stressfreie Ankunft.",
      buttons: [
        { text: "Reiseoptionen ansehen", url: "#getting-here", variant: "primary" },
        { text: "Karte öffnen", url: "{PREFIX}/maps", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1474487548417-781cb71495f3?w=1200&q=80"
    },
    features: [
      { icon: "train", title: "Mit dem Zug", description: "Regionalzug ab La Spezia oder Levanto – die einfachste und landschaftlich schönste Anreise. Haltestelle in jedem Dorf." },
      { icon: "car", title: "Mit dem Auto", description: "Zufahrt möglich, aber Parkplätze begrenzt und teuer. Parken in La Spezia empfohlen, dann Zug nutzen." },
      { icon: "plane", title: "Mit dem Flugzeug", description: "Nächste Flughäfen: Genua (90 km), Pisa (80 km). Weiter mit Zug nach La Spezia, dann Regional bahn." },
      { icon: "bus", title: "Mit dem Bus", description: "Busverbindungen von La Spezia und umliegenden Städten. Weniger frequent als Züge." },
      { icon: "ticket", title: "Cinque Terre Card", description: "Unbegrenzte Zugfahrten zwischen den Dörfern, Wanderwege und WLAN inklusive. Online oder am Bahnhof erhältlich." },
      { icon: "info", title: "Wichtige Hinweise", description: "Dörfer autofrei, schmale Gassen, viele Treppen. Leichtes Gepäck empfohlen. Check-in-Zeiten beachten." }
    ],
    stats: [
      { value: "20min", label: "Zugfahrt La Spezia" },
      { value: "€5", label: "Zugticket (einfach)" },
      { value: "2x/Std", label: "Zugfrequenz" },
      { value: "€16-36", label: "Cinque Terre Card" }
    ],
    cta: {
      title: "Bereit für die Reise?",
      subtitle: "Buchen Sie Ihre Unterkunft und planen Sie Ihre perfekte Cinque Terre Anreise.",
      buttons: [
        { text: "Unterkünfte buchen", url: "{PREFIX}/hotels", variant: "primary" },
        { text: "FAQ lesen", url: "/de/cinque-terre/faq", variant: "secondary" }
      ]
    }
  },

  "things-to-do": {
    hero: {
      eyebrow: "Aktivitäten",
      title: "Aktivitäten in {CITY}",
      subtitle: "Von Wandern und Schwimmen über Weinproben bis zu Kochkursen – entdecken Sie die besten Erlebnisse und Aktivitäten in {CITY_DAT} für einen unvergesslichen Aufenthalt.",
      buttons: [
        { text: "Aktivitäten entdecken", url: "#activities", variant: "primary" },
        { text: "Wanderwege ansehen", url: "/de/cinque-terre/hiking", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1527631746610-bca00a040d60?w=1200&q=80"
    },
    features: [
      { icon: "hiking", title: "Küstenwanderungen", description: "Spektakuläre Wanderwege mit Meerblick – vom leichten Spaziergang bis zur anspruchsvollen Bergtour." },
      { icon: "waves", title: "Schwimmen & Schnorcheln", description: "Kristallklares Wasser, versteckte Buchten und Marineschutzgebiet mit reicher Unterwasserwelt." },
      { icon: "wine-glass", title: "Weinproben", description: "Besuchen Sie lokale Weingüter, probieren Sie Sciacchetrà und lernen Sie über terrassenbau auf steilen Hängen." },
      { icon: "camera", title: "Fotografie-Touren", description: "Festhalten Sie die bunten Häuser, dramatischen Klippen und goldene Sonnenuntergänge." },
      { icon: "utensils", title: "Kochkurse", description: "Lernen Sie Pesto, Trofie und ligurische Spezialitäten von lokalen Köchen zuzubereiten." },
      { icon: "kayak", title: "Kajak & SUP", description: "Erkunden Sie die Küste aktiv mit Kajak oder Stand-Up-Paddle – Verleih vor Ort verfügbar." }
    ],
    stats: [
      { value: "50+", "label": "Aktivitäten" },
      { value: "Ganzjährig", label: "Beste Zeit" },
      { value: "€15-100", label: "Preisspanne" },
      { value: "4.8★", label: "Bewertung" }
    ],
    cta: {
      title: "Erleben Sie {CITY_ACC}",
      subtitle: "Buchen Sie Ihre Aktivitäten und machen Sie Ihren Aufenthalt unvergesslich.",
      buttons: [
        { text: "Bootstouren buchen", url: "{PREFIX}/boat-tours", variant: "primary" },
        { text: "Restaurants entdecken", url: "{PREFIX}/restaurants", variant: "secondary" }
      ]
    }
  },

  weather: {
    hero: {
      eyebrow: "Wetter & Klima",
      title: "Wetter in {CITY}",
      subtitle: "Planen Sie Ihren Besuch mit aktuellen Wetterinformationen, Klimadaten und Empfehlungen für die beste Reisezeit. Mildes Mittelmeerklima das ganze Jahr über.",
      buttons: [
        { text: "Beste Reisezeit", url: "#weather", variant: "primary" },
        { text: "Aktivitäten planen", url: "{PREFIX}/things-to-do", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1592210454359-9043f067919b?w=1200&q=80"
    },
    features: [
      { icon: "sun", title: "Frühling (März-Mai)", description: "15-22°C, blühende Landschaft, weniger Touristen. Ideal zum Wandern und Fotografieren." },
      { icon: "sun", title: "Sommer (Juni-August)", description: "25-30°C, perfekt zum Baden, voll aber lebendig. Frühbucher-Vorteil bei Unterkünften." },
      { icon: "cloud-sun", title: "Herbst (September-November)", description: "18-25°C, Weinlese, angenehme Temperaturen, weniger Menschenmassen. Top-Reisezeit!" },
      { icon: "cloud", title: "Winter (Dezember-Februar)", description: "8-15°C, ruhig, authentisch, günstigere Preise. Einige Restaurants geschlossen." },
      { icon: "droplet", title: "Niederschlag", description: "Oktober/November am regenreichsten. Juli/August am trockensten. Regenjacke immer dabei haben." },
      { icon: "waves", title: "Wassertemperatur", description: "16°C (Mai) bis 25°C (August). Badesaison Juni-September mit angenehmsten Bedingungen." }
    ],
    stats: [
      { value: "300+", label: "Sonnentage/Jahr" },
      { value: "22°C", label: "Ø Jahrestemperatur" },
      { value: "Mai & Sep", label: "Beste Reisezeit" },
      { value: "24°C", label: "Wassertemp. (Sommer)" }
    ],
    cta: {
      title: "Planen Sie Ihren perfekten Besuch",
      subtitle: "Finden Sie die ideale Reisezeit für Ihre Aktivitäten und buchen Sie rechtzeitig.",
      buttons: [
        { text: "Unterkünfte buchen", url: "{PREFIX}/hotels", variant: "primary" },
        { text: "Anreise planen", url: "/de/cinque-terre/getting-here", variant: "secondary" }
      ]
    }
  },

  faq: {
    hero: {
      eyebrow: "Häufige Fragen",
      title: "FAQ zu {CITY}",
      subtitle: "Antworten auf die häufigsten Fragen zu Ihrem Besuch in {CITY_DAT}. Von Anreise über Unterkünfte bis zu praktischen Tipps für einen sorgenfreien Aufenthalt.",
      buttons: [
        { text: "FAQ durchsuchen", url: "#faq", variant: "primary" },
        { text: "Insider-Tipps", url: "/de/cinque-terre/insights", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1484480974693-6ca0a78fb36b?w=1200&q=80"
    },
    features: [
      { icon: "help-circle", title: "Wie komme ich hin?", description: "Zug von La Spezia oder Levanto (alle 15-30min). Auto möglich, aber Parkplätze rar und teuer. Flughäfen: Genua, Pisa." },
      { icon: "calendar", title: "Beste Reisezeit?", description: "April-Mai und September-Oktober: weniger Menschenmassen, angenehme Temperaturen. Juni-August: Badesaison, sehr voll." },
      { icon: "clock", title: "Wie lange bleiben?", description: "Minimum 2-3 Tage für alle fünf Dörfer. 5-7 Tage ideal zum Wandern, Baden und Entspannen ohne Stress." },
      { icon: "ticket", title: "Brauche ich eine Cinque Terre Card?", description: "Empfohlen: unbegrenzte Züge, Wanderwege, WLAN. €16 (1 Tag) bis €36 (3 Tage). Am Bahnhof oder online erhältlich." },
      { icon: "utensils", title: "Wo esse ich am besten?", description: "Meiden Sie Touristenfallen am Hafen. Erkunden Sie Gassen, fragen Sie Einheimische. Tischreservierung empfohlen." },
      { icon: "luggage", title: "Was einpacken?", description: "Bequeme Wanderschuhe, Sonnenschutz, Badesachen, leichtes Gepäck (viele Treppen!), Regenjacke (auch im Sommer)." }
    ],
    stats: [
      { value: "2-3 Tage", label: "Mindestaufenthalt" },
      { value: "€16-36", label: "Cinque Terre Card" },
      { value: "Apr-Okt", label: "Hauptsaison" },
      { value: "15-30min", label: "Zug-Frequenz" }
    ],
    cta: {
      title: "Noch Fragen?",
      subtitle: "Lesen Sie unsere detaillierten Reiseführer oder kontaktieren Sie uns für persönliche Beratung.",
      buttons: [
        { text: "Reiseführer lesen", url: "/de/cinque-terre/overview", variant: "primary" },
        { text: "Insider-Tipps", url: "/de/cinque-terre/insights", variant: "secondary" }
      ]
    }
  },

  insights: {
    hero: {
      eyebrow: "Insider-Tipps",
      title: "Geheimtipps für {CITY}",
      subtitle: "Entdecken Sie versteckte Schätze, lokale Favoriten und Insider-Wissen für einen authentischen Aufenthalt in {CITY_DAT}. Abseits der Touristenpfade.",
      buttons: [
        { text: "Tipps entdecken", url: "#insights", variant: "primary" },
        { text: "Alle Dörfer", url: "/de/cinque-terre/overview", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1488646953014-85cb44e25828?w=1200&q=80"
    },
    features: [
      { icon: "map", title: "Früh aufstehen lohnt sich", description: "Besuchen Sie Aussichtspunkte und Fotospots bei Sonnenaufgang (6-7 Uhr) – fast menschenleer und magisches Licht." },
      { icon: "shopping-bag", title: "Lokale Märkte", description: "Mittwochs in Levanto, Freitags in La Spezia. Kaufen Sie frisches Obst, Käse, Oliven und Focaccia wie Einheimische." },
      { icon: "wine-glass", title: "Aperitivo-Zeit nutzen", description: "18-20 Uhr: Drinks mit kostenlosen Snacks in Bars. Geselliges Treffen mit Locals und Blick auf Sonnenuntergang." },
      { icon: "clock", title: "Siesta respektieren", description: "13-16 Uhr schließen viele Geschäfte. Nutzen Sie diese Zeit zum Baden, Entspannen oder Wandern in der Hitze." },
      { icon: "train", title: "Zug-Tipps", description: "Rechte Seite bei Fahrt Richtung Norden = Meerblick. Cinque Terre Card einmalig validieren, dann frei fahren." },
      { icon: "camera", title: "Geheime Fotospots", description: "Friedhöfe oberhalb der Dörfer, Weinbergpfade bei Sonnenuntergang, Hafenmolen bei Flut – weniger bekannt, grandios!" }
    ],
    stats: [
      { value: "6-7 Uhr", label: "Beste Fotozeit" },
      { value: "18-20 Uhr", label: "Aperitivo-Zeit" },
      { value: "13-16 Uhr", label: "Siesta" },
      { value: "Mittwoch", label: "Markt-Tag Levanto" }
    ],
    cta: {
      title: "Erleben Sie {CITY_ACC} wie ein Insider",
      subtitle: "Nutzen Sie unsere Geheimtipps und entdecken Sie die authentische Seite der Cinque Terre.",
      buttons: [
        { text: "Reiseplanung starten", url: "/de/cinque-terre/getting-here", variant: "primary" },
        { text: "FAQ lesen", url: "/de/cinque-terre/faq", variant: "secondary" }
      ]
    }
  },

  maps: {
    hero: {
      eyebrow: "Karten & Navigation",
      title: "Karten von {CITY}",
      subtitle: "Interaktive Karten, Wanderwege, Sehenswürdigkeiten und praktische Orientierungshilfen für {CITY_ACC}. Laden Sie PDF-Karten herunter oder nutzen Sie unsere Online-Navigation.",
      buttons: [
        { text: "Karte öffnen", url: "#maps", variant: "primary" },
        { text: "Wanderwege ansehen", url: "/de/cinque-terre/hiking", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1524661135-423995f22d0b?w=1200&q=80"
    },
    features: [
      { icon: "map", title: "Dorfkarten", description: "Detaillierte Karten jedes Dorfes mit Gassen, Treppen, Restaurants, Hotels und Sehenswürdigkeiten." },
      { icon: "hiking", title: "Wanderkarten", description: "Alle offiziellen Wanderwege mit Schwierigkeitsgrad, Dauer, Höhenprofil und aktuellen Sperrungen." },
      { icon: "train", title: "Verkehrskarten", description: "Bahnhöfe, Buslinien, Parkplätze, Bootshäfen und Cinque Terre Card Verkaufsstellen." },
      { icon: "restaurant", title: "Restaurant-Guide", description: "Markierte Trattorien, Cafés, Gelaterias und Weinbars mit Bewertungen und Preisklassen." },
      { icon: "eye", title: "Aussichtspunkte", description: "Beste Fotospots, Panoramaterrassen und versteckte Viewpoints für spektakuläre Ausblicke." },
      { icon: "download", title: "Offline-Karten", description: "PDF-Downloads zum Ausdrucken oder Offline-Nutzung auf dem Smartphone ohne Internetverbindung." }
    ],
    stats: [
      { value: "5", label: "Dorfkarten" },
      { value: "20+", label: "Wanderwege" },
      { value: "100+", label: "Points of Interest" },
      { value: "PDF", label: "Download verfügbar" }
    ],
    cta: {
      title: "Navigieren Sie wie ein Profi",
      subtitle: "Laden Sie unsere Karten herunter und erkunden Sie {CITY_ACC} mit Leichtigkeit.",
      buttons: [
        { text: "Anreise planen", url: "/de/cinque-terre/getting-here", variant: "primary" },
        { text: "Insider-Tipps", url: "/de/cinque-terre/insights", variant: "secondary" }
      ]
    }
  },

  agriturismi: {
    hero: {
      eyebrow: "Bauernhöfe",
      title: "Agriturismi bei {CITY}",
      subtitle: "Erleben Sie authentisches Landleben in Bauernhof-Unterkünften rund um {CITY_ACC}. Genießen Sie hausgemachte Küche, lokale Weine und die Ruhe der ligurischen Hügel.",
      buttons: [
        { text: "Agriturismi entdecken", url: "#agriturismi", variant: "primary" },
        { text: "Hotels ansehen", url: "{PREFIX}/hotels", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1200&q=80"
    },
    features: [
      { icon: "home", title: "Authentisches Landleben", description: "Übernachten Sie auf echten Bauernhöfen und Weingütern in den Hügeln über den Cinque Terre." },
      { icon: "utensils", title: "Farm-to-Table Küche", description: "Genießen Sie Gerichte aus eigener Produktion: Gemüse, Olivenöl, Wein und Käse vom Hof." },
      { icon: "wine-glass", title: "Weinproben inklusive", description: "Viele Agriturismi produzieren eigenen Wein und bieten Verkostungen mit Kellertour an." },
      { icon: "mountain", title: "Ruhige Lage", description: "Fernab vom Trubel der Küste, perfekt zum Entspannen mit Blick auf Weinberge und Olivenhaine." },
      { icon: "car", title: "Auto empfohlen", description: "Die meisten Agriturismi liegen in den Hügeln – eigenes Auto oder Taxi zur Anreise nötig." },
      { icon: "users", title: "Persönlicher Kontakt", description: "Familienbetriebe mit herzlicher Gastfreundschaft und Einblicken in traditionelle Landwirtschaft." }
    ],
    stats: [
      { value: "25+", label: "Agriturismi in der Region" },
      { value: "€60-150", label: "Preis/Nacht" },
      { value: "4.7★", label: "Gästebewertung" },
      { value: "Bio", label: "Oft biologisch" }
    ],
    cta: {
      title: "Erleben Sie ligurisches Landleben",
      subtitle: "Buchen Sie Ihren Aufenthalt auf einem Bauernhof und genießen Sie Ruhe, Natur und authentische Küche.",
      buttons: [
        { text: "Alle Unterkünfte", url: "{PREFIX}/hotels", variant: "primary" },
        { text: "Restaurants entdecken", url: "{PREFIX}/restaurants", variant: "secondary" }
      ]
    }
  },

  blog: {
    hero: {
      eyebrow: "Reiseberichte",
      title: "Stories aus {CITY}",
      subtitle: "Lesen Sie inspirierende Reiseberichte, persönliche Erfahrungen und Geschichten von Besuchern und Locals aus {CITY_DAT}. Lassen Sie sich für Ihre eigene Reise inspirieren.",
      buttons: [
        { text: "Artikel lesen", url: "#blog", variant: "primary" },
        { text: "Insider-Tipps", url: "/de/cinque-terre/insights", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1455849318743-b2233052fcff?w=1200&q=80"
    },
    features: [
      { icon: "book-open", title: "Reiseberichte", description: "Persönliche Geschichten von Wanderungen, Entdeckungen und unvergesslichen Momenten in den Cinque Terre." },
      { icon: "camera", title: "Foto-Essays", description: "Visuelle Reisen durch die Dörfer – die schönsten Fotospots und ihre Geschichten." },
      { icon: "utensils", title: "Kulinarische Entdeckungen", description: "Berichte über versteckte Trattorien, traditionelle Rezepte und Weinproben in lokalen Kellern." },
      { icon: "users", title: "Local Stories", description: "Interviews mit Einheimischen: Fischer, Winzer, Restaurantbesitzer teilen ihre Geschichten." },
      { icon: "compass", title: "Geheimtipps & Hacks", description: "Praktische Tipps von erfahrenen Reisenden: wie man Menschenmassen meidet und Geld spart." },
      { icon: "heart", title: "Love Stories", description: "Romantische Erlebnisse, Heiratsanträge und Flitterwochen-Berichte aus der Region." }
    ],
    stats: [
      { value: "100+", label: "Artikel" },
      { value: "50+", label: "Autoren" },
      { value: "Wöchentlich", label: "Neue Stories" },
      { value: "4.9★", label: "Leser-Rating" }
    ],
    cta: {
      title: "Lassen Sie sich inspirieren",
      subtitle: "Lesen Sie echte Geschichten und planen Sie Ihre eigene unvergessliche Cinque Terre Reise.",
      buttons: [
        { text: "Reiseplanung starten", url: "/de/cinque-terre/getting-here", variant: "primary" },
        { text: "Alle Dörfer", url: "/de/cinque-terre/overview", variant: "secondary" }
      ]
    }
  },

  camping: {
    hero: {
      eyebrow: "Camping",
      title: "Camping bei {CITY}",
      subtitle: "Campingplätze in der Nähe von {CITY_DAT} für Naturliebhaber. Zelten, Wohnmobile und Glamping mit Meerblick, direktem Strandzugang und Nähe zu Wanderwegen.",
      buttons: [
        { text: "Campingplätze ansehen", url: "#camping", variant: "primary" },
        { text: "Hotels ansehen", url: "{PREFIX}/hotels", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1478131143081-80f7f84ca84d?w=1200&q=80"
    },
    features: [
      { icon: "tent", title: "Campingplätze", description: "Gepflegte Plätze mit Sanitäranlagen, Stromanschlüssen und oft Pool – nahe den Cinque Terre Dörfern." },
      { icon: "caravan", title: "Wohnmobil-Stellplätze", description: "Dedizierte Stellplätze für Camper und Wohnmobile mit Ver- und Entsorgung." },
      { icon: "star", title: "Glamping", description: "Luxuriöses Camping in Safari-Zelten oder Holz-Chalets mit echten Betten und eigenem Bad." },
      { icon: "waves", title: "Strandzugang", description: "Viele Campingplätze bieten direkten Zugang zu privaten Stränden oder sind nur 5-10 Gehminuten entfernt." },
      { icon: "utensils", title: "Restaurant & Bar", description: "Die meisten Plätze haben eigene Restaurants, Bars und kleine Supermärkte für Selbstversorger." },
      { icon: "dollar-sign", title: "Preiswert", description: "Günstigere Alternative zu Hotels – ideal für Familien, Backpacker und Naturfreunde." }
    ],
    stats: [
      { value: "10+", label: "Campingplätze" },
      { value: "€20-60", label: "Preis/Nacht" },
      { value: "Apr-Okt", label: "Hauptsaison" },
      { value: "4.3★", label: "Durchschnittsbewertung" }
    ],
    cta: {
      title: "Naturnahes Camping-Erlebnis",
      subtitle: "Buchen Sie Ihren Campingplatz und genießen Sie die Cinque Terre im Einklang mit der Natur.",
      buttons: [
        { text: "Alle Unterkünfte", url: "{PREFIX}/hotels", variant: "primary" },
        { text: "Aktivitäten", url: "{PREFIX}/things-to-do", variant: "secondary" }
      ]
    }
  },

  overview: {
    hero: {
      eyebrow: "{CITY_TITLE}",
      title: "Willkommen in {CITY}",
      subtitle: "{CITY_INTRO}",
      buttons: [
        { text: "Sehenswürdigkeiten", url: "{PREFIX}/sights", variant: "primary" },
        { text: "Wanderwege", url: "{PREFIX}/hiking", variant: "secondary" }
      ],
      image: "{CITY_IMAGE}"
    },
    features: [
      { icon: "map-pin", title: "{FEATURE1_TITLE}", description: "{FEATURE1_DESC}" },
      { icon: "camera", title: "{FEATURE2_TITLE}", description: "{FEATURE2_DESC}" },
      { icon: "utensils", title: "{FEATURE3_TITLE}", description: "{FEATURE3_DESC}" },
      { icon: "hotel", title: "{FEATURE4_TITLE}", description: "{FEATURE4_DESC}" },
      { icon: "hiking", title: "{FEATURE5_TITLE}", description: "{FEATURE5_DESC}" },
      { icon: "anchor", title: "{FEATURE6_TITLE}", description: "{FEATURE6_DESC}" }
    ],
    stats: [
      { value: "{STAT1_VALUE}", label: "{STAT1_LABEL}" },
      { value: "{STAT2_VALUE}", label: "{STAT2_LABEL}" },
      { value: "{STAT3_VALUE}", label: "{STAT3_LABEL}" },
      { value: "{STAT4_VALUE}", label: "{STAT4_LABEL}" }
    ],
    cta: {
      title: "Entdecken Sie {CITY_ACC}",
      subtitle: "Planen Sie Ihren perfekten Besuch mit unseren detaillierten Reiseführern und Insider-Tipps.",
      buttons: [
        { text: "Anreise planen", url: "{PREFIX}/getting-here", variant: "primary" },
        { text: "Unterkünfte buchen", url: "{PREFIX}/hotels", variant: "secondary" }
      ]
    }
  },

  restaurants: {
    hero: {
      eyebrow: "Gastronomie",
      title: "Restaurants in {CITY}",
      subtitle: "Entdecken Sie die besten Restaurants, Trattorien und Osterias in {CITY_DAT}. Von frischen Meeresfrüchten bis zu hausgemachtem Pesto – authentische ligurische Küche erwartet Sie.",
      buttons: [
        { text: "Restaurants entdecken", url: "#restaurants", variant: "primary" },
        { text: "Lokale Spezialitäten", url: "/de/cinque-terre/restaurants", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80"
    },
    features: [
      { icon: "fish", title: "Frische Meeresfrüchte", description: "Fangfrischer Fisch, Anchovis, Tintenfisch und Muscheln direkt vom Boot auf den Teller." },
      { icon: "leaf", title: "Pesto alla Genovese", description: "Das berühmte Basilikum-Pesto mit Pinienkernen, Knoblauch und Parmesan – ein absolutes Muss!" },
      { icon: "wine-glass", title: "Lokale Weine", description: "Cinque Terre DOC Weißwein und der legendäre süße Sciacchetrà Dessertwein." },
      { icon: "utensils", title: "Trofie & Focaccia", description: "Handgemachte Pasta und knuspriges ligurisches Fladenbrot mit Olivenöl und Rosmarin." },
      { icon: "eye", title: "Meerblick-Terrassen", description: "Viele Restaurants bieten spektakuläre Ausblicke auf den Hafen und das Mittelmeer." },
      { icon: "dollar-sign", title: "Für jedes Budget", description: "Von günstigen Paninotecas bis zu gehobenen Gourmet-Restaurants mit Michelin-Empfehlung." }
    ],
    stats: [
      { value: "30+", label: "Restaurants" },
      { value: "€15-60", label: "Hauptgericht" },
      { value: "4.4★", label: "Durchschnittsbewertung" },
      { value: "11-22h", label: "Öffnungszeiten" }
    ],
    cta: {
      title: "Genießen Sie ligurische Küche",
      subtitle: "Reservieren Sie Ihren Tisch in den besten Restaurants von {CITY} und erleben Sie kulinarische Höhepunkte.",
      buttons: [
        { text: "Aktivitäten ansehen", url: "{PREFIX}/things-to-do", variant: "primary" },
        { text: "Unterkünfte buchen", url: "{PREFIX}/hotels", variant: "secondary" }
      ]
    }
  },

  hotels: {
    hero: {
      eyebrow: "Unterkünfte",
      title: "Hotels in {CITY}",
      subtitle: "Von charmanten Boutique-Hotels bis zu luxuriösen Meerblick-Suiten – finden Sie die perfekte Unterkunft in {CITY_DAT} für Ihren Traumurlaub.",
      buttons: [
        { text: "Hotels durchsuchen", url: "#hotels", variant: "primary" },
        { text: "Ferienwohnungen", url: "{PREFIX}/apartments", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=1200&q=80"
    },
    features: [
      { icon: "hotel", title: "Boutique-Hotels", description: "Kleine, stilvolle Hotels mit persönlichem Service in historischen Gebäuden mit modernem Komfort." },
      { icon: "eye", title: "Meerblick-Zimmer", description: "Wachen Sie mit Blick auf das azurblaue Mittelmeer und die bunten Häuser am Hang auf." },
      { icon: "map-pin", title: "Zentrale Lage", description: "Zu Fuß erreichbar vom Bahnhof, Hafen und den wichtigsten Sehenswürdigkeiten." },
      { icon: "coffee", title: "Frühstück inklusive", description: "Starten Sie den Tag mit frischem Gebäck, lokalem Käse, Wurst und italienischem Espresso." },
      { icon: "wifi", title: "Moderne Ausstattung", description: "WLAN, Klimaanlage, komfortable Betten und saubere Badezimmer als Standard." },
      { icon: "dollar-sign", title: "Alle Preisklassen", description: "Von Budget-Pensionen bis zu Luxury-Resorts – für jeden Geldbeutel die richtige Unterkunft." }
    ],
    stats: [
      { value: "40+", label: "Hotels & Pensionen" },
      { value: "€80-350", label: "Preis/Nacht" },
      { value: "4.5★", label: "Durchschnittsbewertung" },
      { value: "90%", label: "Mit Meerblick" }
    ],
    cta: {
      title: "Buchen Sie Ihre Traumunterkunft",
      subtitle: "Sichern Sie sich die besten Hotels in {CITY} – frühzeitig buchen empfohlen!",
      buttons: [
        { text: "Anreise planen", url: "{PREFIX}/getting-here", variant: "primary" },
        { text: "Aktivitäten", url: "{PREFIX}/things-to-do", variant: "secondary" }
      ]
    }
  },

  beaches: {
    hero: {
      eyebrow: "Strände & Baden",
      title: "Strände in {CITY}",
      subtitle: "Entdecken Sie die schönsten Badeplätze in {CITY_DAT}. Von Kiesstränden bis zu Felsplattformen – kristallklares Wasser und malerische Kulisse inklusive.",
      buttons: [
        { text: "Strände entdecken", url: "#beaches", variant: "primary" },
        { text: "Bootstouren", url: "{PREFIX}/boat-tours", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1559827260-dc66d52bef19?w=1200&q=80"
    },
    features: [
      { icon: "waves", title: "Kiesstrände", description: "Kleine Kiesstrände mit Liegestuhl-Verleih, Bars und sanftem Einstieg ins türkisblaue Wasser." },
      { icon: "mountain", title: "Felsplattformen", description: "Sonnenbaden auf glatten Felsen mit Leitern ins tiefe Meer – ideal zum Schnorcheln." },
      { icon: "sun", title: "Sonnenterrassen", description: "Geschützte Buchten und erhöhte Plattformen für entspanntes Sonnenbaden mit Panoramablick." },
      { icon: "fish", title: "Schnorcheln", description: "Klares Wasser mit Sichtweiten bis 10m – beobachten Sie bunte Fische und Meeresbewohner." },
      { icon: "anchor", title: "Hafenbaden", description: "Baden direkt im Dorfhafen zwischen Booten – authentisch und zentral gelegen." },
      { icon: "umbrella", title: "Strandausstattung", description: "Liegestuhl und Sonnenschirm-Verleih (€15-25/Tag), Duschen, Umkleiden und Beach-Bars." }
    ],
    stats: [
      { value: "5+", label: "Badeplätze" },
      { value: "22-25°C", label: "Wassertemperatur (Sommer)" },
      { value: "Jun-Sep", label: "Badesaison" },
      { value: "8m+", label: "Sichtweite" }
    ],
    cta: {
      title: "Genießen Sie Sonne und Meer",
      subtitle: "Entdecken Sie die besten Strände in {CITY} und planen Sie Ihren perfekten Badetag.",
      buttons: [
        { text: "Wetter prüfen", url: "/de/cinque-terre/weather", variant: "primary" },
        { text: "Bootstouren buchen", url: "{PREFIX}/boat-tours", variant: "secondary" }
      ]
    }
  },

  events: {
    hero: {
      eyebrow: "Feste & Kultur",
      title: "Veranstaltungen in {CITY}",
      subtitle: "Erleben Sie traditionelle Feste, religiöse Prozessionen und kulturelle Events in {CITY_DAT}. Tauchen Sie ein in authentische ligurische Traditionen und Lebensfreude.",
      buttons: [
        { text: "Veranstaltungskalender", url: "#events", variant: "primary" },
        { text: "Beste Reisezeit", url: "/de/cinque-terre/weather", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80"
    },
    features: [
      { icon: "calendar", title: "Patronatsfeste", description: "Jährliche Festlichkeiten zu Ehren des Dorfheiligen mit Prozession, Feuerwerk und Straßenfest." },
      { icon: "wine-glass", title: "Weinfeste", description: "Weinlese-Feiern im Herbst mit Verkostungen, traditioneller Musik und kulinarischen Spezialitäten." },
      { icon: "music", title: "Live-Konzerte", description: "Sommerkonzerte auf Piazzas und in historischen Kirchen – von klassischer Musik bis Jazz." },
      { icon: "utensils", title: "Food Festivals", description: "Sagre zu Ehren lokaler Spezialitäten: Anchovis, Pesto, Focaccia und Meeresfrüchte." },
      { icon: "sparkles", title: "Religiöse Feiertage", description: "Ostern, Weihnachten und Marienfeste mit Prozessionen, Krippen und feierlichen Messen." },
      { icon: "users", title: "Dorffeste", description: "Spontane Straßenfeste, Tanzabende und gemeinschaftliche Feiern – authentisch und gesellig." }
    ],
    stats: [
      { value: "15+", label: "Jährliche Events" },
      { value: "Mai-Sep", label: "Fest-Saison" },
      { value: "Kostenlos", label: "Meiste Events" },
      { value: "800+", label: "Jahre Tradition" }
    ],
    cta: {
      title: "Erleben Sie die Kultur",
      subtitle: "Planen Sie Ihren Besuch während eines traditionellen Festes und tauchen Sie ein in das echte Leben der Cinque Terre.",
      buttons: [
        { text: "Unterkünfte buchen", url: "{PREFIX}/hotels", variant: "primary" },
        { text: "Reiseplanung", url: "/de/cinque-terre/getting-here", variant: "secondary" }
      ]
    }
  },

  sights: {
    hero: {
      eyebrow: "Sehenswürdigkeiten",
      title: "Highlights in {CITY}",
      subtitle: "Entdecken Sie die wichtigsten Sehenswürdigkeiten und Attraktionen in {CITY_DAT}. Von historischen Kirchen bis zu spektakulären Aussichtspunkten.",
      buttons: [
        { text: "Sehenswürdigkeiten entdecken", url: "#sights", variant: "primary" },
        { text: "Wanderwege", url: "{PREFIX}/hiking", variant: "secondary" }
      ],
      image: "https://images.unsplash.com/photo-1523906834658-6e24ef2386f9?w=1200&q=80"
    },
    features: [
      { icon: "church", title: "Historische Kirchen", description: "Mittelalterliche Kirchen mit Kunstschätzen, Fresken und spektakulärer Architektur." },
      { icon: "castle", title: "Burgruinen", description: "Reste alter Verteidigungsanlagen mit Panoramablick über Dorf und Küste." },
      { icon: "eye", title: "Aussichtspunkte", description: "Terrassen und Viewpoints mit atemberaubenden Ausblicken auf Meer und Berge." },
      { icon: "camera", title: "Fotospots", description: "Die ikonischsten Fotomotive: bunte Häuser, malerischer Hafen und steile Gassen." },
      { icon: "map-pin", title: "Dorfplätze", description: "Lebendige Piazzas mit Cafés, Bars und dem authentischen Treiben der Einheimischen." },
      { icon: "anchor", title: "Hafenanlagen", description: "Malerische Häfen mit Fischerbooten, Restaurants und Zugang zu Bootstouren." }
    ],
    stats: [
      { value: "10+", label: "Top-Sehenswürdigkeiten" },
      { value: "5+", label: "Historische Kirchen" },
      { value: "Kostenlos", label: "Meiste Attraktionen" },
      { value: "1000+", label: "Jahre Geschichte" }
    ],
    cta: {
      title: "Erkunden Sie {CITY_ACC}",
      subtitle: "Entdecken Sie die Geschichte, Kultur und Schönheit von {CITY} mit unserem detaillierten Reiseführer.",
      buttons: [
        { text: "Alle Dörfer", url: "/de/cinque-terre/overview", variant: "primary" },
        { text: "Aktivitäten", url: "{PREFIX}/things-to-do", variant: "secondary" }
      ]
    }
  }
};

// Village-specific data
const villageData: Record<string, any> = {
  "cinque-terre": {
    name: "Cinque Terre",
    nameAcc: "die Cinque Terre",
    nameDat: "den Cinque Terre",
    prefix: "/de/cinque-terre",
    intro: "Fünf malerische Fischerdörfer an der italienischen Riviera, verbunden durch spektakuläre Wanderwege und azurblaues Mittelmeer. UNESCO-Weltkulturerbe seit 1997.",
    image: "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?w=1200&q=80",
    features: [
      { title: "Fünf einzigartige Dörfer", desc: "Monterosso, Vernazza, Corniglia, Manarola und Riomaggiore – jedes mit eigenem Charakter." },
      { title: "UNESCO-Welterbe", desc: "Geschützt seit 1997 als Kulturlandschaft von außergewöhnlichem universellem Wert." },
      { title: "Spektakuläre Wanderwege", desc: "Über 120km markierte Pfade entlang der Küste mit atemberaubenden Mittelmeerblicken." },
      { title: "Authentische Küche", desc: "Frische Meeresfrüchte, Pesto alla Genovese und lokale Weine aus steilen Weinbergen." },
      { title: "Bootstouren & Strände", desc: "Versteckte Buchten, Kiesstrände und Bootsausflüge entlang der dramatischen Küste." },
      { title: "Historisches Erbe", desc: "Mittelalterliche Burgen, romanische Kirchen und jahrhundertealte Terrassenweinberge." }
    ],
    stats: [
      { value: "5", label: "Malerische Dörfer" },
      { value: "12km", label: "Küstenlinie" },
      { value: "1997", label: "UNESCO-Status" },
      { value: "120km", label: "Wanderwege" }
    ]
  },
  "monterosso": {
    name: "Monterosso al Mare",
    nameAcc: "Monterosso",
    nameDat: "Monterosso",
    prefix: "/de/monterosso",
    intro: "Das größte und nördlichste Dorf der Cinque Terre mit dem einzigen Sandstrand der Region. Charmante Altstadt, lebendige Strandpromenade und ausgezeichnete Restaurants.",
    image: "https://images.unsplash.com/photo-1530629671104-326b3c5517b3?w=1200&q=80",
    features: [
      { title: "Sandstrand", desc: "Der einzige echte Sandstrand der Cinque Terre – ideal für Familien mit Kindern." },
      { title: "Zwei Ortsteile", desc: "Historische Altstadt und moderne Fegina mit Hotels, Restaurants und Strandpromenade." },
      { title: "San Giovanni Battista", desc: "Gotische Kirche mit schwarz-weißer Fassade und bedeutender Kunstsammlung." },
      { title: "Il Gigante", desc: "14m hohe Statue des Neptun aus dem frühen 20. Jahrhundert – Wahrzeichen von Monterosso." },
      { title: "Beste Infrastruktur", desc: "Die meisten Hotels, Restaurants und Geschäfte der fünf Dörfer." },
      { title: "Ausgangspunkt", desc: "Idealer Start für Wanderungen nach Vernazza und zum Sanctuary Madonna di Soviore." }
    ],
    stats: [
      { value: "1500", label: "Einwohner" },
      { value: "Sandstrand", label: "Einziger in 5T" },
      { value: "50+", label: "Restaurants" },
      { value: "3,5km", label: "Nach Vernazza" }
    ]
  },
  "vernazza": {
    name: "Vernazza",
    nameAcc: "Vernazza",
    nameDat: "Vernazza",
    prefix: "/de/vernazza",
    intro: "Das fotogenste und charmanteste Dorf der Cinque Terre mit seinem ikonischen Hafen und der mittelalterlichen Burg. Gilt als das schönste der fünf Dörfer.",
    image: "https://images.unsplash.com/photo-1548585745-6712225f5aad?w=1200&q=80",
    features: [
      { title: "Castello Doria", desc: "Mittelalterliche Burg aus dem 11. Jahrhundert mit 360°-Panoramablick über Dorf und Küste." },
      { title: "Malerischer Hafen", desc: "Der fotogenste Hafen Italiens – bunte Boote, Restaurants und kleiner Badestrand." },
      { title: "Piazza Marconi", desc: "Lebendiger Dorfplatz direkt am Meer mit Cafés, Gelaterias und Aperitivo-Bars." },
      { title: "Santa Margherita", desc: "Romanische Kirche aus dem 13. Jahrhundert mit achteckigem Glockenturm." },
      { title: "Wanderwege", desc: "Zentral gelegen für Wanderungen nach Monterosso und Corniglia." },
      { title: "Authentisches Flair", desc: "Trotz Tourismus bewahrt Vernazza sein authentisches Fischerdorf-Ambiente." }
    ],
    stats: [
      { value: "800", label: "Einwohner" },
      { value: "11. Jh.", label: "Castello Doria" },
      { value: "30+", label: "Restaurants" },
      { value: "Nr. 1", label: "Schönstes Dorf" }
    ]
  },
  "corniglia": {
    name: "Corniglia",
    nameAcc: "Corniglia",
    nameDat: "Corniglia",
    prefix: "/de/corniglia",
    intro: "Das einzige Dorf ohne direkten Meeresanschluss, thronend auf einem 100m hohen Felsen. Ruhiger, authentischer und weniger touristisch als die anderen Dörfer.",
    image: "https://images.unsplash.com/photo-1568052153809-40c8e7bed108?w=1200&q=80",
    features: [
      { title: "Lardarina-Treppe", desc: "382 Stufen vom Bahnhof zum Dorf – oder bequem mit dem Shuttle-Bus fahren." },
      { title: "Terrazza Santa Maria", desc: "Spektakuläre Panoramaterrasse mit Blick über die gesamte Küste und Weinberge." },
      { title: "Weinbau-Tradition", desc: "Umgeben von Weinbergen – probieren Sie den lokalen Weißwein in kleinen Vinotheken." },
      { title: "Ruhige Atmosphäre", desc: "Weniger Besucher als andere Dörfer – ideal zum Entspannen und Genießen." },
      { title: "Enge Gassen", desc: "Mittelalterliches Gassengewirr mit bunten Häusern und versteckten Plätzen." },
      { title: "Guvano Beach", desc: "Versteckter Strand erreichbar durch alten Tunnel – abgelegen und naturbelassen." }
    ],
    stats: [
      { value: "250", label: "Einwohner" },
      { value: "100m", label: "Über dem Meer" },
      { value: "382", label: "Stufen zum Dorf" },
      { value: "Ruhigst", label: "Der fünf Dörfer" }
    ]
  },
  "manarola": {
    name: "Manarola",
    nameAcc: "Manarola",
    nameDat: "Manarola",
    prefix: "/de/manarola",
    intro: "Berühmt für seine bunten Häuser am steilen Hang und den spektakulären Sonnenuntergang am Hafen. Die weltgrößte beleuchtete Krippe im Winter.",
    image: "https://images.unsplash.com/photo-1565092744301-7c87cd6b3e47?w=1200&q=80",
    features: [
      { title: "Ikonische Skyline", desc: "Bunte Turmhäuser am Hang – das meistfotografierte Motiv der Cinque Terre." },
      { title: "Via dell'Amore", desc: "Der berühmte Liebespfad nach Riomaggiore – romantischer Spaziergang über dem Meer." },
      { title: "Presepe di Manarola", desc: "Weltgrößte beleuchtete Krippe mit 15.000 Lichtern (Dezember-Januar)." },
      { title: "Sonnenuntergang", desc: "Die Felsen am Hafen bieten den besten Sunset-Spot der gesamten Region." },
      { title: "Weinproben", desc: "Umgeben von steilen Weinbergen – besuchen Sie lokale Kellereien." },
      { title: "Badeplatz", desc: "Felsplattformen am Hafen zum Sonnenbaden und Schwimmen im kristallklaren Wasser." }
    ],
    stats: [
      { value: "400", label: "Einwohner" },
      { value: "15.000", label: "Lichter (Krippe)" },
      { value: "1km", label: "Via dell'Amore" },
      { value: "Sunset", label: "Bester Spot" }
    ]
  },
  "riomaggiore": {
    name: "Riomaggiore",
    nameAcc: "Riomaggiore",
    nameDat: "Riomaggiore",
    prefix: "/de/riomaggiore",
    intro: "Das südlichste und eines der ältesten Dörfer der Cinque Terre mit steilen Gassen, bunten Häusern und dem Start des berühmten Via dell'Amore Wanderwegs.",
    image: "https://images.unsplash.com/photo-1583960285721-bb89ed7129db?w=1200&q=80",
    features: [
      { title: "Via dell'Amore Start", desc: "Beginn des romantischen Liebespfads nach Manarola – derzeit teilweise gesperrt." },
      { title: "Steile Gassen", desc: "Via Colombo als Hauptstraße mit bunten Turmhäusern zu beiden Seiten." },
      { title: "Marina di Riomaggiore", desc: "Kleiner Hafen mit Bademöglichkeit, Restaurants und Bootstouren." },
      { title: "San Giovanni Battista", desc: "Gotische Kirche aus 1340 mit Rosettenfenster und Marmorportal." },
      { title: "Weinberge & Wanderungen", desc: "Umgeben von Weinberg-Terrassen mit Wanderwegen zum Sanctuary." },
      { title: "Lebendiges Nachtleben", desc: "Mehr Bars und Clubs als andere Dörfer – lebendig auch nach Sonnenuntergang." }
    ],
    stats: [
      { value: "1600", label: "Einwohner" },
      { value: "1340", label: "Kirche erbaut" },
      { value: "Ältestes", label: "Dorf (vermutlich)" },
      { value: "20+", label: "Bars & Restaurants" }
    ]
  }
};

// Main execution
async function main() {
  const files = await glob("/Users/drietsch/agentpress/cinqueterre.travel/content/pages/de/**/*.json");

  let processed = 0;
  let skipped = 0;

  for (const file of files) {
    try {
      const content = JSON.parse(readFileSync(file, 'utf-8'));

      // Skip if already has content
      if (content.body && content.body.length > 0) {
        skipped++;
        continue;
      }

      // Extract city and page type
      const pathParts = file.split('/');
      const fileName = pathParts[pathParts.length - 1].replace('.json', '');
      const cityFolder = pathParts[pathParts.length - 2];
      const pageType = content.page_type || fileName;

      // Get village data
      const village = villageData[cityFolder];
      if (!village) {
        console.log(`No village data for: ${cityFolder}`);
        continue;
      }

      // Get page template
      const template = pageContent[pageType];
      if (!template) {
        console.log(`No template for page type: ${pageType}`);
        continue;
      }

      // Replace placeholders
      const replaceText = (text: string) => {
        if (typeof text !== 'string') return text;
        return text
          .replace(/\{CITY\}/g, village.name)
          .replace(/\{CITY_ACC\}/g, village.nameAcc)
          .replace(/\{CITY_DAT\}/g, village.nameDat)
          .replace(/\{CITY_TITLE\}/g, village.name)
          .replace(/\{CITY_INTRO\}/g, village.intro || '')
          .replace(/\{CITY_IMAGE\}/g, village.image || '')
          .replace(/\{PREFIX\}/g, village.prefix)
          .replace(/\{FEATURE1_TITLE\}/g, village.features?.[0]?.title || '')
          .replace(/\{FEATURE1_DESC\}/g, village.features?.[0]?.desc || '')
          .replace(/\{FEATURE2_TITLE\}/g, village.features?.[1]?.title || '')
          .replace(/\{FEATURE2_DESC\}/g, village.features?.[1]?.desc || '')
          .replace(/\{FEATURE3_TITLE\}/g, village.features?.[2]?.title || '')
          .replace(/\{FEATURE3_DESC\}/g, village.features?.[2]?.desc || '')
          .replace(/\{FEATURE4_TITLE\}/g, village.features?.[3]?.title || '')
          .replace(/\{FEATURE4_DESC\}/g, village.features?.[3]?.desc || '')
          .replace(/\{FEATURE5_TITLE\}/g, village.features?.[4]?.title || '')
          .replace(/\{FEATURE5_DESC\}/g, village.features?.[4]?.desc || '')
          .replace(/\{FEATURE6_TITLE\}/g, village.features?.[5]?.title || '')
          .replace(/\{FEATURE6_DESC\}/g, village.features?.[5]?.desc || '')
          .replace(/\{STAT1_VALUE\}/g, village.stats?.[0]?.value || '')
          .replace(/\{STAT1_LABEL\}/g, village.stats?.[0]?.label || '')
          .replace(/\{STAT2_VALUE\}/g, village.stats?.[1]?.value || '')
          .replace(/\{STAT2_LABEL\}/g, village.stats?.[1]?.label || '')
          .replace(/\{STAT3_VALUE\}/g, village.stats?.[2]?.value || '')
          .replace(/\{STAT3_LABEL\}/g, village.stats?.[2]?.label || '')
          .replace(/\{STAT4_VALUE\}/g, village.stats?.[3]?.value || '')
          .replace(/\{STAT4_LABEL\}/g, village.stats?.[3]?.label || '');
      };

      const replaceInObject = (obj: any): any => {
        if (typeof obj === 'string') return replaceText(obj);
        if (Array.isArray(obj)) return obj.map(replaceInObject);
        if (obj && typeof obj === 'object') {
          const result: any = {};
          for (const key in obj) {
            result[key] = replaceInObject(obj[key]);
          }
          return result;
        }
        return obj;
      };

      // Build body
      const body = [
        { type: "hero-section", variant: "split-with-image", ...replaceInObject(template.hero) },
        { type: "feature-section", variant: "simple-3x2-grid", eyebrow: "Highlights", title: "Top-Erlebnisse", features: replaceInObject(template.features) },
        { type: "stats-section", variant: "simple-grid", eyebrow: "Auf einen Blick", title: "Zahlen & Fakten", stats: replaceInObject(template.stats) },
        { type: "cta-section", variant: "simple-centered-with-gradient", ...replaceInObject(template.cta) },
        footer
      ];

      // Update content
      content.body = body;
      content.updated_at = "2025-12-12T23:00:00.000Z";

      // Write back
      writeFileSync(file, JSON.stringify(content, null, 2));
      processed++;
      console.log(`✓ Populated: ${file}`);

    } catch (error) {
      console.error(`Error processing ${file}:`, error);
    }
  }

  console.log(`\nDone! Processed: ${processed}, Skipped: ${skipped}`);
}

main();
