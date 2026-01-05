import React from 'react';
import { CloudSun, Sun, CloudRain } from 'lucide-react';

export default function WeatherWidget() {
    return (
        <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-8 md:bottom-8 bg-white/10 backdrop-blur-md border border-white/20 rounded-xl p-4 shadow-lg text-white max-w-[200px] w-full hidden md:block">
            <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                    <CloudSun className="h-6 w-6" />
                    <span className="text-lg font-semibold">18°C</span>
                </div>
                <span className="text-xs opacity-80">Monterosso</span>
            </div>
            <div className="flex justify-between text-sm opacity-90 border-t border-white/10 pt-2">
                <div className="flex flex-col items-center">
                    <span className="text-[10px] mb-1">Today</span>
                    <Sun className="h-3 w-3 mb-1" />
                    <span className="text-xs">19°</span>
                </div>
                <div className="flex flex-col items-center">
                    <span className="text-[10px] mb-1">Sat</span>
                    <CloudSun className="h-3 w-3 mb-1" />
                    <span className="text-xs">18°</span>
                </div>
                <div className="flex flex-col items-center">
                    <span className="text-[10px] mb-1">Sun</span>
                    <CloudRain className="h-3 w-3 mb-1" />
                    <span className="text-xs">16°</span>
                </div>
            </div>
        </div>
    );
}
