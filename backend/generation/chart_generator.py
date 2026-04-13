"""
Chart generator — classify question, fetch data, build Plotly JSON (Python or LLM for web).
"""

from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone
from typing import Any

import httpx

from core.llm import get_llm
from generation.web_searcher import fetch_search_results

TIMEOUT = 30.0

CLASSIFY_PROMPT = """You are a chart router. Read the user question and output ONLY one JSON object, no markdown fences.

Categories: currency, stock, crypto, economic, web.

Examples:
{{"category":"currency","from":"INR","to":"USD","days":180}}
{{"category":"economic","indicator":"NY.GDP.MKTP.CD","countries":["IN","US"],"years":10}}
{{"category":"crypto","coin":"bitcoin","days":180}}
{{"category":"stock","symbol":"AAPL","days":180}}
{{"category":"web","search_query":"global smartphone market share 2024"}}

Rules:
- Use ISO 3166-1 alpha-2 for countries in economic (e.g. IN, US).
- For crypto use CoinGecko coin id: lowercase, e.g. bitcoin, ethereum.
- Stock symbol: Yahoo Finance ticker (e.g. AAPL, MSFT).
- Currency: 3-letter ISO codes for from/to.
- If the question does not fit the other categories or needs arbitrary web facts, use web with a concise search_query.
- Default days: 180 for markets, years: 10 for economic if unspecified.

Output JSON only."""


WEB_CHART_SYSTEM = """You output ONLY valid JSON for Plotly.js (no markdown): an object with keys "data", "layout", and "config" (config may be an empty object).

Build a chart from the user's question (user message) and the search snippets below (context). Extract or approximate numeric series if possible; use bar or scatter. If data is sparse, still produce a minimal chart with labels from the snippets.

Layout must include paper_bgcolor and plot_bgcolor "rgba(0,0,0,0)", font color "#c9c7bf", and xaxis/yaxis gridcolor "rgba(255,255,255,0.07)".

Search snippets:
{context}"""


INTRO_PROMPT = """In 2–4 short sentences, describe what the chart shows (metric, time range, takeaway). No markdown."""


def _parse_llm_json(text: str) -> dict[str, Any]:
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```(?:json)?\s*", "", t, flags=re.IGNORECASE)
        t = re.sub(r"\s*```\s*$", "", t)
    return json.loads(t)


def _base_axis() -> dict[str, Any]:
    return {
        "gridcolor": "rgba(255,255,255,0.07)",
        "zerolinecolor": "rgba(255,255,255,0.07)",
    }


def _base_layout(title: str, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    lay: dict[str, Any] = {
        "title": {"text": title},
        "paper_bgcolor": "rgba(0,0,0,0)",
        "plot_bgcolor": "rgba(0,0,0,0)",
        "font": {"color": "#c9c7bf"},
        "xaxis": _base_axis(),
        "yaxis": _base_axis(),
    }
    if extra:
        lay.update(extra)
    return lay


def _plotly_wrap(data: list[dict], layout: dict, config: dict | None = None) -> dict[str, Any]:
    return {"data": data, "layout": layout, "config": config or {}}


def _fetch_fx_sync(from_ccy: str, to_ccy: str, days: int) -> tuple[Any, str]:
    import yfinance as yf

    f, t = from_ccy.upper(), to_ccy.upper()
    d = min(days, 365 * 5)
    sym = f"{f}{t}=X"
    df = yf.Ticker(sym).history(period=f"{d}d")
    if df is None or df.empty:
        sym2 = f"{t}{f}=X"
        df2 = yf.Ticker(sym2).history(period=f"{d}d")
        if df2 is None or df2.empty:
            return None, sym
        inv = 1.0 / df2["Close"]
        return inv, sym2 + " (inverted)"
    return df["Close"], sym


def _fetch_stock_sync(symbol: str, days: int):
    import yfinance as yf

    d = min(days, 365 * 5)
    df = yf.Ticker(symbol.upper()).history(period=f"{d}d")
    if df is None or df.empty:
        return None
    return df


async def _coingecko_chart(coin: str, days: int) -> tuple[list[str], list[float]] | None:
    url = f"https://api.coingecko.com/api/v3/coins/{coin.lower()}/market_chart"
    params = {"vs_currency": "usd", "days": str(min(days, 365))}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            data = r.json()
        prices = data.get("prices") or []
        xs: list[str] = []
        ys: list[float] = []
        for ts_ms, p in prices:
            d = datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc)
            xs.append(d.strftime("%Y-%m-%d"))
            ys.append(float(p))
        return xs, ys
    except Exception:
        return None


