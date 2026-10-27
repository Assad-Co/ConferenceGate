import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import { associateRoleFormLabels } from './roleFormAccessibility.mjs';

test('adjacent and nested native fields receive their visible labels without id collisions', () => {
  const input = '<div><input id="cg-role-0"/><label>Industry</label><select/><label>Budget</label><div><input type="number"/></div></div>';
  const result = associateRoleFormLabels(input, 'role');
  assert.match(result, /<label htmlFor="cg-role-1">Industry<\/label><select id="cg-role-1"/);
  assert.match(result, /<label htmlFor="cg-role-2">Budget<\/label><div><input id="cg-role-2"/);
  assert.equal(associateRoleFormLabels(result, 'role'), result);
});

test('group headings name the group and schedule controls retain distinct accessible names', () => {
  const input = '<div><label>Schedule</label><div><select value={programItemDraft.type}/><input value={programItemDraft.date}/><input value={programItemDraft.time}/></div></div>';
  const result = associateRoleFormLabels(input, 'role');
  assert.match(result, /<span id="cg-role-group-0">Schedule<\/span>/);
  assert.match(result, /role="group" aria-labelledby="cg-role-group-0"/);
  for (const name of ['Program item type', 'Program item date', 'Program item time']) assert(result.includes(`aria-label="${name}"`));
  assert.equal(associateRoleFormLabels(result, 'role'), result);
});

test('implicit checkbox labels are preserved', () => {
  const input = '<div><label><input type="checkbox"/><span>Consent</span></label></div>';
  assert.equal(associateRoleFormLabels(input, 'role'), input);
});

for (const [path, prefix] of [['src/components/OrganizerDashboard.tsx', 'organizer'], ['src/components/SponsorWizardPanel.tsx', 'sponsor']]) {
  test(`${prefix} final source has no dangling labels and patch replay is stable`, () => {
    const source = associateRoleFormLabels(fs.readFileSync(path, 'utf8'), prefix);
    assert.equal(associateRoleFormLabels(source, prefix), source);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(file.parseDiagnostics.length, 0);
    function nativeControl(node) {
      let found = false;
      function visit(item) {
        const opening = ts.isJsxElement(item) ? item.openingElement : ts.isJsxSelfClosingElement(item) ? item : null;
        if (opening && ['input', 'select', 'textarea'].includes(opening.tagName.getText(file))) found = true;
        ts.forEachChild(item, visit);
      }
      visit(node); return found;
    }
    const ids = new Set();
    const targets = [];
    function visit(node) {
      const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
      if (opening) {
        const attrs = opening.attributes.properties;
        const id = attrs.find(a => ts.isJsxAttribute(a) && a.name.getText(file) === 'id')?.initializer;
        if (id && ts.isStringLiteral(id)) { assert(!ids.has(id.text), `Duplicate id: ${id.text}`); ids.add(id.text); }
        if (ts.isJsxElement(node) && opening.tagName.getText(file) === 'label') {
          const target = attrs.find(a => ts.isJsxAttribute(a) && a.name.getText(file) === 'htmlFor')?.initializer;
          assert(target || nativeControl(node), 'Unassociated visible label');
          if (target && ts.isStringLiteral(target)) targets.push(target.text);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    for (const id of targets) assert(ids.has(id), `Missing label target: ${id}`);
  });
}
