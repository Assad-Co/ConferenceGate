import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
process.env.CONFERENCE_INTELLIGENCE_PATCH_TEST = "1";
const { patchIntelligenceApp } = await import(
  "./patchConferenceIntelligence.mjs"
);
const source = fs.readFileSync("src/App.tsx", "utf8");
test("production-generated app exposes free discovery and planning entry points", () => {
  assert(source.includes('defaultView="planner"'));
  assert(source.includes("/* conference-intelligence-suite */"));
  assert.equal(patchIntelligenceApp(source), source);
});
test("both role intelligence panels remain under the paid-access true branch", () => {
  const tree = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = new Set();
  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      ["OrganizerIntelligencePanel", "SponsorIntelligencePanel"].includes(
        node.tagName.getText(tree),
      )
    ) {
      let child = node,
        parent = node.parent,
        guard = false;
      while (parent) {
        if (
          ts.isConditionalExpression(parent) &&
          parent.condition.getText(tree) === "authUser.hasPaidAccess" &&
          child === parent.whenTrue
        )
          guard = true;
        child = parent;
        parent = parent.parent;
      }
      assert(
        guard,
        `${node.tagName.getText(tree)} escaped the paid access guard`,
      );
      found.add(node.tagName.getText(tree));
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(found.size, 2);
});
