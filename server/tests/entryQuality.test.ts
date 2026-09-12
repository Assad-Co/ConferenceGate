// The strings in this file are not invented. Every rejection below is something the catalogue's own
// sweep stored in a real conference's roster, and the conference is named beside it.

import assert from "node:assert/strict";
import test from "node:test";
import { isCredibleAffiliation, isCredibleName } from "../discovery/entryQuality";

test("a real person with a real affiliation is kept", () => {
  for (const name of [
    "Peter Norvig",                  // The AI Conference 2026
    "Tedros Adhanom Ghebreyesus",    // World Health Summit 2026
    "Jeffrey S. Klein",              // RSNA Annual Meeting 2026
    "Pavel Loskot",                  // 2027 Conference on Robotics and Intelligent Systems
    "Bolormaa Purevdorj",            // 2026 Conference on Healthcare Service Management
    "Rémi Flamary",                  // NeurIPS 2026 — accents are names too
    "Craig Salvalaggio",             // RoboBusiness 2026
  ]) assert.equal(isCredibleName(name), true, name);

  for (const org of ["Stanford HAI", "Anthropic", "Gates Foundation", "University of Georgia"]) {
    assert.equal(isCredibleAffiliation(org), true, org);
  }
});

test("a job title with nobody holding it is not a person", () => {
  // World Government Summit 2027 stored its entire speaker list as job titles.
  for (const title of [
    "Chief Executive Officer", "Director General", "Prime Minister", "Federal President",
    "General Chair",              // 2027 13th International Conference on Computer Technology
    "Publicity Chairs",           // 2027 18th International Conference on E-Education
    "Young Researchers",          // 2nd Global Meeting on Artificial Intelligence
    "Regional Chairs",            // 2027 13th International Conference on Frontiers
  ]) assert.equal(isCredibleName(title), false, title);
});

test("page furniture is not a committee member", () => {
  // "Mozilla Firefox" was stored as a committee member of two separate conferences: Global
  // Emergency Nursing 2027 and EPIDEMICS 11.
  for (const junk of [
    "Mozilla Firefox", "Youtube", "Linkedin", "E-Mail GCAGS",
    "Floor Plan", "Exhibitor Resource Center",   // RSNA Annual Meeting 2026
    "Guide for Authors", "Reviewer Hub",         // 20th Vaccine Congress
  ]) assert.equal(isCredibleName(junk), false, junk);
});

test("a file the page shipped is not a sponsor", () => {
  for (const file of [
    "AICon Cultural fun.png",                    // AICON 2026
    "Screenshot 2026-06-19 at 6.13_edited.jpg",  // AICON 2026
    "20250911 090451 MAGO5735",                  // Gastech 2026
    "1900 GT 2025 Thursday 11Th 1GM04163",       // Gastech 2026
    "6-featuredimage",                           // SPE Asia Pacific Oil & Gas
  ]) assert.equal(isCredibleName(file), false, file);
});

test("a stylesheet fragment is not an organisation", () => {
  // Entrepreneur's sponsor list was its sprite: "team; title shape; shapes; trans; remote; hash".
  for (const fragment of ["title shape", "shapes", "trans", "remote", "hash", "gear", "qm", "o3"]) {
    assert.equal(isCredibleName(fragment), false, fragment);
  }
});

test("marketing copy and dates are not speakers", () => {
  for (const copy of [
    "Introducing NVIDIA RTX Spark",                        // NVIDIA GTC Berlin 2026
    "October 4 Monday - Day #3",                           // AAPG Eastern Section 2026
    "Logo on on-site signage",                             // URTeC Latin America
    "https://exhibits.spe.org/ATCE2026//Public/eventmap.aspx",  // SPE ATCE 2026
  ]) assert.equal(isCredibleName(copy), false, copy);
});

test("a biography is not an affiliation, and the person survives it", () => {
  // EuroFinance stored Can Balcioglu's whole bio where his employer belonged. The name is right.
  const bio = "With over 25 years of leadership experience in Treasury, FP&A, and Business Finance,"
    + " Can Balcioglu currently serves as the Vice President, Group Treasurer at PayPal";
  assert.equal(isCredibleName("Can Balcioglu"), true);
  assert.equal(isCredibleAffiliation(bio), false);
  // ASU+GSV billed Barack Obama as an "Academy + Grammy Award Winning Artist", which belongs to
  // somebody else on that page entirely. An affiliation this catalogue cannot stand behind is
  // dropped rather than printed beside a name.
  assert.equal(isCredibleAffiliation("An invitation-only network where global energy leaders align"), false);
  assert.equal(isCredibleAffiliation("peer-reviewed research journal dedicated to publishing high-quality"), false);
});
