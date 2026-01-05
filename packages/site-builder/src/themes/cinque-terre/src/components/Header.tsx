import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from './ui/sheet';
import { Menu, Search, ChevronDown, MapPin, Utensils, Newspaper, Compass } from 'lucide-react';

const destinations = [
    { name: 'The Salt & Stone Path', href: '/itinerary', description: 'A curated 4-day journey through the coast' },
    { name: 'The Art of Presence', href: '/things-to-do', description: 'Ways of engaging with the village rhythm' },
    { name: 'Where to Wake Up', href: '/accommodations', description: 'Curated accommodations in Riomaggiore' },
    { name: 'Riomaggiore', href: '/village', description: 'The easternmost village with colorful cliffside houses' },
    { name: 'Manarola', href: '#', description: 'Famous for its wine and stunning harbor views' },
    { name: 'Corniglia', href: '#', description: 'The only village not directly on the sea' },
    { name: 'Vernazza', href: '#', description: 'One of Italy\'s most beautiful villages' },
    { name: 'Monterosso', href: '#', description: 'The largest village with sandy beaches' },
];

const foodDrink = [
    { name: 'The Culinary Story', href: '/culinary', description: 'Riomaggiore\'s relationship with food and place' },
    { name: 'Village Rhythms', href: '/events', description: 'Traditional events and seasonal celebrations' },
    { name: 'Restaurants', href: '/culinary', description: 'A curated collection of local dining' },
    { name: 'Wine Bars', href: '#', description: 'Local wines and aperitivo culture' },
    { name: 'Cafés & Bakeries', href: '#', description: 'Morning coffee and fresh focaccia' },
];

const newsAdvice = [
    { name: 'Arrival & Orientation', href: '/transportation', description: 'How to reach the village with calm and clarity' },
    { name: 'The Dispatch (Blog)', href: '/blog', description: 'Stories and insights from the coast' },
    { name: 'The Team', href: '/team', description: 'Meet the voices behind the perspective' },
    { name: 'Travel Tips', href: '/blog', description: 'Essential advice for your visit' },
    { name: 'Latest News', href: '/blog', description: 'Updates from the Cinque Terre' },
    { name: 'Weather & Conditions', href: '/weather', description: 'Live atmosphere and forecasts' },
];

const navItems = [
    { name: 'Destinations', href: '/village', flyout: destinations, icon: MapPin },
    { name: 'Itinerary', href: '/itinerary', icon: Compass },
    { name: 'Sights', href: '/sights', icon: MapPin },
    { name: 'Food & Drink', href: '#', flyout: foodDrink, icon: Utensils },
    { name: 'News & Advice', href: '/blog', flyout: newsAdvice, icon: Newspaper },
];

export default function Header() {
    const [isScrolled, setIsScrolled] = useState(false);

    useEffect(() => {
        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    return (
        <header
            className={`sticky top-0 z-50 w-full transition-all duration-300 border-b border-transparent ${isScrolled ? 'bg-background/80 backdrop-blur-md border-border/40 shadow-sm' : 'bg-background/0'
                }`}
        >
            <div className="container mx-auto px-4 lg:px-8">
                <nav className="flex items-center justify-between py-6">
                    {/* Left: Desktop Navigation */}
                    <div className="flex flex-1">
                        <div className="hidden lg:flex lg:gap-x-8">
                            {navItems.map((item) => (
                                <div key={item.name} className="relative">
                                    <button
                                        popoverTarget={`menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                                        className="inline-flex items-center gap-x-1 text-sm font-semibold text-foreground hover:text-primary transition-colors"
                                    >
                                        <span>{item.name}</span>
                                        <ChevronDown className="h-4 w-4" />
                                    </button>

                                    <el-popover
                                        id={`menu-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                                        anchor="bottom"
                                        popover="auto"
                                        className="w-screen max-w-max overflow-visible bg-transparent px-4 transition transition-discrete [--anchor-gap:theme(spacing.5)] backdrop:bg-transparent open:flex data-[state=closed]:translate-y-1 data-[state=closed]:opacity-0 data-[state=open]:duration-200 data-[state=open]:ease-out data-[state=closed]:duration-150 data-[state=closed]:ease-in"
                                    >
                                        <div className="w-screen max-w-md flex-auto overflow-hidden rounded-2xl bg-card border border-border text-sm shadow-lg">
                                            <div className="grid grid-cols-1 gap-1 p-4">
                                                {item.flyout?.map((subItem) => (
                                                    <div
                                                        key={subItem.name}
                                                        className="group relative flex gap-x-4 rounded-lg p-4 hover:bg-muted/50 transition-colors"
                                                    >
                                                        <div className="mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-muted group-hover:bg-background">
                                                            {item.icon && <item.icon className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />}
                                                        </div>
                                                        <div>
                                                            <a href={subItem.href} className="font-semibold text-foreground hover:text-primary">
                                                                {subItem.name}
                                                                <span className="absolute inset-0"></span>
                                                            </a>
                                                            <p className="mt-1 text-muted-foreground">{subItem.description}</p>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </el-popover>
                                </div>
                            ))}
                        </div>
                        {/* Mobile Menu Button */}
                        <div className="flex lg:hidden">
                            <Sheet>
                                <SheetTrigger asChild>
                                    <button
                                        type="button"
                                        className="-m-2.5 inline-flex items-center justify-center rounded-md p-2.5 text-muted-foreground hover:text-foreground"
                                    >
                                        <span className="sr-only">Open main menu</span>
                                        <Menu className="h-6 w-6" />
                                    </button>
                                </SheetTrigger>
                                <SheetContent side="left">
                                    <SheetTitle className="font-serif text-xl text-left">Menu</SheetTitle>
                                    <nav className="flex flex-col gap-4 mt-8">
                                        {navItems.map((item) => (
                                            <div key={item.name} className="space-y-2">
                                                <div className="font-semibold text-foreground">{item.name}</div>
                                                {item.flyout?.map((subItem) => (
                                                    <a
                                                        key={subItem.name}
                                                        href={subItem.href}
                                                        className="block pl-4 text-sm text-muted-foreground hover:text-primary transition-colors"
                                                    >
                                                        {subItem.name}
                                                    </a>
                                                ))}
                                            </div>
                                        ))}
                                        <div className="h-px bg-border my-4" />
                                        <Button className="w-full justify-start" variant="ghost">
                                            <Search className="mr-2 h-4 w-4" /> Search
                                        </Button>
                                        <Button className="w-full rounded-full">Subscribe</Button>
                                    </nav>
                                </SheetContent>
                            </Sheet>
                        </div>
                    </div>

                    {/* Center: Logo */}
                    <a href="/" className="-m-1.5 p-1.5">
                        <span className="sr-only">Cinque Terre Dispatch</span>
                        <span className="font-serif text-2xl font-bold tracking-tight">
                            Cinque Terre Dispatch
                        </span>
                    </a>

                    {/* Right: Actions */}
                    <div className="flex flex-1 justify-end items-center gap-2">
                        <Button variant="ghost" size="icon" className="hidden sm:flex">
                            <Search className="h-5 w-5" />
                            <span className="sr-only">Search</span>
                        </Button>
                        <Button variant="default" size="sm" className="hidden sm:flex rounded-full px-6">
                            Subscribe
                        </Button>
                    </div>
                </nav>
            </div>
        </header>
    );
}
