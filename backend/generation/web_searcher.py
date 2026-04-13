"""
Web searcher — SearXNG self-hosted (primary) → Brave API (fallback) → DuckDuckGo.

SearXNG runs as a local Docker container and aggregates Google, Bing, DDG
simultaneously with no API keys and no rate limits.
Brave is a free-tier fallback (2k req/month, no card required).
DuckDuckGo (via duckduckgo-search library) is the always-available free fallback.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

import httpx

from core.config import settings

TIMEOUT = 10.0


@dataclass
class SearchResult:
    title: str
    snippet: str
    url: str


# ── SearXNG ────────────────────────────────────────────────────────

async def _searxng_search(query: str, max_results: int = 7) -> list[SearchResult]:
    """
    Query the local SearXNG instance.

    Requires SearXNG running with JSON format enabled.
    Docker: docker run -d -p 8080:8080 \\
              -v ./searxng-settings.yml:/etc/searxng/settings.yml:ro \\
              searxng/searxng
    settings.yml must include:
      search:
        formats: [html, json]
    """
    if not settings.searxng_url:
        return []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                f"{settings.searxng_url.rstrip('/')}/search",
                params={
                    "q": query,
                    "format": "json",
                    "engines": "google,bing,duckduckgo",
                    "lang": "en",
                },
            )
            resp.raise_for_status()
            data = resp.json()

        results: list[SearchResult] = []
        for r in data.get("results", [])[:max_results]:
            snippet = r.get("content") or r.get("snippet", "")
            if not snippet or len(snippet) < 20:
                continue
            results.append(SearchResult(
                title=r.get("title", ""),
                snippet=snippet,
                url=r.get("url", ""),
            ))
        return results
    except httpx.ConnectError:
        return []
    except Exception as e:
        print(f"[searxng] Search failed: {e}")
        return []


# ── Brave Search API ───────────────────────────────────────────────

async def _brave_search(query: str, max_results: int = 7) -> list[SearchResult]:
    """
    Brave Search API fallback.
    Free tier: 2,000 requests/month, no credit card.
    Get key at: https://brave.com/search/api/
    Set BRAVE_API_KEY in .env
    """
    if not settings.brave_api_key:
        return []
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            resp = await client.get(
                "https://api.search.brave.com/res/v1/web/search",
                params={"q": query, "count": max_results},
                headers={
                    "Accept": "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": settings.brave_api_key,
                },
            )
            resp.raise_for_status()
            data = resp.json()

        results: list[SearchResult] = []
        for r in data.get("web", {}).get("results", [])[:max_results]:
            snippet = r.get("description", "")
            if not snippet or len(snippet) < 20:
                continue
            results.append(SearchResult(
                title=r.get("title", ""),
                snippet=snippet,
                url=r.get("url", ""),
            ))
        return results
    except Exception as e:
        print(f"[brave] Search failed: {e}")
        return []


# ── DuckDuckGo Web Search ──────────────────────────────────────────

async def _ddg_search(query: str, max_results: int = 7) -> list[SearchResult]:
    """
    Free fallback using the duckduckgo-search library.
    No API key required. Scrapes DDG web results directly.
    Install: pip install duckduckgo-search
    """
    try:
        from duckduckgo_search import DDGS

        def _sync_search() -> list[SearchResult]:
            out: list[SearchResult] = []
            with DDGS() as ddgs:
                for r in ddgs.text(query, max_results=max_results):
                    snippet = r.get("body", "")
                    if not snippet or len(snippet) < 20:
                        continue
                    out.append(SearchResult(
                        title=r.get("title", ""),
                        snippet=snippet,
                        url=r.get("href", ""),
                    ))
            return out

        return await asyncio.get_event_loop().run_in_executor(None, _sync_search)
    except ImportError:
        print("[ddg] duckduckgo-search not installed; run: pip install duckduckgo-search")
        return []
    except Exception as e:
        print(f"[ddg] Search failed: {e}")
        return []


# ── Public interface ───────────────────────────────────────────────

async def fetch_search_results(query: str, max_results: int = 7) -> list[SearchResult]:
    """
    Fetch results using the priority chain:
      1. SearXNG (self-hosted, unlimited, best quality)
      2. Brave Search API (free 2k/month, if key configured)
      3. DuckDuckGo (duckduckgo-search library, always free, no key needed)

    All three run concurrently; results are merged and deduplicated.
    """
    searxng_task = asyncio.create_task(_searxng_search(query, max_results))
    brave_task = asyncio.create_task(_brave_search(query, max_results))
    ddg_task = asyncio.create_task(_ddg_search(query, max_results))

    searxng_r, brave_r, ddg_r = await asyncio.gather(
        searxng_task, brave_task, ddg_task, return_exceptions=True
    )

    merged: list[SearchResult] = []
    seen: set[str] = set()

    # Priority order: SearXNG first (best), then Brave, then DDG
    for source in [searxng_r, brave_r, ddg_r]:
        if not isinstance(source, list):
            continue
        for r in source:
            key = r.snippet[:60] if r.snippet else r.url[:60]
            if key and key not in seen:
                seen.add(key)
                merged.append(r)

    return merged[:max_results]


def _format_for_llm(results: list[SearchResult]) -> str:
    if not results:
        return "No search results found."
    parts = []
    for i, r in enumerate(results, 1):
        h = f"[{i}] {r.title}"
        if r.url:
            h += f"\nURL: {r.url}"
        parts.append(f"{h}\n{r.snippet}")
    return "\n\n".join(parts)


WEB_SEARCH_PROMPT = """Answer the question using the search results below.
Write a thorough, well-structured response of at least 3-5 paragraphs.
- Start with a direct answer to the question.
- Then expand with relevant context, background, how it works, key features, use cases, or history as appropriate.
- Use bullet points or numbered lists where they help clarity.
- Cite sources inline by number [1], [2], etc.
- For factual data (prices, rates, statistics), note that values may have changed.
- Do not truncate — give the user a complete, informative answer.

Search results:
{context}"""


async def complete_web_search(query: str) -> dict:
    """Fetch results, run the LLM once, return answer + sources (JSON API)."""
    from core.llm import get_llm

    results = await fetch_search_results(query)

    if not results:
        detail = []
        if settings.searxng_url:
            detail.append(f"SearXNG ({settings.searxng_url}) returned nothing; ensure it is running with JSON format enabled")
        if settings.brave_api_key:
            detail.append("Brave returned nothing")
        else:
            detail.append("Brave API key not configured")
        detail.append("DuckDuckGo search returned nothing")
        msg = "No search results found. " + "; ".join(detail) + "."
        return {"answer": msg, "sources": []}

    context = _format_for_llm(results)
    sources = [
        {"title": r.title, "url": r.url, "snippet": r.snippet[:140]}
        for r in results
        if r.url
    ]

    llm = get_llm()
    answer = await llm.generate_answer(
        question=query,
        context=context,
        system_prompt=WEB_SEARCH_PROMPT,
    )
    return {"answer": answer, "sources": sources}
