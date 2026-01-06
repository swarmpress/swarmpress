import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from './ui/sheet';
import { Menu, Search, ChevronDown, MapPin, Utensils, Newspaper, Compass } from 'lucide-react';

// Helper to get current language from URL
const getCurrentLang = () => {
    if (typeof window === 'undefined') return 'en';
    const path = window.location.pathname;
    const match = path.match(/^\/(en|de|fr|it)\//);
    return match ? match[1] : 'en';
};

// Helper to prefix URLs with language
const l = (href: string, lang: string) => {
    if (href === '#' || href.startsWith('http')) return href;
    return `/${lang}${href}`;
};

const getDestinations = (lang: string) => [
    { name: 'The Salt & Stone Path', href: l('/itinerary', lang), description: 'A curated 4-day journey through the coast' },
    { name: 'The Art of Presence', href: l('/things-to-do', lang), description: 'Ways of engaging with the village rhythm' },
    { name: 'Where to Wake Up', href: l('/accommodations', lang), description: 'Curated accommodations in Riomaggiore' },
    { name: 'Riomaggiore', href: l('/village', lang), description: 'The easternmost village with colorful cliffside houses' },
    { name: 'Manarola', href: '#', description: 'Famous for its wine and stunning harbor views' },
    { name: 'Corniglia', href: '#', description: 'The only village not directly on the sea' },
    { name: 'Vernazza', href: '#', description: 'One of Italy\'s most beautiful villages' },
    { name: 'Monterosso', href: '#', description: 'The largest village with sandy beaches' },
];

const getFoodDrink = (lang: string) => [
    { name: 'The Culinary Story', href: l('/culinary', lang), description: 'Riomaggiore\'s relationship with food and place' },
    { name: 'Village Rhythms', href: l('/events', lang), description: 'Traditional events and seasonal celebrations' },
    { name: 'Restaurants', href: l('/culinary', lang), description: 'A curated collection of local dining' },
    { name: 'Wine Bars', href: '#', description: 'Local wines and aperitivo culture' },
    { name: 'Cafés & Bakeries', href: '#', description: 'Morning coffee and fresh focaccia' },
];

const getNewsAdvice = (lang: string) => [
    { name: 'Arrival & Orientation', href: l('/transportation', lang), description: 'How to reach the village with calm and clarity' },
    { name: 'The Dispatch (Blog)', href: l('/blog', lang), description: 'Stories and insights from the coast' },
    { name: 'The Team', href: l('/team', lang), description: 'Meet the voices behind the perspective' },
    { name: 'Travel Tips', href: l('/blog', lang), description: 'Essential advice for your visit' },
    { name: 'Latest News', href: l('/blog', lang), description: 'Updates from the Cinque Terre' },
    { name: 'Weather & Conditions', href: l('/weather', lang), description: 'Live atmosphere and forecasts' },
];

const getNavItems = (lang: string) => [
    { name: 'Destinations', href: l('/village', lang), flyout: getDestinations(lang), icon: MapPin },
    { name: 'Itinerary', href: l('/itinerary', lang), icon: Compass },
    { name: 'Sights', href: l('/sights', lang), icon: MapPin },
    { name: 'Food & Drink', href: '#', flyout: getFoodDrink(lang), icon: Utensils },
    { name: 'News & Advice', href: l('/blog', lang), flyout: getNewsAdvice(lang), icon: Newspaper },
];

export default function Header() {
    const [isScrolled, setIsScrolled] = useState(false);
    const [lang, setLang] = useState('en');

    useEffect(() => {
        setLang(getCurrentLang());

        const handleScroll = () => {
            setIsScrolled(window.scrollY > 10);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    const navItems = getNavItems(lang);

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
                    <a href={l('/', lang)} className="-m-1.5 p-1.5">
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
