import React from "react";
import world from "../intelligence/world.json";
import { normalize } from "../intelligence/engine";
import type { LiveSearchResult } from "../api/search";

const aliases: Record<string, string> = {
  usa: "united states of america",
  us: "united states of america",
  "united states": "united states of america",
  uk: "united kingdom",
  uae: "united arab emirates",
  ksa: "saudi arabia",
  türkiye: "turkey",
  "south korea": "south korea",
  "republic of korea": "south korea",
  czechia: "czech republic",
};
const canonical = (s: string) => aliases[normalize(s)] || normalize(s);
export function ConferenceIntelligenceMap({
  results,
  country,
  onCountry,
}: {
  results: LiveSearchResult[];
  country: string;
  onCountry: (s: string) => void;
}) {
  const counts = new Map<string, { label: string; count: number }>();
  let unknown = 0;
  for (const r of results) {
    const label = r.location?.country?.trim();
    if (!label) {
      unknown++;
      continue;
    }
    const key = canonical(label);
    const old = counts.get(key);
    counts.set(key, {
      label: old?.label || label,
      count: (old?.count || 0) + 1,
    });
  }
  const mapped = new Set<string>();
  return (
    <section
      className="space-y-3"
      aria-label="Global conference intelligence map"
    >
      <p className="text-sm text-slate-600">
        Country-level catalogue coverage. Select a country to filter results.
        Shapes show geographic coverage, not venue locations or independent
        verification.
      </p>
      <svg
        viewBox="0 0 360 180"
        className="w-full bg-blue-50 border rounded-xl"
        role="group"
        aria-label="World map. Country filters are also listed below."
      >
        {world.map((c) => {
          const key = [c.name, ...c.aliases]
            .map(canonical)
            .find((n) => counts.has(n));
          const entry = key ? counts.get(key) : null;
          if (key) mapped.add(key);
          return (
            <g key={c.name}>
              {c.paths.map((path, i) => (
                <path
                  key={i}
                  d={path}
                  fill={
                    entry
                      ? canonical(country) === key
                        ? "#1e40af"
                        : "#60a5fa"
                      : "#e2e8f0"
                  }
                  stroke="#fff"
                  strokeWidth="0.25"
                  {...(entry
                    ? {
                        role: "button",
                        tabIndex: i === 0 ? 0 : -1,
                        "aria-label": `${entry.label}: ${entry.count} conferences`,
                        onClick: () => onCountry(entry.label),
                        onKeyDown: (e: React.KeyboardEvent) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onCountry(entry.label);
                          }
                        },
                      }
                    : {})}
                >
                  <title>
                    {c.name}: {entry?.count || 0} catalogue records
                  </title>
                </path>
              ))}
            </g>
          );
        })}
      </svg>
      <div
        className="flex flex-wrap gap-2 max-h-44 overflow-auto"
        aria-label="Country counts"
      >
        <button
          type="button"
          className="cg-intel-button"
          onClick={() => onCountry("")}
        >
          All countries
        </button>
        {[...counts.values()]
          .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
          .map((c) => (
            <button
              type="button"
              className="cg-intel-button"
              aria-pressed={country === c.label}
              key={c.label}
              onClick={() => onCountry(c.label)}
            >
              {c.label} ({c.count})
            </button>
          ))}
      </div>
      <p className="text-xs text-slate-500">
        {unknown} records have no stated country;{" "}
        {[...counts]
          .filter(([k]) => !mapped.has(k))
          .reduce((s, [, c]) => s + c.count, 0)}{" "}
        are available in the list but not mapped. Map geometry:{" "}
        <a
          href="https://www.naturalearthdata.com/about/terms-of-use/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Natural Earth, public domain
        </a>
        . Boundaries are illustrative.
      </p>
    </section>
  );
}
