/**
 * Ligurian ferries (a context provider, ADR-0043).
 *
 * Reads the ferry operator's timetable page, finds cancelled departures for
 * the Cinque Terre villages, and returns:
 * - a `transport` fact (short, sourced, expiring at the end of the service day);
 * - a happening candidate for the Day Director: update the getting-there guide.
 *
 * The page is parsed with plain string matching: the sandbox has no DOM.
 * The cursor is the page's "updated" stamp, so an unchanged page yields nothing new.
 */
import { defineContextProvider, type Fact, type HappeningCandidate } from "@simpress/sdk/runtime";

const ORIGIN = "https://www.navigazionegolfodeipoeti.it";
const PAGE = ORIGIN + "/en/timetable/cinque-terre";

interface Departure {
  time: string;
  from: string;
  to: string;
  status: string;
}

const strip = (html: string) => html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

export function parseTimetable(html: string): { date: string; updated: string; notice: string; departures: Departure[] } {
  const meta = (name: string) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1] ?? "";
  const notice = strip(/<div class="notice">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "");
  const departures: Departure[] = [];
  const rows = html.match(/<tr class="departure">[\s\S]*?<\/tr>/g) ?? [];
  for (const row of rows) {
    const cells = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? []).map(strip);
    if (cells.length >= 4) departures.push({ time: cells[0], from: cells[1], to: cells[2], status: cells[3].toLowerCase() });
  }
  return { date: meta("service-date"), updated: meta("updated"), notice, departures };
}

export default defineContextProvider({
  async poll({ region, cursor }) {
    const res = await fetch(PAGE);
    if (!res.ok) throw new Error(`timetable page returned ${res.status}`);
    const t = parseTimetable(await res.text());
    if (!t.updated || t.updated === cursor) return { cursor, facts: [], happenings: [] };

    const cancelled = t.departures.filter((d) => d.status.startsWith("cancel"));
    if (cancelled.length === 0) return { cursor: t.updated, facts: [], happenings: [] };

    const villages = [...new Set(cancelled.flatMap((d) => [d.from, d.to]).filter((v) => v !== "La Spezia"))].sort();
    const validFrom = `${t.date}T06:00:00+02:00`;
    const expires = `${t.date}T23:59:00+02:00`;
    const fact: Fact = {
      kind: "transport",
      title: `Ferries cancelled: ${cancelled.length} departure(s) to ${villages.join(", ")}`,
      summary: `${t.notice} Cancelled: ${cancelled.map((d) => `${d.time} ${d.from}→${d.to}`).join("; ")}.`,
      source_url: PAGE,
      region,
      valid_from: validFrom,
      expires_at: expires,
    };
    const happenings: HappeningCandidate[] = villages.includes("Vernazza")
      ? [
          {
            title: "Ferries cancelled — update the Vernazza getting-there guide",
            hook: "Rough sea has stopped the ferries to Vernazza today. Readers arriving by boat need the train alternative now, not tomorrow.",
            involves_roles: ["writer", "editor"],
            urgency: 3,
            expires_at: expires,
          },
        ]
      : [];
    return { cursor: t.updated, facts: [fact], happenings };
  },
});
