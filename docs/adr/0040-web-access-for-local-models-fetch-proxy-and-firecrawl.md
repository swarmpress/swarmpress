# ADR-0040 — Web access for local models: fetch proxy and Firecrawl

**Status:** Accepted; amended by ADR-0051
**Date:** 2026-10-01

## Context

Local browser LLM staff need the web: research, checking facts, reading a restaurant's opening
hours, following news. Browsers can't fetch arbitrary sites directly, because CORS blocks
cross-origin reads, so purely in-browser fetching only works for the few sites that allow it.
Firecrawl (search, JS rendering, scrape and crawl into clean Markdown) is powerful but costs
money per request. Claude's `web_search` is available to Agency jobs (ADR-0033).

## Decision

Web access is one **`web` tool** for agents, with three tiers chosen per call:
1. **Local (free):** the browser first tries a direct `fetch` for CORS-enabled sources, and
   otherwise uses the central **fetch proxy** (`GET /web/fetch?url=`). The proxy only fetches:
   - it respects robots.txt and sends an identifying user agent;
   - it rate-limits per company;
   - it allows HTML, text and JSON only, capped at 2 MB;
   - it has a short TTL cache and blocks private and internal addresses (SSRF protection).

   All parsing happens **locally in the browser**: readability extraction, link and metadata
   extraction, summarization and analysis by the local model. Search on the free tier is
   limited, through free providers or RSS where available.
2. **Firecrawl (credits):** `POST /web/firecrawl/{search|scrape|crawl}` proxies Firecrawl with the
   platform's key. It is metered in credits with quote → hold → settle (ADR-0033), and limited
   per company. Use it for JS-heavy pages, site crawls and high-quality search.
3. **Agency (credits):** Claude with `web_search` for deep research jobs.

Common rules:
- All fetched content is **untrusted data**, never instructions (prompt-injection hygiene).
- Facts used in content need citations, and links in published pages still pass the
  closed-world and citation rules.
- The tier is chosen by policy:
  - local first;
  - Firecrawl only if the job's role and policy allow it and the company has credits;
  - the CEO sets a monthly web budget.

## Consequences

- Research works at zero cost for most pages. Paid quality is opt-in and visible as credits.
- The fetch proxy is a public-facing network service. It needs SSRF hardening, per-company
  quotas, an abuse response and logging of fetched hosts per company.
- The Firecrawl key stays central; per-company usage is metered from Firecrawl's response
  metadata.
- This sandbox can't reach external hosts, so tests use recorded fixtures and a fake Firecrawl.
