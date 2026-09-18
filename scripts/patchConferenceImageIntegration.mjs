import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) {
    throw new Error(`[conference-images-patch] could not find ${label}`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchBraveSearch() {
  const path = "server/braveSearch.ts";
  let source = fs.readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `    source_url: string;\n    overview: string;`,
    `    source_url: string;\n    image_url: string | null;\n    overview: string;`,
    "prepared result row image_url type",
  );

  source = replaceOnce(
    source,
    `    \`SELECT ec.source_url, ec.overview, ec.call_for_papers, ec.program_agenda,\n              ec.keynote_speakers, ec.technical_committee, ec.sponsors_exhibitors,\n              ec.venue_accommodation, ec.fees_pricing, ec.community,\n              ec.extraction_metadata, ec.updated_at`,
    `    \`SELECT ec.source_url, de.image_url, ec.overview, ec.call_for_papers, ec.program_agenda,\n              ec.keynote_speakers, ec.technical_committee, ec.sponsors_exhibitors,\n              ec.venue_accommodation, ec.fees_pricing, ec.community,\n              ec.extraction_metadata, ec.updated_at`,
    "prepared result SELECT image_url",
  );

  if (!source.includes("Prefer the logo actually stored by enrichment")) {
    source = replaceOnce(
      source,
      `        displayLink: host,\n        thumbnail: null,\n        // A published record's source is the conference's own site — publication refuses a listing\n        // — so the icon that site serves is the conference's own mark rather than a directory's.\n        favicon: siteIconUrl(row.source_url),\n        // Still the host's mark rather than an edition's, so the card labels it as the organiser's.\n        logoSource: siteIconUrl(row.source_url) ? ("organiser" as const) : null,`,
      `        displayLink: host,\n        // Representative artwork comes only from the verified official site. It is secondary to a\n        // stated event logo, but available to the UI as the last visual fallback before initials.\n        thumbnail: text(row.image_url) ?? text(overview.image_url),\n        // Prefer the logo actually stored by enrichment. When it is an organiser mark, preserve\n        // that provenance rather than upgrading it to an event logo.\n        favicon: text(overview.logo_url) ?? siteIconUrl(row.source_url),\n        logoSource:\n          overview.logo_source === "stated" || overview.logo_source === "organiser"\n            ? overview.logo_source\n            : ((text(overview.logo_url) ?? siteIconUrl(row.source_url)) ? ("organiser" as const) : null),`,
      "prepared result visual mapping",
    );
  }

  fs.writeFileSync(path, source);
  console.log("[conference-images-patch] patched server/braveSearch.ts");
}

function patchDiscoveryEngine() {
  const path = "src/components/DiscoveryEngine.tsx";
  let source = fs.readFileSync(path, "utf8");

  const start = source.indexOf("const ConferenceLogo: React.FC");
  const end = source.indexOf("\nconst MONTH_SHORT", start);
  if (start === -1 || end === -1) {
    throw new Error("[conference-images-patch] could not locate ConferenceLogo component");
  }

  const replacement = `const ConferenceLogo: React.FC<{ result: LiveSearchResult; className?: string }> = ({ result, className }) => {
  const abbreviation = fallbackConferenceAbbreviation(result);
  const isAapg = /\\baapg\\b|american association of petroleum geologists|rms-aapg|esaapg|swsaapg|iceevent\\.org/i.test(
    [result.title, result.organization, result.link, result.displayLink].filter(Boolean).join(' ')
  );
  const derivedOrganiserIcon = (() => {
    if (result.favicon) return null;
    try {
      const page = new URL(result.link);
      return page.hostname ? new URL('/favicon.ico', page.origin).href : null;
    } catch {
      return null;
    }
  })();

  // Visual evidence priority:
  // 1) event logo stated by the official source,
  // 2) organiser/site mark,
  // 3) official-site banner/representative image,
  // 4) Conference Gate initials.
  const candidates = [
    isAapg
      ? { url: '/aapg-organizer.svg', kind: 'organiser-logo' as const }
      : null,
    result.favicon
      ? {
          url: result.favicon,
          kind: result.logoSource === 'stated' ? ('event-logo' as const) : ('organiser-logo' as const),
        }
      : null,
    derivedOrganiserIcon
      ? { url: derivedOrganiserIcon, kind: 'organiser-logo' as const }
      : null,
    result.thumbnail
      ? { url: result.thumbnail, kind: 'official-image' as const }
      : null,
  ].filter(Boolean) as Array<{
    url: string;
    kind: 'event-logo' | 'organiser-logo' | 'official-image';
  }>;

  const [candidateIndex, setCandidateIndex] = React.useState(0);
  React.useEffect(() => setCandidateIndex(0), [result.favicon, result.thumbnail, result.link]);

  const candidate = candidates[candidateIndex] ?? null;

  if (candidate) {
    const isEventLogo = candidate.kind === 'event-logo';
    const isOfficialImage = candidate.kind === 'official-image';

    return (
      <img
        src={candidate.url}
        alt={
          isEventLogo
            ? \`\${abbreviation} logo\`
            : isOfficialImage
              ? \`\${abbreviation} official conference image\`
              : \`\${organiserHost(result)} logo\`
        }
        title={
          isEventLogo
            ? undefined
            : isOfficialImage
              ? 'Image published on the official conference website'
              : \`Organiser: \${organiserHost(result)}\`
        }
        onError={() => setCandidateIndex((index) => index + 1)}
        onLoad={(event) => {
          const img = event.currentTarget;
          // A tiny favicon is not useful as a 112px conference mark. Try the next verified visual.
          if (candidate.kind !== 'official-image' && Math.max(img.naturalWidth, img.naturalHeight) <= 32) {
            setCandidateIndex((index) => index + 1);
          }
        }}
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        className={
          className ??
          (isOfficialImage
            ? 'w-full h-full object-cover rounded-xl'
            : 'max-w-full max-h-full object-contain')
        }
      />
    );
  }

  return (
    <span className={\`\${markSizeClass(abbreviation)} max-w-full break-words font-black tracking-wide text-black text-center leading-tight\`}>
      {abbreviation}
    </span>
  );
};
`;

  if (!source.includes("Visual evidence priority:")) {
    source = source.slice(0, start) + replacement + source.slice(end);
    fs.writeFileSync(path, source);
    console.log("[conference-images-patch] patched src/components/DiscoveryEngine.tsx");
  } else {
    console.log("[conference-images-patch] DiscoveryEngine already patched");
  }
}

patchBraveSearch();
patchDiscoveryEngine();
