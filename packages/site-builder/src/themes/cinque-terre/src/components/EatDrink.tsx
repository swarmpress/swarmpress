import React from 'react';
import { MapPin } from 'lucide-react';
import { Badge } from './ui/badge';

const eats = [
    {
        name: "Nessun Dorma",
        type: "Aperitivo",
        village: "Manarola",
        blurb: "The most famous view in Cinque Terre. Bruschetta & wine.",
        image: "https://images.unsplash.com/photo-1515444744559-7be63e1600de?q=80&w=2670&auto=format&fit=crop"
    },
    {
        name: "Ristorante Miky",
        type: "Seafood",
        village: "Monterosso",
        blurb: "Upscale dining famous for its anchovies and pasta.",
        image: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=2632&auto=format&fit=crop"
    },
    {
        name: "Belforte",
        type: "Seafood",
        village: "Vernazza",
        blurb: "Dining inside a medieval tower overlooking the sea.",
        image: "https://images.unsplash.com/photo-1590490360182-c33d57733427?q=80&w=2574&auto=format&fit=crop"
    },
    {
        name: "A Pie' de Ma'",
        type: "Wine Bar",
        village: "Riomaggiore",
        blurb: "Cliffside terrace perfect for sunset drinks.",
        image: "https://images.unsplash.com/photo-1534445867742-43195f401b6c?q=80&w=2670&auto=format&fit=crop"
    },
    {
        name: "Gelateria Vernazza",
        type: "Gelato",
        village: "Vernazza",
        blurb: "Artisanal gelato using local lemons and honey.",
        image: "https://images.unsplash.com/photo-1498503182468-3b51cbb6cb24?q=80&w=2670&auto=format&fit=crop"
    },
    {
        name: "Il Pirata",
        type: "Breakfast",
        village: "Vernazza",
        blurb: "Famous for their Sicilian cannoli and pastries.",
        image: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?q=80&w=2670&auto=format&fit=crop"
    }
];

export default function EatDrink() {
    return (
        <section className="py-16 bg-secondary/30">
            <div className="container mx-auto px-4">
                <div className="flex items-end justify-between mb-12">
                    <div>
                        <span className="text-sm font-semibold text-primary uppercase tracking-wider">Food & Drink</span>
                        <h2 className="font-serif text-3xl md:text-4xl font-bold mt-2">Editors' Picks</h2>
                    </div>
                    <a href="#" className="hidden md:inline-flex items-center text-sm font-medium hover:text-primary transition-colors">
                        See all restaurants <span className="ml-1">→</span>
                    </a>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {eats.map((place, index) => (
                        <div key={index} className="flex gap-4 group cursor-pointer bg-background p-4 rounded-xl border border-border/50 hover:border-border transition-colors shadow-sm hover:shadow-md">
                            <div className="relative w-24 h-24 flex-shrink-0 overflow-hidden rounded-lg">
                                <img src={place.image} alt={place.name} className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105" />
                            </div>
                            <div className="flex flex-col justify-center">
                                <div className="flex items-center gap-2 mb-1">
                                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-5 font-medium">{place.type}</Badge>
                                    <div className="flex items-center text-xs text-muted-foreground">
                                        <MapPin className="w-3 h-3 mr-0.5" />
                                        {place.village}
                                    </div>
                                </div>
                                <h3 className="font-serif text-lg font-bold mb-1 group-hover:text-primary transition-colors leading-tight">
                                    {place.name}
                                </h3>
                                <p className="text-xs text-muted-foreground line-clamp-2">
                                    {place.blurb}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>

                <div className="mt-8 text-center md:hidden">
                    <a href="#" className="inline-flex items-center text-sm font-medium hover:text-primary transition-colors">
                        See all restaurants <span className="ml-1">→</span>
                    </a>
                </div>
            </div>
        </section>
    );
}
