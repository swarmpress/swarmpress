import React from 'react';
import { Mountain, Ship, Umbrella, Camera, Sunset, Map, Calendar, Users } from 'lucide-react';

const highlights = [
    { name: "Coastal Hikes", icon: Mountain, desc: "Walk the famous Blue Trail." },
    { name: "Boat Tours", icon: Ship, desc: "See the villages from the sea." },
    { name: "Beaches", icon: Umbrella, desc: "Relax on Monterosso's sands." },
    { name: "Photo Spots", icon: Camera, desc: "Capture the perfect shot." },
    { name: "Sunset Aperitivo", icon: Sunset, desc: "Drinks with a view." },
    { name: "Day Trip: Portovenere", icon: Map, desc: "The 'sixth village' nearby." },
    { name: "Local Festivals", icon: Calendar, desc: "Experience local culture." },
    { name: "Crowd Avoidance", icon: Users, desc: "Tips for a quieter trip." },
];

export default function Highlights() {
    return (
        <section className="py-16 container mx-auto px-4">
            <div className="text-center mb-12">
                <span className="text-sm font-semibold text-primary uppercase tracking-wider">Experiences</span>
                <h2 className="font-serif text-3xl md:text-4xl font-bold mt-2">Cinque Terre Highlights</h2>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
                {highlights.map((item, index) => (
                    <div key={index} className="flex flex-col items-center text-center p-6 rounded-xl bg-secondary/20 hover:bg-secondary/40 transition-colors cursor-pointer group">
                        <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center mb-4 shadow-sm group-hover:scale-110 transition-transform duration-300">
                            <item.icon className="w-6 h-6 text-primary" />
                        </div>
                        <h3 className="font-serif text-lg font-bold mb-2">{item.name}</h3>
                        <p className="text-sm text-muted-foreground">{item.desc}</p>
                    </div>
                ))}
            </div>
        </section>
    );
}
