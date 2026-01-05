import React from 'react';
import { Train, Map, Users, Briefcase, CloudSun } from 'lucide-react';

const advice = [
    { name: "Getting There", icon: Train, desc: "Trains are your best friend." },
    { name: "Getting Around", icon: Map, desc: "Cinque Terre Card explained." },
    { name: "Crowd Strategy", icon: Users, desc: "Avoid peak hours." },
    { name: "What to Pack", icon: Briefcase, desc: "Leave the heels at home." },
    { name: "Weather & Safety", icon: CloudSun, desc: "Check trail status." },
];

export default function PracticalAdvice() {
    return (
        <section className="py-12 bg-primary/5 border-y border-primary/10">
            <div className="container mx-auto px-4">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {advice.map((item, index) => (
                        <div key={index} className="flex flex-col items-center text-center p-4 rounded-lg hover:bg-background transition-colors cursor-pointer group">
                            <item.icon className="w-8 h-8 text-primary mb-3 group-hover:scale-110 transition-transform" />
                            <h3 className="font-bold text-sm mb-1">{item.name}</h3>
                            <p className="text-xs text-muted-foreground">{item.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
