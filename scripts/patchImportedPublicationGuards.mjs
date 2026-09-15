import fs from "node:fs";

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  const index = source.indexOf(before);
  if (index === -1) throw new Error(`[import-guard-patch] could not find ${label}`);
  return source.slice(0, index) + after + source.slice(index + before.length);
}

function patchEnrichment() {
  const path = "server/discovery/enrichment.ts";
  let source = fs.readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `  for (const event of events) {\n    const fields = fieldsByEvent.get(String(event.id)) || new Set<string>();`,
    `  for (const event of events) {\n    // Apify Stage 7 and LinkedIn v1.5 have already passed their own strict external verifier.\n    // They deliberately do not populate the native discovery field-evidence ledger, so running\n    // native readiness over them would downgrade valid imported publications simply because the\n    // evidence lives in their import provenance rather than discovery_event_fields. Preserve the\n    // importer's published/readiness decision; native discovery continues to recompute every row it owns.\n    if (["apify_stage7", "linkedin_v1_5"].includes(String(event.extraction_method || ""))) {\n      if (event.status === "published" && event.publish_readiness !== "publish_ready") {\n        await dbRun(\`UPDATE discovery_events SET publish_readiness='publish_ready', readiness_reasons='[]' WHERE id=?\`, [event.id]);\n      }\n      continue;\n    }\n    const fields = fieldsByEvent.get(String(event.id)) || new Set<string>();`,
    "external import readiness guard",
  );

  fs.writeFileSync(path, source);
  console.log("[import-guard-patch] patched enrichment readiness guard");
}

function patchPublish() {
  const path = "server/discovery/publish.ts";
  let source = fs.readFileSync(path, "utf8");

  source = replaceOnce(
    source,
    `      WHERE json_extract(ec.extraction_metadata, '$.origin') = 'discovery_engine'\n        AND (e.publish_readiness <> 'publish_ready' OR e.status IN ('rejected','expired','cancelled'))`,
    `      WHERE json_extract(ec.extraction_metadata, '$.origin') = 'discovery_engine'\n        -- External verifier imports intentionally share the discovery-backed UI path, but they are\n        -- not owned by native discovery readiness. Their import provenance is the authority for\n        -- publication, so native retraction must never delete them.\n        AND COALESCE(json_extract(ec.extraction_metadata, '$.import_origin'), '') = ''\n        AND COALESCE(e.extraction_method, '') NOT IN ('apify_stage7','linkedin_v1_5')\n        AND (e.publish_readiness <> 'publish_ready' OR e.status IN ('rejected','expired','cancelled'))`,
    "external import retraction guard",
  );

  fs.writeFileSync(path, source);
  console.log("[import-guard-patch] patched publication retraction guard");
}

patchEnrichment();
patchPublish();
