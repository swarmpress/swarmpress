# Cinque Terre Travel Portal -- Final Website Structure (with Data Sources)

## Languages

Each section exists in: `/en/`, `/de/`, `/fr/`, `/it/`

All content lives under a city folder: `/$lang/$city/$page`

Cities: - cinque-terre (meta-city) - monterosso - vernazza - corniglia -
manarola - riomaggiore

## 1. Meta-City: Cinque Terre (Global)

    /$lang/cinque-terre/
        overview/
        about/
        history/
        culture/
        transport/
            train/
            ferry/
            car/
            parking/
            passes/
        weather/
            forecast/
            monthly/
        blog/
            <post>/
        events/
            calendar/
        itineraries/
            1-day/
            2-days/
            3-days/
            romantic/
            family/
        insights/
        maps/
        faq/

### Data Sources Used in Cinque Terre

-   History, culture: Wikidata / Wikipedia API
-   Weather: OpenWeather OneCall API
-   Transport (train): Trenitalia / GTFS
-   Transport (ferry): Traghetti Lines API
-   Blog images: Pexels & Unsplash

## 2. City Structure (All Villages)

Example for Vernazza (same for all):

    /$lang/vernazza/
        overview/
        sights/
            <poi>/
        restaurants/
            <restaurant>/
        hotels/
            <hotel>/
        apartments/
        agriturismi/
        camping/
        hiking/
            <trail>/
        beaches/
            <beach>/
        boat-tours/
            <tour>/
        events/
            <event>/
        things-to-do/
        insights/
        maps/
        blog/
        faq/

### Data Sources Used in City Sections

-   POIs, restaurants, hotels: Google Places API
-   Trails: OpenStreetMap / Overpass API
-   Elevation: OpenElevation / Mapbox Terrain
-   Events: Eventbrite API
-   Images: Pexels / Unsplash
-   Weather: OpenWeather OneCall
-   Transport: Train + Ferry APIs

## 3. Global & City Blogs

Global Blog:

    /$lang/cinque-terre/blog/
    /$lang/cinque-terre/blog/<post>/

City-Specific Blog (filtered):

    /$lang/<city>/blog/

## 4. Folder Structure Summary

    /$lang/
        cinque-terre/
            overview/
            about/
            history/
            culture/
            transport/
            weather/
            blog/
            events/
            itineraries/
            insights/
            maps/
            faq/

        monterosso/
        vernazza/
        corniglia/
        manarola/
        riomaggiore/
            (same structure)

## 5. Data Source Integration Overview

-   Google Places → POIs, restaurants, hotels
-   Overpass → trails, paths
-   OpenElevation / Mapbox Terrain → elevation profiles
-   OpenWeather → weather blocks and climate data
-   Wikidata/Wikipedia → history & culture
-   Eventbrite → events
-   Train/Ferry APIs → mobility insights
-   Pexels/Unsplash → images & videos
