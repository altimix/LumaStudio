import assert from 'node:assert/strict';
import {parse} from 'parse5';

const base = process.env.SITE_URL || 'http://localhost:8791';
const canonicalOrigin = 'https://lumastudio.altimix.jp';
const routes = ['/', '/developer/', '/manual/', '/getting-started/', '/support/', '/about/'];
const titles = new Set();
const descriptions = new Set();
function nodes(root, tag) {
  return [...(root.tagName === tag ? [root] : []), ...(root.childNodes || []).flatMap(child => nodes(child, tag))];
}
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value;
const content = node => node.value || (node.childNodes || []).map(content).join('');
for (const route of routes) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, route);
  assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /noindex/i);
  const doc = parse(await response.text());
  const metas = nodes(doc, 'meta');
  const title = content(nodes(doc, 'title')[0]);
  const description = attr(metas.find(node => attr(node, 'name') === 'description'), 'content');
  assert.ok(title && description, route + ' metadata');
  assert.ok(!titles.has(title) && !descriptions.has(description), route + ' unique metadata');
  titles.add(title); descriptions.add(description);
  assert.equal(nodes(doc, 'h1').length, 1, route + ' single h1');
  assert.equal(attr(nodes(doc, 'link').find(node => attr(node, 'rel') === 'canonical'), 'href'), canonicalOrigin + route);
  assert.match(attr(metas.find(node => attr(node, 'name') === 'robots'), 'content'), /^index, follow/);
  const scripts = nodes(doc, 'script').filter(node => attr(node, 'type') === 'application/ld+json');
  assert.equal(scripts.length, 1);
  const structured = JSON.parse(content(scripts[0]));
  assert.equal(structured['@context'], 'https://schema.org');
  assert.ok(structured['@graph'].some(item => item['@type'] === 'WebSite'));
  if (route === '/' || route === '/developer/') {
    assert.equal(structured['@graph'].find(item => item['@type'] === 'Person').name, '安藤昇');
    assert.ok(nodes(doc, 'img').some(node => attr(node, 'src') === '/assets/noboru-ando.png' && attr(node, 'alt')));
    assert.ok(nodes(doc, 'blockquote').some(node => content(node).includes('学校で、生徒が動画編集の基本を学べる')));
  }
  if (route === '/') assert.equal(structured['@graph'].find(item => item['@type'] === 'SoftwareApplication').offers.price, '0');
  console.log('SEO verified:', route);
}
const sitemap = await fetch(base + '/sitemap.xml');
assert.equal(sitemap.status, 200);
const sitemapText = await sitemap.text();
for (const route of routes) assert.ok(sitemapText.includes(`<loc>${canonicalOrigin}${route}</loc>`));
assert.ok(!sitemapText.includes('/404'));
const robots = await fetch(base + '/robots.txt');
assert.equal(robots.status, 200);
assert.match(await robots.text(), /Allow: \/\s+Sitemap: https:\/\/lumastudio\.altimix\.jp\/sitemap\.xml/);
const image = await fetch(base + '/assets/noboru-ando.png');
assert.equal(image.status, 200);
assert.match(image.headers.get('content-type'), /image\/png/);
const missing = await fetch(base + '/seo-not-a-page');
assert.equal(missing.status, 404);
assert.match(await missing.text(), /name="robots" content="noindex, follow"/);
console.log('Sitemap, robots, portrait and noindex 404 verified:', base);
