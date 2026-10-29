import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLinkedInProfilePayload as normalize, extractLinkedInProfileConferenceSignals as signals, mergeProfileRoleSummary, mergeLinkedInSection } from "../linkedinImportNormalization";

test("legacy aliases and provider metadata do not duplicate the same career position", () => {
  const old = { title: "Scientist", company: "Institute", startDate: "Aug 2004", endDate: "Dec 2025" };
  const rich = { position: "Scientist", companyName: "Institute", startDate: { text: "Aug 2004" }, endDate: { text: "Dec 2025" }, id: "provider-123", description: "Research work" };
  const merged = mergeLinkedInSection([old], [rich], "experience");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].description, "Research work");
  assert.equal(mergeLinkedInSection(merged, [old, rich], "experience").length, 1);
  assert.equal(mergeLinkedInSection(merged, [{ ...rich, startDate: "Aug 2001" }], "experience").length, 2);
});

test("string skills and named skill objects have one identity", () => {
  assert.equal(mergeLinkedInSection(["Geochemistry"], [{ name: "Geochemistry", endorsements: 12 }], "skills").length, 1);
  assert.equal(mergeLinkedInSection(["Arabic"], [{ name: "Arabic", proficiency: "Native" }], "languages").length, 1);
});

test("publication enrichment merges sparse history while retaining distinct editions", () => {
  const rich = { title: "Research Paper", publisher: "Proceedings", date: "2012", doi: "10.1234/one" };
  const merged = mergeLinkedInSection([{ title: "Research Paper" }], [rich], "publications");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].doi, rich.doi);
  assert.equal(mergeLinkedInSection(merged, [{ ...rich, date: "2020", doi: "10.1234/two" }], "publications").length, 2);
});

