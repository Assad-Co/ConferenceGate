// Registration prices, and the many numbers on a prices page that are not one.
//
// Every refusal below is a line that sat beside a real fee on a real conference page. A sponsorship
// tier, a hotel rate and a prize are all "a label next to an amount", and charging any of them to a
// reader as the cost of attending is the plausible-but-wrong value this codebase exists to refuse.

import assert from "node:assert/strict";
import test from "node:test";
import { feesCell, feesFromPage, findFeePages } from "../discovery/feePages";
import { parseFees } from "../dataset/sources/curatedDetails";

const PAGE = `<main>
  <h2>Registration Fees</h2>
  <table>
    <tr><th>Category</th><th>Early Bird</th></tr>
    <tr><td>Student Registration</td><td>$499</td></tr>
    <tr><td>IEEE Member</td><td>$699</td></tr>
  </table>
  <h3>Accommodation</h3><ul><li>Conference hotel — $210 per night</li></ul>
  <h3>Sponsorship</h3><ul><li>Gold Sponsor package $15,000</li><li>Exhibitor booth $4,500</li></ul>
  <p>Last year we welcomed 1,200 delegates from 45 countries.</p>
  <p>Best paper award $1,000</p>
  <ul><li>Virtual attendance pass — $199</li></ul>
</main>`;

test("a price is kept only where the page itself put a category beside it", () => {
  const fees = feesFromPage(PAGE, "https://example-conf.org/registration");
  assert.deepEqual(
    fees.map((fee) => `${fee.label} ${fee.amount}`),
    ["Student Registration 499", "IEEE Member 699", "Virtual attendance pass 199"]
  );
  // The hotel rate, both sponsorship tiers, the prize and the attendance figure are all refused.
  const labels = fees.map((fee) => fee.label.toLowerCase()).join(" ");
  for (const absent of ["hotel", "sponsor", "booth", "award", "delegates"]) {
    assert.equal(labels.includes(absent), false, `${absent} was read as a registration fee`);
  }
});

test("the cell it writes is the one the detail reader already reads", () => {
  const cell = feesCell(feesFromPage(PAGE, "https://example-conf.org/registration"));
  assert.equal(cell, "USD Student Registration $499; IEEE Member $699; Virtual attendance pass $199");
  const parsed = parseFees(cell);
  assert.equal(parsed.currency, "USD");
  assert.deepEqual(parsed.fees.map((fee) => [fee.category, fee.amount]), [
    ["Student Registration", 499], ["IEEE Member", 699], ["Virtual attendance pass", 199],
  ]);
});

test("a page pricing in euros is not quietly relabelled in dollars", () => {
  const cell = feesCell(feesFromPage(
    `<table><tr><td>Regular registration</td><td>€450</td></tr><tr><td>Student rate</td><td>€250</td></tr></table>`,
    "https://example-conf.org/fees"
  ));
  assert.equal(parseFees(cell).currency, "EUR");

  // Two currencies on one page are two price lists. Joining them would attach one to the other's
  // categories, so the odd ones out are dropped rather than mislabelled.
  const mixed = feesFromPage(
    `<table><tr><td>Delegate rate</td><td>$500</td></tr><tr><td>Student rate</td><td>$300</td></tr><tr><td>Member rate</td><td>£250</td></tr></table>`,
    "https://example-conf.org/fees"
  );
  assert.equal(parseFees(feesCell(mixed)).currency, "USD");
  assert.equal(feesCell(mixed).includes("Member rate"), false);
});

test("free is not a fee, and a bare number is not a price", () => {
  assert.deepEqual(feesFromPage(`<table><tr><td>Student rate</td><td>$0</td></tr></table>`, "https://x.org/f"), []);
  assert.deepEqual(feesFromPage(`<table><tr><td>Attendees</td><td>1200</td></tr></table>`, "https://x.org/f"), []);
});

test("only the site's own pages are followed for prices", () => {
  const html = `<a href="/registration">Register</a><a href="/fees.pdf">Fees PDF</a>
    <a href="https://tickets.example.com/buy">Buy tickets</a><a href="/speakers">Speakers</a>`;
  assert.deepEqual(findFeePages(html, "https://example-conf.org/"), ["https://example-conf.org/registration"]);
});
