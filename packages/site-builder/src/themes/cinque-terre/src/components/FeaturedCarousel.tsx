import React from 'react';
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    CarouselNext,
    CarouselPrevious,
} from './ui/carousel';
import { Badge } from './ui/badge';

// Mock data
const featuredStories = [
    {
        id: 1,
        title: "The Perfect First-Timer Itinerary",
        category: "Itinerary",
        dek: "How to see the best of the five villages in just 3 days.",
        image: "https://images.unsplash.com/photo-1498503182468-3b51cbb6cb24?q=80&w=2670&auto=format&fit=crop",
        author: "Giulia Rossi"
    },
    {
        id: 2,
        title: "Best Time to Visit (and When to Skip)",
        category: "Planning",
        dek: "Avoid the crowds and find the perfect weather.",
        image: "https://images.unsplash.com/photo-1555979863-69fb96e63359?q=80&w=2670&auto=format&fit=crop",
        author: "Marco Bianchi"
    },
    {
        id: 3,
        title: "How to Hike the Sentiero Azzurro",
        category: "Hiking",
        dek: "Everything you need to know about the Blue Trail.",
        image: "https://images.unsplash.com/photo-1596394516093-501ba68a0ba6?q=80&w=2670&auto=format&fit=crop",
        author: "Luca Verdi"
    },
    {
        id: 4,
        title: "Most Scenic Viewpoints",
        category: "Photography",
        dek: "Where to capture the iconic postcard shots.",
        image: "https://images.unsplash.com/photo-1592345279419-959d784e8aad?q=80&w=2670&auto=format&fit=crop",
        author: "Elena Moretti"
    },
    {
        id: 5,
        title: "Beaches Worth the Detour",
        category: "Beaches",
        dek: "Secret coves and sandy spots away from the main towns.",
        image: "https://images.unsplash.com/photo-1534445867742-43195f401b6c?q=80&w=2670&auto=format&fit=crop",
        author: "Sofia Neri"
    },
    {
        id: 6,
        title: "Local Train & Ferry Cheatsheet",
        category: "Transport",
        dek: "Master the logistics of moving between villages.",
        image: "https://images.unsplash.com/photo-1516483638261-f4dbaf036963?q=80&w=2574&auto=format&fit=crop",
        author: "Giulia Rossi"
    },
    {
        id: 7,
        title: "A Food Lover’s Weekend",
        category: "Food & Drink",
        dek: "From pesto to seafood, here's what to eat.",
        image: "https://images.unsplash.com/photo-1551183053-bf91a1d81141?q=80&w=2632&auto=format&fit=crop",
        author: "Marco Bianchi"
    },
    {
        id: 8,
        title: "Rainy-Day Plans",
        category: "Activities",
        dek: "What to do when the weather doesn't cooperate.",
        image: "https://images.unsplash.com/photo-1515444744559-7be63e1600de?q=80&w=2670&auto=format&fit=crop",
        author: "Elena Moretti"
    }
];

export default function FeaturedCarousel() {
    return (
        <section className="py-16 bg-secondary/30">
            <div className="container mx-auto px-4">
                <div className="flex items-center justify-between mb-8">
                    <h2 className="font-serif text-3xl md:text-4xl font-bold">Editors' Picks</h2>
                    <a href="#" className="text-sm font-medium hover:underline">View all</a>
                </div>

                <Carousel
                    opts={{
                        align: "start",
                        loop: true,
                    }}
                    className="w-full"
                >
                    <CarouselContent className="-ml-4">
                        {featuredStories.map((story) => (
                            <CarouselItem key={story.id} className="pl-4 md:basis-1/2 lg:basis-1/3 xl:basis-1/4">
                                <div className="group cursor-pointer">
                                    <div className="relative aspect-[4/3] overflow-hidden rounded-xl mb-4">
                                        <img
                                            src={story.image}
                                            alt={story.title}
                                            className="object-cover w-full h-full transition-transform duration-500 group-hover:scale-105"
                                        />
                                        <Badge className="absolute top-3 left-3 bg-white/90 text-black hover:bg-white border-none shadow-sm">
                                            {story.category}
                                        </Badge>
                                    </div>
                                    <h3 className="font-serif text-xl font-bold mb-2 group-hover:text-primary transition-colors leading-tight">
                                        {story.title}
                                    </h3>
                                    <p className="text-muted-foreground text-sm line-clamp-2 mb-3">
                                        {story.dek}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <div className="w-6 h-6 rounded-full bg-secondary overflow-hidden">
                                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${story.author}`} alt={story.author} />
                                        </div>
                                        <span className="text-xs font-medium text-muted-foreground">{story.author}</span>
                                    </div>
                                </div>
                            </CarouselItem>
                        ))}
                    </CarouselContent>
                    <div className="hidden md:block">
                        <CarouselPrevious className="-left-4" />
                        <CarouselNext className="-right-4" />
                    </div>
                </Carousel>
            </div>
        </section>
    );
}