async def _worldbank_series(country_iso: str, indicator: str, mrv: int) -> tuple[list[str], list[float | None]]:
    url = f"https://api.worldbank.org/v2/country/{country_iso.upper()}/indicator/{indicator}"
    params = {"format": "json", "mrv": str(max(1, min(mrv, 60))), "per_page": 500}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.get(url, params=params)
            r.raise_for_status()
            payload = r.json()
        if not isinstance(payload, list) or len(payload) < 2:
            return [], []
        rows = payload[1]
        if not isinstance(rows, list):
            return [], []
        pts: list[tuple[str, float | None]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            dt = row.get("date")
            val = row.get("value")
            if dt:
                pts.append((str(dt), float(val) if val is not None else None))
        pts.sort(key=lambda x: x[0])
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        return xs, ys
    except Exception:
        return [], []


async def _classify(question: str) -> dict[str, Any]:
    llm = get_llm()
    raw = await llm.generate_answer(
        question=question,
        context="",
        system_prompt=CLASSIFY_PROMPT,
    )
    try:
        return _parse_llm_json(raw)
    except Exception:
        return {"category": "web", "search_query": question}


def _pct_change(series: list[float]) -> float:
    if len(series) < 2:
        return 0.0
    a, b = series[0], series[-1]
    if a == 0:
        return 0.0
    return (b - a) / a * 100.0


async def _build_currency_chart(from_ccy: str, to_ccy: str, days: int) -> dict[str, Any] | None:
    ser, sym = await asyncio.to_thread(_fetch_fx_sync, from_ccy, to_ccy, days)
    if ser is None:
        return None
    idx = ser.index
    xs = [d.strftime("%Y-%m-%d") for d in idx]
    ys = [float(v) for v in ser.tolist()]
    pct = _pct_change(ys)
    color = "#22c55e" if pct >= 0 else "#ef4444"
    title = f"{from_ccy.upper()}/{to_ccy.upper()} ({sym}) — {pct:+.2f}% over period"
    layout = _base_layout(title)
    data = [
        {
            "type": "scatter",
            "mode": "lines",
            "x": xs,
            "y": ys,
            "name": "Rate",
            "line": {"color": color, "width": 2},
        }
    ]
    return _plotly_wrap(data, layout)


async def _build_crypto_chart(coin: str, days: int) -> dict[str, Any] | None:
    cg = await _coingecko_chart(coin, days)
    if not cg:
        return None
    xs, ys = cg
    pct = _pct_change(ys)
    color = "#22c55e" if pct >= 0 else "#ef4444"
    title = f"{coin.title()} (USD) — {pct:+.2f}% over period"
    layout = _base_layout(title)
    data = [
        {
            "type": "scatter",
            "mode": "lines",
            "x": xs,
            "y": ys,
            "name": "Price",
            "line": {"color": color, "width": 2},
        }
    ]
    return _plotly_wrap(data, layout)


async def _build_stock_chart(symbol: str, days: int) -> dict[str, Any] | None:
    df = await asyncio.to_thread(_fetch_stock_sync, symbol, days)
    if df is None:
        return None
    idx = df.index
    dates = [d.strftime("%Y-%m-%d") for d in idx]
    closes = [float(x) for x in df["Close"].tolist()]
    vols = [float(x) for x in df["Volume"].tolist()]
    colors: list[str] = []
    for i in range(len(closes)):
        if i == 0:
            colors.append("#64748b")
        else:
            colors.append("#22c55e" if closes[i] >= closes[i - 1] else "#ef4444")
    title = f"{symbol.upper()} — price & volume"
    layout = _base_layout(
        title,
        {
            "xaxis": {**_base_axis(), "domain": [0, 1], "anchor": "y", "showticklabels": True},
            "yaxis": {**_base_axis(), "domain": [0.35, 1], "anchor": "x", "title": "Price"},
            "xaxis2": {**_base_axis(), "domain": [0, 1], "anchor": "y2"},
            "yaxis2": {**_base_axis(), "domain": [0, 0.28], "anchor": "x2", "title": "Volume"},
            "legend": {"orientation": "h", "y": 1.02},
        },
    )
    data = [
        {
            "type": "scatter",
            "mode": "lines",
            "x": dates,
            "y": closes,
            "name": "Close",
            "xaxis": "x",
            "yaxis": "y",
            "line": {"color": "#60a5fa", "width": 2},
        },
        {
            "type": "bar",
            "x": dates,
            "y": vols,
            "name": "Volume",
            "xaxis": "x2",
            "yaxis": "y2",
            "marker": {"color": colors},
        },
    ]
    return _plotly_wrap(data, layout)


_COLORS = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa", "#fb7185"]


async def _build_economic_chart(
    indicator: str, countries: list[str], years: int
) -> dict[str, Any] | None:
    traces: list[dict[str, Any]] = []
    for i, cc in enumerate(countries):
        xs, ys = await _worldbank_series(cc, indicator, years)
        if not xs:
            continue
        traces.append(
            {
                "type": "scatter",
                "mode": "lines+markers",
                "x": xs,
                "y": ys,
                "name": cc.upper(),
                "line": {"color": _COLORS[i % len(_COLORS)], "width": 2},
            }
        )
    if not traces:
        return None
    title = f"Indicator {indicator}"
    layout = _base_layout(
        title,
        {
            "legend": {
                "orientation": "h",
                "y": -0.22,
                "x": 0.5,
                "xanchor": "center",
            },
            "margin": {"b": 100},
        },
    )
    return _plotly_wrap(traces, layout)


async def _build_web_chart_llm(question: str, search_query: str) -> dict[str, Any] | None:
    results = await fetch_search_results(search_query)
    if not results:
        return None
    parts = [f"[{i+1}] {r.title}\n{r.snippet}" for i, r in enumerate(results[:7])]
    context = "\n\n".join(parts)
    llm = get_llm()
    raw = await llm.generate_answer(
        question=question,
        context=context,
        system_prompt=WEB_CHART_SYSTEM,
    )
    try:
        obj = _parse_llm_json(raw)
        if not isinstance(obj, dict) or "data" not in obj or "layout" not in obj:
            return None
        obj.setdefault("config", {})
        return obj
    except Exception:
        return None


async def _build_chart_from_plan(question: str, plan: dict[str, Any]) -> dict[str, Any] | None:
    cat = str(plan.get("category", "web")).lower()
    if cat == "currency":
        return await _build_currency_chart(
            str(plan.get("from", "USD")),
            str(plan.get("to", "EUR")),
            int(plan.get("days", 180)),
        )
    if cat == "crypto":
        return await _build_crypto_chart(str(plan.get("coin", "bitcoin")), int(plan.get("days", 180)))
    if cat == "stock":
        return await _build_stock_chart(str(plan.get("symbol", "AAPL")), int(plan.get("days", 180)))
    if cat == "economic":
        countries = plan.get("countries") or ["US"]
        if isinstance(countries, str):
            countries = [countries]
        return await _build_economic_chart(
            str(plan.get("indicator", "NY.GDP.MKTP.CD")),
            [str(c) for c in countries],
            int(plan.get("years", 10)),
        )
    q = str(plan.get("search_query", question))
    return await _build_web_chart_llm(question, q)


async def complete_chart(question: str) -> dict[str, Any]:
    """Classify, build Plotly JSON, short LLM intro — single JSON response."""
    plan = await _classify(question)
    try:
        chart = await _build_chart_from_plan(question, plan)
        if not chart:
            return {
                "answer": "Could not build a chart from that question. Try a clearer symbol, pair, or topic.",
                "chart": None,
            }

        summary_bits = json.dumps(plan, ensure_ascii=False)[:800]
        llm = get_llm()
        intro = await llm.generate_answer(
            question=question,
            context=f"Chart plan (JSON): {summary_bits}",
            system_prompt=INTRO_PROMPT,
        )
        return {"answer": intro, "chart": chart}
    except Exception as e:
        return {"answer": str(e), "chart": None}
