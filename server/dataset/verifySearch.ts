// Runs the launch queries against the shipped catalogue, through the same code the server uses.
//
// This is the check that the dataset is searchable rather than merely large: an acronym a reader
// types ("SPE", "EAGE"), a subject ("geochemistry"), a place ("Bahrain") and a year all have to
// return the conferences that match them. It reads the dataset from disk and calls nothing else.

import { searchLaunchDataset } from "./staticDataset";

const QUERIES = [
  "IEEE", "SPE", "AAPG", "SEG", "EAGE", "Goldschmidt", "geochemistry", "petroleum",
  "cybersecurity", "artificial intelligence", "machine learning", "energy",
  "Dubai", "Saudi Arabia", "Bahrain", "China", "USA", "Europe",
  "2026", "2027", "2028",
];

function main(): void {
  const requested = process.argv.slice(2);
  const queries = requested.length > 0 ? requested : QUERIES;
  let empty = 0;

  for (const query of queries) {
    const results = searchLaunchDataset(query, 100);
    if (results.length === 0) empty += 1;
    const sample = results.slice(0, 3).map((result) => result.title);
    console.log(`${String(results.length).padStart(4)}  ${query.padEnd(24)} ${sample.join(" | ") || "(nothing)"}`);
  }

  console.log(`\n${queries.length - empty}/${queries.length} queries returned at least one conference.`);
  if (empty > 0) process.exitCode = 1;
}

if (process.argv[1] && process.argv[1].endsWith("verifySearch.ts")) main();
