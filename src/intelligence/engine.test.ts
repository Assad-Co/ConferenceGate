import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cfpIntelligence,
  conferenceKey,
  emptyState,
  evaluateAlerts,
  evidenceAssessment,
  isoDate,
  matchConference,
  matchOpportunity,
  parseState,
  planCalendar,
  safeLink,
} from "./engine";
import { smartSearch } from "./search";
import world from './world.json';
import type {
  LiveSearchResult,
  ExtractedConferenceDetails,
} from "../api/search";
import type { UserProfile, ProfessionalOpportunity } from "../types";
const result: LiveSearchResult = {
  title: "Health AI Research Forum",
  link: "https://example.invalid/forum",
  snippet: "",
  displayLink: "",
  thumbnail: null,
  favicon: null,
  description: "Machine learning in medical research",
  category: "Healthcare",
  startDate: "2027-06-10",
  endDate: "2027-06-12",
  organization: "Synthetic Society",
  location: { city: "London", country: "United Kingdom" },
  cfpOpen: true,
};
const profile = {
  expertise: ["artificial intelligence"],
  researchInterests: ["medicine"],
  keywords: [],
  preferredRegions: ["United Kingdom"],
  committeeAvailable: true,
} as UserProfile;
test('map territory identities do not inherit a sovereign country count',()=>{
  for(const [territory,parent] of [['Falkland Islands','United Kingdom'],['Puerto Rico','United States of America'],['New Caledonia','France']]){
    const feature=world.find(f=>f.name===territory);assert(feature);assert(!feature.aliases.includes(parent));
  }
});
test('preferred regions are resolved using the existing canonical country registry',()=>{
  const match=matchConference(result,{...profile,preferredRegions:['Europe']});assert.equal(match.score,100);assert(match.reasons.some(r=>r.includes('United Kingdom')));
});
test("semantic profile matches explain expertise, interests and country without inventing verification", () => {
  const m = matchConference(result, profile);
  assert.equal(m.score, 100);
  assert.equal(m.reasons.length, 3);
  assert.equal(evidenceAssessment(result).independentlyVerified, false);
});
test("irrelevant and empty profiles do not acquire a score", () => {
  assert.equal(
    matchConference(result, {
      expertise: ["mining"],
      researchInterests: [],
      keywords: [],
      preferredRegions: [],
    }).score,
    0,
  );
  assert.equal(
    matchConference(result, {
      expertise: [],
      researchInterests: [],
      keywords: [],
    }).score,
    0,
  );
});
test("smart search supports synonyms, exact phrases and negative terms", () => {
  assert.equal(
    smartSearch([result], 'AI "medical research" -finance', "", "", "", false)
      .length,
    1,
  );
  assert.equal(
    smartSearch([result], "-healthcare", "", "", "", false).length,
    0,
  );
  assert.equal(
    smartSearch([result], '"medical unknown"', "", "", "", false).length,
    0,
  );
});
test("country and date filters combine and exclude undated records for a date window", () => {
  assert.equal(
    smartSearch(
      [result, { ...result, startDate: null }],
      "",
      "United Kingdom",
      "2027-06-01",
      "2027-07-01",
      true,
    ).length,
    1,
  );
  assert.equal(smartSearch([result], "", "Canada", "", "", false).length, 0);
});
test("calendar validation rejects rollover dates including non-leap February", () => {
  for (const d of ["2027-02-29", "2027-04-31", "2027-13-01", "tomorrow"])
    assert.equal(isoDate(d), null);
  assert.equal(isoDate("2028-02-29"), "2028-02-29");
});
test("CFP checks honor closed status and use dates deterministically", () => {
  const d = {
    cfpDeadline: "2027-05-01",
    cfpStatus: "Closed",
  } as ExtractedConferenceDetails;
  assert.equal(cfpIntelligence(result, d, "2027-04-01").state, "Closed");
  assert.equal(
    cfpIntelligence(result, { ...d, cfpStatus: "Open" }, "2027-05-02").state,
    "Deadline passed",
  );
});
test("conflicting and impossible CFP dates are not offered as confirmed deadlines", () => {
  assert.equal(
    cfpIntelligence(result, {
      cfpDeadline: "2027-07-01",
    } as ExtractedConferenceDetails).deadline,
    null,
  );
  assert.equal(
    cfpIntelligence(result, {
      cfpDeadline: "2027-02-29",
    } as ExtractedConferenceDetails).state,
    "Needs confirmation",
  );
  assert.equal(
    cfpIntelligence(result, {
      cfpDeadline: "2027-05-01",
      conflicts: [{ field: "cfpDeadline", values: [] }],
    } as ExtractedConferenceDetails).deadline,
    null,
  );
});
test("risk screening distinguishes sparse data and insecure links from fraud conclusions", () => {
  const a = evidenceAssessment({
    ...result,
    organization: null,
    link: "http://example.invalid",
    endDate: "2027-06-01",
  });
  assert(a.flags.includes("End date precedes start date"));
  assert(a.flags.includes("Organizer identity is not recorded"));
  assert(a.flags.some((f) => f.includes("HTTPS")));
  assert.equal(a.label, "Information readiness");
});
test("external links reject executable schemes and embedded credentials", () => {
  for (const v of [
    "javascript:alert(1)",
    "data:text/html,x",
    "https://user:secret@example.invalid",
  ])
    assert.equal(safeLink(v), null);
  assert.equal(safeLink(result.link), result.link);
});
test("opportunity ranking excludes expired, invalid and closed opportunities", () => {
  const o = {
    status: "active",
    title: "Machine learning committee",
    description: "",
    expertiseRequired: ["AI"],
    deadline: "2027-05-01",
    roleType: "committee",
  } as ProfessionalOpportunity;
  assert(matchOpportunity(o, profile, "2027-04-01").score > 0);
  assert.equal(matchOpportunity(o, profile, "2027-05-02").eligible, false);
  assert.equal(
    matchOpportunity({ ...o, deadline: "next week" }, profile).eligible,
    false,
  );
  assert.equal(
    matchOpportunity({ ...o, status: "closed" }, profile).eligible,
    false,
  );
});
test("new and changed alert matches deduplicate across refreshes", () => {
  const s = {
    ...emptyState(),
    rules: [
      {
        id: "rule",
        name: "AI",
        query: "AI",
        country: "",
        cfpOnly: true,
        enabled: true,
        seen: {},
      },
    ],
  };
  const first = evaluateAlerts(s, [result]);
  assert.equal(first.alerts.length, 1);
  assert.equal(evaluateAlerts(first, [result]).alerts.length, 1);
  const changed = evaluateAlerts(first, [{ ...result, cfpStatus: "Extended" }]);
  assert.equal(changed.alerts.length, 2);
  assert(changed.alerts[0].title.startsWith("Updated"));
});
test("disabled or nonmatching alerts do not notify", () => {
  const s = {
    ...emptyState(),
    rules: [
      {
        id: "r",
        name: "Energy",
        query: "mining",
        country: "",
        cfpOnly: false,
        enabled: true,
        seen: {},
      },
    ],
  };
  assert.equal(evaluateAlerts(s, [result]).alerts.length, 0);
  assert.equal(
    evaluateAlerts(
      { ...s, rules: [{ ...s.rules[0], query: "", enabled: false }] },
      [result],
    ).alerts.length,
    0,
  );
});
test("saved alerts retain the exact search exclusions, quoted phrases and date window", () => {
  const rule = {
    id: "r",
    name: "AI",
    query: 'AI "medical research" -finance',
    country: "United Kingdom",
    from: "2027-06-01",
    to: "2027-07-01",
    cfpOnly: true,
    enabled: true,
    seen: {},
  };
  const records = [
    result,
    { ...result, title: "AI Finance", description: "medical research finance" },
    { ...result, startDate: "2027-08-01" },
    { ...result, startDate: null },
  ];
  const expected = smartSearch(
    records,
    rule.query,
    rule.country,
    rule.from,
    rule.to,
    true,
  );
  assert.equal(expected.length, 1);
  assert.equal(
    evaluateAlerts({ ...emptyState(), rules: [rule] }, records).alerts.length,
    expected.length,
  );
});
test("stored data parsing rejects unsupported envelopes and unsafe plan links", () => {
  assert.throws(() => parseState("{bad"));
  assert.throws(() => parseState('{"version":2}'));
  const p = {
    id: "p",
    result: { ...result, link: "javascript:alert(1)" },
    status: "considering",
    notes: "",
    tasks: [],
  };
  assert.equal(
    parseState(JSON.stringify({ ...emptyState(), plans: [p] })).plans.length,
    0,
  );
});
test("planning data keeps private statuses separate from official actions", () => {
  const p = {
    id: conferenceKey(result),
    result,
    status: "preparing" as const,
    notes: "Personal only",
    deadline: "2027-02-29",
    deadlineConfirmed: false,
    tasks: [{ id: "t", text: "Prepare", done: true }],
  };
  const s = parseState(JSON.stringify({ ...emptyState(), plans: [p] }));
  assert.equal(s.plans[0].deadline, null);
  assert.equal(s.plans[0].tasks[0].done, true);
});
test("calendar export uses inclusive event range, escaped fields and no injected properties", () => {
  const p = {
    id: "p",
    result: { ...result, title: "Forum\nATTENDEE:evil@example.invalid" },
    status: "considering" as const,
    notes: "",
    deadline: null,
    deadlineConfirmed: false,
    tasks: [],
  };
  const text = planCalendar(p, new Date("2026-10-27T12:00:00Z"))!;
  assert(text.includes("DTEND;VALUE=DATE:20270613"));
  assert(text.includes("SUMMARY:Forum\\nATTENDEE:"));
  assert(!text.includes("\r\nATTENDEE:"));
  assert.equal(
    planCalendar({ ...p, result: { ...result, startDate: null } }),
    null,
  );
});
