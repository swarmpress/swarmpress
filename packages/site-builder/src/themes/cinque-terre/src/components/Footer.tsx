import React from 'react';
import { Facebook, Instagram, Twitter } from 'lucide-react';

const links = {
    Explore: ["Destinations", "Itineraries", "Beaches", "Hiking", "Photography"],
    Villages: ["Monterosso", "Vernazza", "Corniglia", "Manarola", "Riomaggiore"],
    Guides: ["Food & Drink", "Places to Stay", "Getting Around", "Best Time to Visit"],
    About: ["Our Story", "Contact", "Work with Us", "Press"]
};

export default function Footer() {
    return (
        <footer className="bg-secondary/30 pt-16 pb-8 border-t border-border">
            <div className="container mx-auto px-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">
                    <div className="col-span-2 lg:col-span-1">
                        <a href="/" className="font-serif text-2xl font-bold tracking-tight block mb-4">
                            Cinque Terre Dispatch
                        </a>
                        <p className="text-sm text-muted-foreground mb-6">
                            The premium guide to Italy's most colorful coastline.
                        </p>
                        <div className="flex gap-4">
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors"><Instagram className="w-5 h-5" /></a>
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors"><Facebook className="w-5 h-5" /></a>
                            <a href="#" className="text-muted-foreground hover:text-primary transition-colors"><Twitter className="w-5 h-5" /></a>
                        </div>
                    </div>

                    {Object.entries(links).map(([title, items]) => (
                        <div key={title}>
                            <h3 className="font-bold mb-4">{title}</h3>
                            <ul className="space-y-2">
                                {items.map(item => (
                                    <li key={item}>
                                        <a href="#" className="text-sm text-muted-foreground hover:text-primary transition-colors">{item}</a>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className="border-t border-border pt-8 flex flex-col md:flex-row justify-between items-center gap-4 text-sm text-muted-foreground">
                    <p>&copy; {new Date().getFullYear()} Cinque Terre Dispatch. All rights reserved.</p>
                    <div className="flex gap-6">
                        <a href="#" className="hover:text-primary transition-colors">Privacy Policy</a>
                        <a href="#" className="hover:text-primary transition-colors">Terms of Service</a>
                        <a href="#" className="hover:text-primary transition-colors">Cookie Policy</a>
                    </div>
                </div>
            </div>
        </footer>
    );
}
