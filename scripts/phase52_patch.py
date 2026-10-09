from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match in {path}, found {count}")
    p.write_text(text.replace(old, new, 1))
    print(f"updated {path}: {label}")


# Stored conference result shape: expose the extra fields Profile History can reuse without a crawl.
replace_once(
    "server/braveSearch.ts",
    '''  format?: "in-person" | "hybrid" | "online" | null;\n  /** What the conference is, where the record holds a description of its own. */\n  description?: string | null;\n  /** Which tabs actually have something behind them, so a card offers only those. */''',
    '''  format?: "in-person" | "hybrid" | "online" | null;\n  /** Rich stored identity fields reused by Profile → Conference History. */\n  venue?: string | null;\n  organization?: string | null;\n  topics?: string[];\n  /** What the conference is, where the record holds a description of its own. */\n  description?: string | null;\n  /** Which tabs actually have something behind them, so a card offers only those. */''',
    "extend stored conference result for profile history",
)
replace_once(
    "server/braveSearch.ts",
    '''        location: city || nation ? { city, country: nation } : null,\n        category: text(overview.category) ?? text((overview.categories ?? [])[0]),''',
    '''        location: city || nation ? { city, country: nation } : null,\n        venue: text(overview.venue) ?? text(overview.venue_name),\n        organization: text(overview.organizer) ?? text(overview.organizing_institution) ?? text(overview.society),\n        topics: Array.isArray(overview.topics)\n          ? overview.topics.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)\n          : [],\n        category: text(overview.category) ?? text((overview.categories ?? [])[0]),''',
    "map venue organizer and topics from stored extraction",
)

history_route = r'''
// Profile history enrichment is deliberately stored-only. Matching a conference identity can add
// authoritative event metadata, but it must never upgrade a person's attendance or role evidence.
// `searchConferences` has been database/static-catalogue only since Phase 1.5, so this route cannot
// spend provider quota or turn a profile view into a web crawl.
braveSearchRouter.post(
  "/conferences/history-match",
  asyncHandler(async (req, res) => {
    const records = Array.isArray(req.body?.records) ? req.body.records.slice(0, 50) : [];
    const results = [] as any[];

    const yearOf = (result: LiveSearchResult): number | null => {
      const fromStart = String(result.startDate || "").match(/\b(20\d{2})\b/)?.[1];
      const fromTitle = result.title.match(/\b(20\d{2})\b/)?.[1];
      const year = Number(fromStart || fromTitle || 0);
      return year >= 2000 && year <= 2100 ? year : null;
    };

    for (const record of records) {
      const key = typeof record?.key === "string" ? record.key : "";
      const title = typeof record?.title === "string" ? record.title.trim() : "";
      const requestedYear = Number(record?.year || 0) || null;
      if (!key || title.length < 3) {
        results.push({ key, matched: false });
        continue;
      }

      const requestedIdentity = conferenceIdentity(title);
      if (!requestedIdentity) {
        results.push({ key, matched: false });
        continue;
      }

      const candidates = await searchConferences(title, "low", false);
      const exactTitleCandidates = candidates.filter(
        (candidate) => conferenceIdentity(candidate.title) === requestedIdentity
      );
      const sameYear = requestedYear
        ? exactTitleCandidates.find((candidate) => {
            const candidateYear = yearOf(candidate);
            return candidateYear === null || candidateYear === requestedYear;
          })
        : null;
      const match = sameYear || exactTitleCandidates[0] || null;

      if (!match) {
        results.push({ key, matched: false });
        continue;
      }

      const candidateYear = yearOf(match);
      const confidence = requestedYear && candidateYear === requestedYear
        ? "exact-title-year"
        : "exact-title";
      results.push({
        key,
        matched: true,
        confidence,
        title: match.title,
        officialUrl: match.link,
        description: match.description || match.snippet || null,
        startDate: match.startDate || null,
        endDate: match.endDate || null,
        city: match.location?.city || null,
        country: match.location?.country || null,
        venue: match.venue || null,
        organizer: match.organization || null,
        format: match.format || null,
        category: match.category || null,
        categories: match.categories || [],
        topics: match.topics || [],
        sections: match.sections || [],
        cfpStatus: match.cfpStatus || null,
        cfpOpen: Boolean(match.cfpOpen),
        prepared: Boolean(match.prepared),
      });
    }

    res.json({ results });
  })
);

'''
replace_once(
    "server/braveSearch.ts",
    '''braveSearchRouter.get(\n  "/conferences",''',
    history_route + '''braveSearchRouter.get(\n  "/conferences",''',
    "add stored-only profile history resolver route",
)