const url = "https://www.linkedin.com/in/test-researcher";
test("nested profile payloads and collection aliases retain all career history", () => {
  const value = normalize({ data: { profile: { fullName: "Test Researcher", publicIdentifier: "test-researcher", experience: { items: [{ company: { name: "Research Institute" }, positions: { elements: [{ title: "Researcher", startDate: { year: 2001 }, endDate: { year: 2008 } }, { title: "Principal Scientist", isCurrent: true, startDate: { year: 2020 } }] } }] }, education: { items: [{ school: { name: "University" }, degreeName: "PhD", field: "Geology" }] } } } });
  assert.equal(value.experience.length, 2);
  assert.equal(value.experience[0].position, "Principal Scientist");
  assert.equal(value.experience[1].companyName, "Research Institute");
  assert.equal(value.experience[1].startDate.text, "2001");
  assert.equal(value.education[0].degree, "PhD");
});
test("individual objects and accomplishment aliases are normalized", () => {
  const value = normalize({ name: "Researcher", profileUrl: url, currentPosition: { title: "Scientist", companyName: "Institute" }, accomplishments: { publications: { elements: [{ title: "Paper", publisher: { name: "Proceedings" }, publishedOn: { year: 2012 } }] }, patents: [{ title: "Patent", patentNumber: "P1" }], honors: [{ name: "Scientific Award" }], languages: ["Arabic"] }, licensesAndCertifications: { items: [{ name: "Certification", authority: { name: "Society" } }] }, volunteerExperience: [{ role: "Session Chair", organization: { name: "Energy Conference 2024" } }], skills: ["Geochemistry", { name: "GC-MS" }] });
  assert.equal(value.experience[0].position, "Scientist");
  assert.equal(value.publications[0].publisher, "Proceedings");
  assert.equal(value.publications[0].date, "2012");
  assert.equal(value.certifications[0].issuer, "Society");
  assert.equal(value.volunteering[0].title, "Session Chair");
  assert.equal(value.skills.length, 2);
});
test("partial refresh preserves older records only for the same linked identity", () => {
  const previous = { linkedinUrl: url, fullName: "Researcher", experience: [{ title: "Scientist", companyName: "Lab", startDate: "2000" }], volunteering: [{ title: "Session Chair", organization: "Energy Conference 2012" }] };
  const current = normalize({ linkedinUrl: url + "/", name: "Researcher", headline: "Current headline" }, previous);
  assert.equal(current.experience.length, 1);
  assert.equal(current.volunteering.length, 1);
  const other = normalize({ linkedinUrl: "https://www.linkedin.com/in/someone-else", name: "Other" }, previous);
  assert.equal(other.experience.length, 0);
  assert.equal(other.volunteering.length, 0);
});
test("empty provider shells never become successful profile imports", () => {
  assert.deepEqual(normalize({ success: true }, { name: "Old", linkedinUrl: url }, url), {});
  assert.deepEqual(normalize({ experience: [], education: [] }, undefined, url), {});
});
test("different degrees at the same institution remain separate", () => {
  const value = normalize({ name: "Researcher", education: [{ schoolName: "University", degree: "BSc" }, { schoolName: "University", degree: "PhD" }] });
  assert.equal(value.education.length, 2);
});
test("old careers are retained without a time cutoff or arbitrary twenty-item cap", () => {
  const history = Array.from({ length: 75 }, (_, index) => ({ title: "Role " + index, companyName: "Company " + index, startDate: { year: 1940 + index }, endDate: { year: 1941 + index } }));
  assert.equal(normalize({ name: "Researcher", experience: history }).experience.length, 75);
});
test("profile roles do not depend on posts and retain exact sources and years", () => {
  const found = signals({ name: "Researcher", experience: [{ title: "Technical Program Committee Co-Chair", companyName: "Energy Conference 2012" }], volunteerExperience: [{ role: "Session Chair and Core Presenter", organization: "Geoscience Symposium 2025" }] }, url);
  assert.equal(found.length, 3);
  assert.ok(found.some(item => item.role === "Technical Program Committee Co-Chair" && item.year === 2012));
  assert.ok(found.some(item => item.role === "Core Presenter"));
  assert.ok(found.every(item => item.sourceUrl === url && item.memberClaimed && item.verified === false && item.profileSection));
});
test("specific speaker roles do not inflate generic speaker counts", () => {
  const found = signals({ name: "Researcher", volunteering: [{ title: "Keynote Speaker", organization: "Energy Conference 2025" }] }, url);
  assert.deepEqual(found.map(item => item.role), ["Keynote Speaker"]);
});
test("someone else speaking, audience attendance, and paper subject matter are not personal roles", () => {
  const value = { name: "Researcher", about: "I attended Energy Conference 2025. Dr Other was the keynote speaker.", experience: [{ title: "Researcher", companyName: "Lab", description: "Our conference featured invited speaker Dr Other." }], publications: [{ title: "Understanding keynote speaker influence at scientific conferences" }] };
  assert.equal(signals(value, url).length, 0);
});
test("explicit own role is isolated from accompanying speakers", () => {
  const found = signals({ name: "Researcher", about: "I served as Session Chair at Energy Conference 2025 with keynote speaker Dr Other." }, url);
  assert.deepEqual(found.map(item => item.role), ["Session Chair"]);
});
test("negative claims and ordinary employment are not conference-role evidence", () => {
  assert.equal(signals({ name: "Researcher", about: "I was not a keynote speaker at Energy Conference 2025." }, url).length, 0);
  assert.equal(signals({ name: "Researcher", experience: [{ title: "Committee Member", companyName: "Internal Safety Board" }] }, url).length, 0);
});
test("same profile role across sections is deduplicated and summary includes it once", () => {
  const payload = { name: "Researcher", experience: [{ title: "Session Chair", companyName: "Energy Conference 2025" }], volunteering: [{ title: "Session Chair", companyName: "Energy Conference 2025" }] };
  const found = signals(payload, url);
  assert.equal(found.length, 1);
  const summary: any = { roles: [], debug: { posts: 0 } };
  mergeProfileRoleSummary(summary, found);
  mergeProfileRoleSummary(summary, found);
  assert.equal(summary.total, 1);
  assert.equal(summary.sessionChair, 1);
  assert.deepEqual(summary.debug, { posts: 0 });
});

test("legacy aliases expose flattened records rather than duplicate company-group shells", () => {
  const value = normalize({ fullName: "Researcher", positions: [{ companyName: "Institute", roles: [{ title: "Researcher", startDate: "2001", endDate: "2010" }, { title: "Lead Scientist", isCurrent: true }] }] });
  assert.equal(value.experience.length, 2);
  assert.deepEqual(value.positions, value.experience);
  assert.equal(value.currentPositions.length, 1);
  assert.equal(value.pastPositions.length, 1);
});

test("short role titles use explicit conference organization context", () => {
  const found = signals({ name: "Researcher", volunteering: [{ title: "Co-Chair", organization: "Energy Conference 2025" }, { title: "Reviewer", organization: "Geoscience Symposium 2010" }] }, url);
  assert.deepEqual(found.map(item => item.role).sort(), ["Co-Chair", "Reviewer"]);
});
