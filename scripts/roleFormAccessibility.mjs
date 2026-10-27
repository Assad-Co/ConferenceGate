import ts from 'typescript';

const nativeTags = new Set(['input', 'select', 'textarea']);
const openingOf = node => ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
const tagOf = node => openingOf(node)?.tagName.getText();
const attribute = (opening, name) => opening.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText() === name);

/** Patch final generated JSX, preserving wrapped checkbox labels and field behavior. */
export function associateRoleFormLabels(source, prefix) {
  const file = ts.createSourceFile('role.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  const insertions = new Map();
  const labeledControls = new Set();
  const usedIds = new Set();
  let index = 0;
  function collectIds(node) {
    const opening = openingOf(node);
    const value = opening && attribute(opening, 'id')?.initializer;
    if (value && ts.isStringLiteral(value)) usedIds.add(value.text);
    ts.forEachChild(node, collectIds);
  }
  collectIds(file);
  function nextId(group = false) {
    let id;
    do { id = `cg-${prefix}-${group ? 'group-' : ''}${index++}`; } while (usedIds.has(id));
    usedIds.add(id); return id;
  }
  function addAttributes(opening, text) {
    const position = opening.tagName.end;
    insertions.set(position, (insertions.get(position) || '') + text);
  }
  function controlsIn(node) {
    const controls = [];
    function visit(item) {
      const opening = openingOf(item);
      if (opening && nativeTags.has(opening.tagName.getText())) controls.push(opening);
      ts.forEachChild(item, visit);
    }
    visit(node);
    return controls;
  }
  function visit(node) {
    if (ts.isJsxElement(node) && tagOf(node) === 'label') {
      const opening = node.openingElement;
      if (!attribute(opening, 'htmlFor') && controlsIn(node).length === 0 && ts.isJsxElement(node.parent)) {
        const siblings = node.parent.children;
        const position = siblings.indexOf(node);
        let next;
        for (let i = position + 1; i < siblings.length; i++) {
          if (ts.isJsxText(siblings[i]) && !siblings[i].getText().trim()) continue;
          next = siblings[i]; break;
        }
        if (next && tagOf(next) !== 'label') {
          const controls = controlsIn(next);
          if (controls.length === 1) {
            const control = controls[0];
            const existing = attribute(control, 'id');
            const id = existing?.initializer;
            if (!existing || (id && ts.isStringLiteral(id))) {
              const value = id?.text || nextId();
              addAttributes(opening, ` htmlFor="${value}"`);
              if (!existing) addAttributes(control, ` id="${value}"`);
              labeledControls.add(control);
            }
          } else if (controls.length > 1 && openingOf(next) && !attribute(openingOf(next), 'role')) {
            // One heading describes several schedule controls: label the group, not just its first field.
            const id = nextId(true);
            edits.push({ start: opening.tagName.getStart(file), end: opening.tagName.end, text: 'span' });
            edits.push({ start: node.closingElement.tagName.getStart(file), end: node.closingElement.tagName.end, text: 'span' });
            addAttributes(opening, ` id="${id}"`);
            addAttributes(openingOf(next), ` role="group" aria-labelledby="${id}"`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const names = {
    'committeeDraft.name': 'Committee member full name',
    'committeeDraft.title': 'Committee member title',
    'committeeDraft.org': 'Committee member organization',
    'committeeDraft.committeeRole': 'Committee member role',
    'programItemDraft.type': 'Program item type',
    'programItemDraft.title': 'Program item title',
    'programItemDraft.date': 'Program item date',
    'programItemDraft.time': 'Program item time',
    'speakerDraft.name': 'Speaker full name',
    'speakerDraft.title': 'Speaker title',
    'speakerDraft.org': 'Speaker organization',
    'speakerDraft.bio': 'Speaker biography',
  };
  function nameControls(node) {
    const opening = openingOf(node);
    if (opening && nativeTags.has(opening.tagName.getText()) && !labeledControls.has(opening) && !attribute(opening, 'aria-label')) {
      const value = attribute(opening, 'value')?.initializer;
      const name = value && ts.isJsxExpression(value) && value.expression ? names[value.expression.getText(file)] : undefined;
      if (name) addAttributes(opening, ` aria-label="${name}"`);
    }
    ts.forEachChild(node, nameControls);
  }
  nameControls(file);
  for (const [position, text] of insertions) edits.push({ start: position, end: position, text });
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  return source;
}