# Profile history: enrich all three native history sources without changing their evidence labels.
replace_once(
    "src/components/UserProfileView.tsx",
    "import { LinkedInImportedTabSections } from './LinkedInImportedTabSections';\n",
    "import { LinkedInImportedTabSections } from './LinkedInImportedTabSections';\nimport { ConferenceHistoryDetails } from './ConferenceHistoryDetails';\n",
    "import conference history enrichment",
)
replace_once(
    "src/components/UserProfileView.tsx",
    '''                      {attendance.sourceUrl && (\n                        <a href={attendance.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-blue-700 hover:underline">\n                          <ExternalLink className="w-3 h-3" /> Official source\n                        </a>\n                      )}\n                    </div>''',
    '''                      {attendance.sourceUrl && (\n                        <a href={attendance.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 mt-1 text-[10px] font-semibold text-blue-700 hover:underline">\n                          <ExternalLink className="w-3 h-3" /> Official source\n                        </a>\n                      )}\n                      <ConferenceHistoryDetails\n                        title={attendance.conferenceTitle}\n                        year={attendance.startDate?.slice(0, 4)}\n                        evidenceContext="confirmed-attendance"\n                      />\n                    </div>''',
    "enrich attended conference cards",
)
replace_once(
    "src/components/UserProfileView.tsx",
    '''                      <p className="text-[11px] text-slate-500">{conf.location} • {conf.roleLabel}</p>\n                    </div>''',
    '''                      <p className="text-[11px] text-slate-500">{conf.location} • {conf.roleLabel}</p>\n                      <ConferenceHistoryDetails\n                        title={conf.title}\n                        year={conf.eventDate?.match(/\\b20\\d{2}\\b/)?.[0]}\n                        evidenceContext="registration"\n                      />\n                    </div>''',
    "enrich registration history cards",
)
replace_once(
    "src/components/UserProfileView.tsx",
    '''                        <p className="text-[11px] text-slate-500">\n                          {[entry.location, entry.year, entry.role].filter(Boolean).join(' • ')}\n                        </p>\n                      </div>''',
    '''                        <p className="text-[11px] text-slate-500">\n                          {[entry.location, entry.year, entry.role].filter(Boolean).join(' • ')}\n                        </p>\n                        <ConferenceHistoryDetails\n                          title={entry.conferenceName}\n                          year={entry.year}\n                          evidenceContext="self-reported"\n                        />\n                      </div>''',
    "enrich self-reported history while preserving evidence status",
)

# LinkedIn conference signals get event metadata, never identity/attendance verification.
replace_once(
    "src/components/LinkedInImportedTabSections.tsx",
    "import { ExternalLink, Linkedin, Loader2, ShieldAlert } from 'lucide-react';\n",
    "import { ExternalLink, Linkedin, Loader2, ShieldAlert } from 'lucide-react';\nimport { ConferenceHistoryDetails } from './ConferenceHistoryDetails';\n",
    "import conference history details into LinkedIn evidence",
)
replace_once(
    "src/components/LinkedInImportedTabSections.tsx",
    '''        {sourceLink(signal.sourceUrl)}\n      </div>''',
    '''        {sourceLink(signal.sourceUrl)}\n        {['PAST_CONFERENCE', 'UPCOMING_CONFERENCE', 'CONFERENCE_ROLE', 'CONFERENCE_MENTION'].includes(signal.kind) && (\n          <ConferenceHistoryDetails\n            title={signal.conferenceName || signal.label}\n            year={signal.year}\n            evidenceContext="linkedin"\n          />\n        )}\n      </div>''',
    "enrich LinkedIn conference signals with stored event record",
)

# Ship the curated expansion on every environment through the existing background maintenance path.
replace_once(
    "scripts/runBackgroundBootstrap.mjs",
    '''  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');\n  await runScript('scripts/syncRequestedCategoryExpansion.mjs');\n  // Phase 28:''',
    '''  await runScript('scripts/seedPopularCategoryHardCrawl.mjs');\n  await runScript('scripts/syncRequestedCategoryExpansion.mjs');\n  await runScript('scripts/syncPhase52MajorConferences.mjs');\n  // Phase 28:''',
    "run Phase 52 verified conference sync at startup",
)

print("Phase 52 guarded source patch completed")
