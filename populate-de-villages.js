const fs = require('fs');
const path = require('path');

// Village-specific content
const villageContent = {
  monterosso: {
    highlights: "Sandstrände, Altstadt, größtes Dorf",
    description: "das größte und nördlichste Dorf der Cinque Terre mit den einzigen Sandstränden der Region"
  },
  vernazza: {
    highlights: "berühmter Hafen, Doria-Burg, beste Fotospots",
    description: "das malerischste Dorf mit dem ikonischen Hafen und der mittelalterlichen Doria-Burg"
  },
  corniglia: {
    highlights: "382 Stufen, Weinberge, Alberto Gelateria, kein Meerzugang",
    description: "das einzige Dorf auf einem Felsvorsprung - 100m über dem Meer mit 382 Stufen"
  },
  manarola: {
    highlights: "Sonnenuntergänge, Nessun Dorma, Weinproduktion, Weihnachtskrippe",
    description: "das berühmteste Fotomotiv der Cinque Terre mit spektakulären Sonnenuntergängen"
  },
  riomaggiore: {
    highlights: "dramatische Klippen, Via dell'Amore, Turmhäuser, Nachtleben",
    description: "das südlichste Dorf mit dramatischen Klippen und bunten Turmhäusern"
  }
};

// Page-specific content templates
const pageTemplates = {
  faq: (village) => ({
    title: `Häufige Fragen zu ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Häufige Fragen zu ${village.charAt(0).toUpperCase() + village.slice(1)} - FAQ`,
      description: `Antworten auf die häufigsten Fragen zu ${village.charAt(0).toUpperCase() + village.slice(1)}. Alles zu Anreise, Unterkünften, bester Reisezeit und Sehenswürdigkeiten.`,
      keywords: `${village} faq, ${village} häufige fragen, ${village} tipps, ${village} guide`
    },
    hero: {
      title: `Häufige Fragen zu ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Antworten auf alle wichtigen Fragen für Ihren Besuch"
    },
    features: [
      {name: "Anreise & Verkehr", description: "Wie komme ich hin? Wo parke ich? Gibt es Züge und Busse?"},
      {name: "Beste Reisezeit", description: "Wann ist die beste Zeit für einen Besuch? Wie ist das Wetter?"},
      {name: "Unterkünfte", description: "Wo übernachte ich am besten? Hotels, Apartments oder Camping?"},
      {name: "Sehenswürdigkeiten", description: "Was muss ich unbedingt sehen? Wie viel Zeit brauche ich?"},
      {name: "Restaurants & Essen", description: "Wo isst man gut? Was sind lokale Spezialitäten?"},
      {name: "Wandern & Aktivitäten", description: "Welche Wanderwege gibt es? Was kann man sonst unternehmen?"}
    ]
  }),
  'getting-here': (village) => ({
    title: `Anreise nach ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Anreise nach ${village.charAt(0).toUpperCase() + village.slice(1)} - Zug, Auto, Bus`,
      description: `Alle Wege nach ${village.charAt(0).toUpperCase() + village.slice(1)}: Mit dem Zug, Auto, Bus oder zu Fuß. Parkplätze, Bahnverbindungen und Transfer-Tipps.`,
      keywords: `${village} anreise, ${village} zug, ${village} parken, ${village} erreichen`
    },
    hero: {
      title: `Anreise nach ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Alle Optionen für eine entspannte Anreise in die Cinque Terre"
    },
    features: [
      {name: "Mit dem Zug", description: "Regionalzüge verbinden alle Dörfer stündlich - die einfachste und schnellste Option."},
      {name: "Mit dem Auto", description: "Sehr begrenzte Parkplätze! Parken Sie besser in La Spezia oder Levanto und nehmen Sie den Zug."},
      {name: "Zu Fuß wandern", description: "Wandern Sie von den Nachbardörfern über die berühmten Küstenwege."},
      {name: "Mit dem Boot", description: "Fähren verbinden die Dörfer im Sommer - eine malerische Alternative."},
      {name: "Transfer-Services", description: "Private Transfers vom Flughafen oder Bahnhof verfügbar."},
      {name: "Barrierefreiheit", description: "Wichtige Informationen für Reisende mit eingeschränkter Mobilität."}
    ]
  }),
  hiking: (village) => ({
    title: `Wanderwege ab ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Wanderwege ab ${village.charAt(0).toUpperCase() + village.slice(1)} - Küstenwege & Trails`,
      description: `Die besten Wanderwege ab ${village.charAt(0).toUpperCase() + village.slice(1)}. Küstenpfade, Weinberg-Trails und Bergwanderungen mit spektakulären Ausblicken.`,
      keywords: `${village} wandern, ${village} wanderwege, cinque terre trails, ${village} hiking`
    },
    hero: {
      title: `Wanderwege ab ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Entdecken Sie die spektakulären Küstenwege und Weinberg-Trails"
    },
    features: [
      {name: "Sentiero Azzurro", description: "Der berühmte blaue Wanderweg entlang der Küste - Cinque Terre Card erforderlich."},
      {name: "Höhenwanderwege", description: "Ruhigere Pfade durch Weinberge und Olivenhaine mit Panoramablicken."},
      {name: "Schwierigkeitsgrade", description: "Von einfachen Spaziergängen bis zu anspruchsvollen Bergwanderungen."},
      {name: "Beste Zeit", description: "Frühjahr und Herbst ideal - im Sommer früh starten wegen der Hitze."},
      {name: "Ausrüstung", description: "Gute Wanderschuhe, Wasser, Sonnenschutz und Wanderkarte empfohlen."},
      {name: "Wegstatus", description: "Prüfen Sie aktuelle Sperrungen - Wege können nach Unwettern geschlossen sein."}
    ]
  }),
  hotels: (village) => ({
    title: `Hotels in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Hotels in ${village.charAt(0).toUpperCase() + village.slice(1)} - Beste Unterkünfte`,
      description: `Die besten Hotels in ${village.charAt(0).toUpperCase() + village.slice(1)}. Von Boutique-Hotels bis Familienunterkünfte - buchen Sie Ihr perfektes Hotel.`,
      keywords: `${village} hotels, ${village} unterkünfte, hotels cinque terre, ${village} übernachten`
    },
    hero: {
      title: `Hotels in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Vom charmanten B&B bis zum Boutique-Hotel mit Meerblick"
    },
    features: [
      {name: "Boutique-Hotels", description: "Stilvolle kleine Hotels mit persönlichem Service und lokalem Charme."},
      {name: "Meerblick-Zimmer", description: "Spektakuläre Ausblicke auf das ligurische Meer und die Küste."},
      {name: "Zentrale Lage", description: "Fußläufig zu Restaurants, Hafen und Sehenswürdigkeiten."},
      {name: "Frühstück inklusive", description: "Viele Hotels bieten italienisches Frühstück mit lokalen Produkten."},
      {name: "Familienzimmer", description: "Optionen für Familien mit Kindern und Gruppen."},
      {name: "Frühzeitig buchen", description: "Hotelzimmer sind begrenzt - buchen Sie Monate im Voraus, besonders im Sommer."}
    ]
  }),
  insights: (village) => ({
    title: `Insider-Tipps für ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Insider-Tipps für ${village.charAt(0).toUpperCase() + village.slice(1)} - Geheimtipps`,
      description: `Lokale Geheimtipps für ${village.charAt(0).toUpperCase() + village.slice(1)}. Versteckte Orte, beste Fotospots und authentische Erlebnisse abseits der Touristenpfade.`,
      keywords: `${village} insider tipps, ${village} geheimtipps, ${village} lokal, ${village} versteckt`
    },
    hero: {
      title: `Insider-Tipps für ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Entdecken Sie versteckte Juwelen und authentische Erlebnisse"
    },
    features: [
      {name: "Beste Fotospots", description: "Wo die Einheimischen fotografieren - spektakuläre Ausblicke ohne Menschenmassen."},
      {name: "Geheime Strände", description: "Versteckte Buchten und ruhige Badeplätze abseits der Hauptstrände."},
      {name: "Lokale Trattorien", description: "Authentische Restaurants wo die Einheimischen essen - keine Touristenfallen."},
      {name: "Früh aufstehen", description: "Erleben Sie das Dorf vor den Kreuzfahrt-Touristen - magisch und friedlich."},
      {name: "Nebensaison-Besuch", description: "April-Mai und September-Oktober bieten perfektes Wetter ohne Überfüllung."},
      {name: "Mit Einheimischen reden", description: "Lernen Sie ein paar italienische Worte - die Einheimischen schätzen es sehr."}
    ]
  }),
  maps: (village) => ({
    title: `Karten von ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Karten von ${village.charAt(0).toUpperCase() + village.slice(1)} - Orientierung & Navigation`,
      description: `Detaillierte Karten von ${village.charAt(0).toUpperCase() + village.slice(1)}. Wanderwege, Sehenswürdigkeiten, Restaurants und Hotels auf einen Blick.`,
      keywords: `${village} karte, ${village} map, ${village} stadtplan, ${village} wanderkarte`
    },
    hero: {
      title: `Karten von ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Orientierung im Dorf, Wanderwege und Points of Interest"
    },
    features: [
      {name: "Dorfplan", description: "Detaillierte Karte aller Gassen, Treppen und Plätze im historischen Zentrum."},
      {name: "Wanderwege", description: "Alle Küstenpfade und Höhenwege mit Schwierigkeitsgraden und Zeitangaben."},
      {name: "Sehenswürdigkeiten", description: "Kirchen, Aussichtspunkte, historische Gebäude und Fotospots markiert."},
      {name: "Restaurants & Cafés", description: "Beste Restaurants, Bars und Gelaterias im Dorf."},
      {name: "Praktische Orte", description: "Bahnhof, Bushaltestellen, Parkplätze, Toiletten und Geldautomaten."},
      {name: "Offline-Karten", description: "Laden Sie Karten herunter - mobiles Internet kann in den Gassen schwach sein."}
    ]
  }),
  restaurants: (village) => ({
    title: `Restaurants in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Restaurants in ${village.charAt(0).toUpperCase() + village.slice(1)} - Beste Trattorien`,
      description: `Die besten Restaurants in ${village.charAt(0).toUpperCase() + village.slice(1)}. Authentische ligurische Küche, frischer Fisch und lokale Weine mit Meerblick.`,
      keywords: `${village} restaurants, ${village} essen, ${village} trattorien, ${village} dining`
    },
    hero: {
      title: `Restaurants in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Authentische ligurische Küche mit frischem Fisch und lokalem Wein"
    },
    features: [
      {name: "Meeresfrüchte", description: "Frisch gefangener Fisch, Anchovis, Tintenfisch und ligurische Fischsuppe."},
      {name: "Pesto & Pasta", description: "Hausgemachtes Pesto alla Genovese mit Trofie - das Signature-Gericht Liguriens."},
      {name: "Lokale Weine", description: "Cinque Terre DOC Weißwein und süßer Sciacchetrà - probieren Sie sie hier!"},
      {name: "Meerblick-Terrassen", description: "Romantisches Dinner mit spektakulärem Ausblick auf das Meer und die Küste."},
      {name: "Focaccia & Street Food", description: "Probieren Sie frische Focaccia, Farinata und frittierte Meeresfrüchte zum Mitnehmen."},
      {name: "Reservierung empfohlen", description: "Die besten Restaurants sind oft ausgebucht - reservieren Sie im Voraus."}
    ]
  }),
  sights: (village) => ({
    title: `Sehenswürdigkeiten in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Sehenswürdigkeiten in ${village.charAt(0).toUpperCase() + village.slice(1)} - Top Attraktionen`,
      description: `Die wichtigsten Sehenswürdigkeiten in ${village.charAt(0).toUpperCase() + village.slice(1)}. Kirchen, Aussichtspunkte, historische Bauten und versteckte Schätze.`,
      keywords: `${village} sehenswürdigkeiten, ${village} attraktionen, ${village} sights, ${village} highlights`
    },
    hero: {
      title: `Sehenswürdigkeiten in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Entdecken Sie historische Kirchen, Aussichtspunkte und architektonische Highlights"
    },
    features: [
      {name: "Historische Kirchen", description: "Mittelalterliche Kirchen mit wertvollen Kunstwerken und beeindruckender Architektur."},
      {name: "Panorama-Aussichtspunkte", description: "Spektakuläre Ausblicke auf die Küste, das Meer und die Nachbardörfer."},
      {name: "Fotogene Gassen", description: "Malerische enge Gassen, bunte Häuser und charmante Plätze."},
      {name: "Hafen & Marina", description: "Der historische Hafen mit bunten Fischerbooten - ein Muss für Fotografen."},
      {name: "Wehrtürme", description: "Mittelalterliche Verteidigungstürme mit Geschichte und großartigen Ausblicken."},
      {name: "Lokale Märkte", description: "Wochenmärkte mit frischen Produkten, Handwerk und lokalem Leben."}
    ]
  }),
  'things-to-do': (village) => ({
    title: `Aktivitäten in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Aktivitäten in ${village.charAt(0).toUpperCase() + village.slice(1)} - Was unternehmen`,
      description: `Die besten Aktivitäten in ${village.charAt(0).toUpperCase() + village.slice(1)}. Wandern, Bootfahren, Tauchen, Weinverkostung und kulinarische Erlebnisse.`,
      keywords: `${village} aktivitäten, ${village} dinge tun, ${village} activities, ${village} erlebnisse`
    },
    hero: {
      title: `Aktivitäten in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Von Wanderungen über Weinverkostungen bis zu Bootstouren"
    },
    features: [
      {name: "Wandern", description: "Erkunden Sie die berühmten Küstenwege und ruhigere Pfade durch Weinberge."},
      {name: "Bootstouren", description: "Segeln Sie entlang der Küste, entdecken Sie versteckte Buchten und genießen Sie Sonnenuntergänge."},
      {name: "Schnorcheln & Tauchen", description: "Kristallklares Wasser und geschützte Meereszone mit reicher Unterwasserwelt."},
      {name: "Weinverkostung", description: "Probieren Sie lokale Weine direkt bei den Produzenten in den Weinbergen."},
      {name: "Kochkurse", description: "Lernen Sie Pesto, Focaccia und ligurische Spezialitäten bei lokalen Köchen."},
      {name: "Fotografie-Touren", description: "Geführte Touren zu den besten Fotospots bei goldenem Licht."}
    ]
  }),
  weather: (village) => ({
    title: `Wetter in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
    seo: {
      title: `Wetter in ${village.charAt(0).toUpperCase() + village.slice(1)} - Klima & beste Reisezeit`,
      description: `Aktuelles Wetter und Klima in ${village.charAt(0).toUpperCase() + village.slice(1)}. Beste Reisezeit, Temperaturen und was Sie einpacken sollten.`,
      keywords: `${village} wetter, ${village} klima, ${village} beste reisezeit, ${village} weather`
    },
    hero: {
      title: `Wetter in ${village.charAt(0).toUpperCase() + village.slice(1)}`,
      subtitle: "Klima, beste Reisezeit und Packliste für Ihren Besuch"
    },
    features: [
      {name: "Mediteranes Klima", description: "Milde Winter, warme Sommer - ideales Klima für fast ganzjährige Besuche."},
      {name: "Beste Reisezeit", description: "April-Mai und September-Oktober: Perfektes Wetter ohne Hochsaison-Menschenmassen."},
      {name: "Sommer (Juni-August)", description: "Heiß und überfüllt - buchen Sie früh und starten Sie Wanderungen morgens früh."},
      {name: "Winter (November-März)", description: "Ruhig und mild, aber einige Restaurants geschlossen - ideal für authentische Erlebnisse."},
      {name: "Was einpacken", description: "Leichte Kleidung, Sonnenschutz, gute Wanderschuhe und Badekleidung im Sommer."},
      {name: "Regen & Unwetter", description: "November ist der regenreichste Monat - prüfen Sie Wettervorhersagen vor Wanderungen."}
    ]
  })
};

