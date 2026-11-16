// An unresolved themed cell in a master must not hide the stylesheet's fill.
// In a package with no theme part, a white callout leader otherwise turns black.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
for (const name of ['window', 'document', 'DOMParser', 'XMLSerializer', 'Node', 'CSS'])
  globalThis[name] = dom.window[name];

const temp = mkdtempSync(join(tmpdir(), 'vsdx-themed-fill-'));
process.on('exit', () => rmSync(temp, { recursive: true, force: true }));
cpSync('src', temp, { recursive: true });
writeFileSync(join(temp, 'package.json'), '{"type":"module"}');
symlinkSync(join(process.cwd(), 'node_modules'), join(temp, 'node_modules'), 'dir');
const { parseVsdx } = await import(pathToFileURL(join(temp, 'vsdx-parser.js')));
const { renderPage } = await import(pathToFileURL(join(temp, 'svg-renderer.js')));

const ns = 'http://schemas.microsoft.com/office/visio/2012/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const relationships = (target) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="${target}"/></Relationships>`;

async function drawing({ ownFill = '', masterFill = 'Themed', masterBackground = '0', theme = false } = {}) {
  const zip = new JSZip();
  zip.file('visio/document.xml', `<VisioDocument xmlns="${ns}"><StyleSheets>
    <StyleSheet ID="0"><Cell N="FillForegnd" V="1"/><Cell N="FillBkgnd" V="0"/><Cell N="FillPattern" V="1"/></StyleSheet>
    <StyleSheet ID="3" FillStyle="0"/>
  </StyleSheets></VisioDocument>`);
  zip.file('visio/masters/masters.xml', `<Masters xmlns="${ns}" xmlns:r="${rel}"><Master ID="1"><Rel r:id="rId1"/></Master></Masters>`);
  zip.file('visio/masters/_rels/masters.xml.rels', relationships('master1.xml'));
  zip.file('visio/masters/master1.xml', `<MasterContents xmlns="${ns}"><Shapes>
    <Shape ID="5" Type="Group"><Shapes><Shape ID="6" Type="Shape" FillStyle="3">
      <Cell N="Width" V="1"/><Cell N="Height" V="1"/>
      <Cell N="FillForegnd" V="${masterFill}" F="THEMEVAL()"/>
      <Cell N="FillBkgnd" V="${masterBackground}"/>
      ${theme ? '<Cell N="QuickStyleFillColor" V="4"/>' : ''}
      <Section N="Geometry" IX="0"><Cell N="NoFill" V="0"/>
        <Row T="MoveTo" IX="1"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
        <Row T="LineTo" IX="2"><Cell N="X" V="1"/><Cell N="Y" V="1"/></Row>
        <Row T="MoveTo" IX="3"><Cell N="X" V="1"/><Cell N="Y" V="0"/></Row>
        <Row T="LineTo" IX="4"><Cell N="X" V="0"/><Cell N="Y" V="0"/></Row>
      </Section>
    </Shape></Shapes></Shape>
  </Shapes></MasterContents>`);
  zip.file('visio/pages/pages.xml', `<Pages xmlns="${ns}" xmlns:r="${rel}"><Page ID="1"><PageSheet><Cell N="PageWidth" V="2"/><Cell N="PageHeight" V="2"/></PageSheet><Rel r:id="rId1"/></Page></Pages>`);
  zip.file('visio/pages/_rels/pages.xml.rels', relationships('page1.xml'));
  zip.file('visio/pages/page1.xml', `<PageContents xmlns="${ns}"><Shapes><Shape ID="10" Type="Group" Master="1"><Shapes><Shape ID="11" Type="Shape" MasterShape="6">${ownFill ? `<Cell N="FillForegnd" V="${ownFill}"/>` : ''}</Shape></Shapes></Shape></Shapes></PageContents>`);
  if (theme) {
    zip.file('visio/theme/theme1.xml', '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:themeElements><a:clrScheme name="test"><a:accent1><a:srgbClr val="336699"/></a:accent1></a:clrScheme></a:themeElements></a:theme>');
  }
  const parsed = await parseVsdx(await zip.generateAsync({ type: 'nodebuffer' }));
  const page = parsed.pages[0];
  const svg = renderPage(page, document.createElement('div'));
  return { shape: page.shapes[0].subShapes[0], svg };
}

const fallback = await drawing();
assert.equal(fallback.shape.fillForeground.toUpperCase(), '#FFFFFF');
assert.equal(fallback.svg.querySelector('#shape11 path[stroke="none"]').getAttribute('fill').toUpperCase(), '#FFFFFF');
assert.equal(fallback.shape.fillBackground, '#000000');

const own = await drawing({ ownFill: '#12ab34' });
assert.equal(own.shape.fillForeground, '#12ab34');
const master = await drawing({ masterFill: '#ab1234' });
assert.equal(master.shape.fillForeground, '#ab1234');
const themed = await drawing({ theme: true });
assert.equal(themed.shape.fillForeground, '#336699');
const background = await drawing({ masterBackground: 'Themed' });
assert.equal(background.shape.fillBackground, '#000000');

console.log('themed-fill: 7 assertions passed (stylesheet fallback, rendered callout, overrides, theme, background)');
