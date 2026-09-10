const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { parse } = require('parse5');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'README.html'), 'utf8');
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
assert.equal(html.match(/<meta name="luma-version" content="([^"]+)"/)[1], version, 'README.html version must match package.json');
assert.match(html, /<html lang="ja">/);
// The browser also enforces offline loading, including any future inline JS.
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`;
assert.ok(html.includes(csp) && html.indexOf(csp) < html.search(/<(?:style|script)\b/i), 'Offline CSP must precede styles and scripts');
// Any separate resource, including a local relative file, breaks the single-file
// distribution. Navigation links are allowed; automatic HTML/CSS loads are not.
const resourceAttrs = new Set(['src', 'srcdoc', 'srcset', 'imagesrcset', 'poster', 'data', 'code', 'codebase', 'archive', 'background', 'manifest', 'profile', 'ping', 'action', 'formaction']);
// CSS identifiers can spell url/@import using hexadecimal or simple escapes.
// Decode one CSS escape pass, including optional whitespace after a hex escape.
const cssUnescape = value => value.replace(/\\(?:([\da-f]{1,6})(?:\r\n|[\t\n\f\r ])?|([\s\S]))/gi, (_, hex, char) => {
  if (!hex) return /[\n\r\f]/.test(char) ? '' : char;
  const code = parseInt(hex, 16);
  return code === 0 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff ? '\ufffd' : String.fromCodePoint(code);
});
const checkCss = css => assert.ok(!/@import\b|url\s*\(|image-set\s*\(/i.test(cssUnescape(css)), 'CSS must not load separate resources');
// Use the browser's HTML parsing rules for character references, duplicate
// attributes, SVG namespaces and templates, rather than inspecting raw markup.
function inspectResources(node) {
  for (const attr of node.attrs || []) {
    const name = (attr.prefix ? `${attr.prefix}:` : '') + attr.name, value = attr.value;
    const hrefLoad = ['href', 'xlink:href'].includes(name) && !['a', 'area'].includes(node.tagName);
    assert.ok(!resourceAttrs.has(name) && !hrefLoad, `Separate resource attribute: <${node.tagName} ${name}>`);
    assert.ok(name !== 'http-equiv' || value.trim().toLowerCase() !== 'refresh', 'Automatic page refresh is not offline navigation');
    // SVG presentation attributes (filter, fill, mask, markers, etc.) also
    // accept CSS URL values. Check every value so new attributes cannot bypass it.
    checkCss(value);
  }
  if (node.tagName === 'style') checkCss((node.childNodes || []).map(child => child.value || '').join(''));
  for (const child of node.childNodes || []) inspectResources(child);
  if (node.content) inspectResources(node.content);
}
inspectResources(parse(html));
inspectResources(parse(html, { scriptingEnabled: false }));

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(ids.length, new Set(ids).size, 'Duplicate HTML ids');
for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), `Broken section link: #${id}`);

const source = fs.readFileSync(path.join(root, 'src', 'shortcuts.ts'), 'utf8');
const sourceFile = ts.createSourceFile('shortcuts.ts', source, ts.ScriptTarget.Latest, true);
const union = sourceFile.statements.find(node => ts.isTypeAliasDeclaration(node) && node.name.text === 'EditorCommand');
const commands = union.type.types.map(node => node.literal.text).sort();
const sandbox = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
const resolve = sandbox.exports.shortcutCommand;
const event = (key, ctrlKey = false, shiftKey = false) => ({ key, ctrlKey, shiftKey, metaKey: false, altKey: false, isComposing: false, repeat: false });
// '+' and '?' are characters that can require Shift depending on keyboard layout.
const signature = e => `${e.ctrlKey ? 'Ctrl+' : ''}${e.shiftKey && !['+', '?'].includes(e.key) ? 'Shift+' : ''}${e.key.toLowerCase()}`;
const documented = new Map();
const rows = [...html.matchAll(/<tr\b[^>]*data-command="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g)];
assert.deepEqual(rows.map(row => row[1]).sort(), commands, 'Document each EditorCommand exactly once');
for (const [, command, row] of rows) {
  const keys = [...row.matchAll(/<kbd\b([^>]*\bdata-key="([^"]+)"[^>]*)>([^<]+)<\/kbd>/g)];
  assert.ok(keys.length, `No keys documented for ${command}`);
  for (const [, attrs, key, label] of keys) {
    const input = event(key, /\bdata-ctrl(?:\s|$)/.test(attrs), /\bdata-shift(?:\s|$)/.test(attrs));
    assert.equal(resolve(input), command, `${label} does not invoke ${command}`);
    const visible = label.toLowerCase();
    const visibleKey = { ' ': 'space', arrowleft: '←', arrowright: '→', '-': '−' }[key.toLowerCase()] || key.toLowerCase();
    assert.ok(visible.includes(visibleKey), `Visible key label does not match data-key: ${label}`);
    assert.equal(visible.includes('ctrl+'), input.ctrlKey, `Ctrl label differs: ${label}`);
    assert.equal(visible.includes('shift+'), input.shiftKey, `Shift label differs: ${label}`);
    assert.ok(!documented.has(signature(input)), `Duplicate key: ${label}`);
    documented.set(signature(input), command);
  }
}

// Derive possible named keys from the source as well as printable keyboard keys.
// This catches a newly assigned alias even if EditorCommand has not changed.
const candidates = new Set(Array.from({ length: 95 }, (_, i) => String.fromCharCode(i + 32)));
function collect(node) { if (ts.isStringLiteral(node) || ts.isIdentifier(node)) candidates.add(node.text); ts.forEachChild(node, collect); }
collect(sourceFile);
const implemented = new Map();
for (const key of candidates) for (const ctrl of [false, true]) for (const shift of [false, true]) {
  const input = event(key, ctrl, shift), command = resolve(input);
  if (!command) continue;
  implemented.set(signature(input), command);
  assert.equal(documented.get(signature(input)), command, `Missing alias: ${signature(input)} → ${command}`);
}
assert.equal(documented.size, implemented.size, 'Unexpected documented shortcut aliases');
console.log(`README.html v${version}: ${commands.length} commands, ${documented.size} key bindings, ${ids.length} unique anchors; source mapping and HTML/CSS resource references verified.`);