// Function to populate a single file
function populateFile(filePath) {
  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // Extract village and page type
    const pathParts = filePath.split('/');
    const village = pathParts[pathParts.length - 2];
    const filename = pathParts[pathParts.length - 1].replace('.json', '');
    const pageType = content.page_type;

    // Skip if already populated
    if (content.body && content.body.length > 0) {
      console.log(`Skipping ${village}/${filename} - already populated`);
      return;
    }

    // Get template
    const template = pageTemplates[pageType];
    if (!template) {
      console.log(`No template for ${pageType} - skipping ${village}/${filename}`);
      return;
    }

    const data = template(village);

    // Update content
    content.title = data.title;
    content.seo = data.seo;
    content.body = [
      {
        type: "hero-section",
        variant: "simple-centered",
        title: data.hero.title,
        subtitle: data.hero.subtitle
      },
      {
        type: "feature-section",
        variant: "simple-3x2-grid",
        heading: data.features.length > 0 ? `Was Sie wissen sollten` : "Überblick",
        description: `Alle wichtigen Informationen für Ihren Besuch in ${village.charAt(0).toUpperCase() + village.slice(1)}.`,
        features: data.features
      },
      {
        type: "cta-section",
        heading: "Entdecken Sie mehr",
        description: `Planen Sie Ihren perfekten Aufenthalt in ${village.charAt(0).toUpperCase() + village.slice(1)}.`,
        buttons: [
          {
            text: "Überblick",
            href: `/de/${village}/overview`
          },
          {
            text: "Hotels",
            href: `/de/${village}/hotels`
          }
        ]
      }
    ];
    content.status = "published";
    content.updated_at = "2025-12-12T22:00:00.000Z";

    // Write back
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    console.log(`✓ Updated ${village}/${filename}`);
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
}

// Main execution
const baseDir = '/Users/drietsch/agentpress/cinqueterre.travel/content/pages/de';
const villages = ['monterosso', 'vernazza', 'corniglia', 'manarola', 'riomaggiore'];

villages.forEach(village => {
  const villageDir = path.join(baseDir, village);
  const files = fs.readdirSync(villageDir).filter(f => f.endsWith('.json'));

  console.log(`\n=== Processing ${village.toUpperCase()} (${files.length} files) ===`);
  files.forEach(file => {
    populateFile(path.join(villageDir, file));
  });
});

console.log('\n=== Done! ===');
