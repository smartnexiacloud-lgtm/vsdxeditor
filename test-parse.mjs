// Quick Node.js test of the parser logic using jsdom-like approach
// We test the ZIP extraction and XML structure, not the DOM rendering

import JSZip from 'jszip';
import { readFileSync } from 'fs';

const files = ['test-files/test9_rect_and_line.vsdx', 'test-files/test3_house.vsdx', 'test-files/test4_connectors.vsdx'];

for (const f of files) {
  console.log(`\n=== ${f} ===`);
  const buf = readFileSync(f);
  const zip = await JSZip.loadAsync(buf);

  const pagesXml = await zip.file('visio/pages/pages.xml')?.async('string');
  if (!pagesXml) { console.log('No pages.xml'); continue; }

  // Count pages
  const pageMatches = pagesXml.match(/<Page /g);
  console.log(`Pages found: ${pageMatches?.length || 0}`);

  // List page files
  const pageFiles = [];
  zip.forEach((path) => {
    if (path.match(/visio\/pages\/page\d+\.xml$/i)) pageFiles.push(path);
  });
  console.log(`Page files: ${pageFiles.join(', ')}`);

  for (const pf of pageFiles) {
    const content = await zip.file(pf)?.async('string');
    const shapeCount = (content.match(/<Shape /g) || []).length;
    const geoCount = (content.match(/N='Geometry'/g) || content.match(/N="Geometry"/g) || []).length;
    console.log(`  ${pf}: ${shapeCount} shapes, ${geoCount} geometry sections`);
  }

  // List masters
  const masterFiles = [];
  zip.forEach((path) => {
    if (path.match(/visio\/masters\/master\d+\.xml$/i)) masterFiles.push(path);
  });
  console.log(`Master files: ${masterFiles.join(', ')}`);
}

console.log('\nAll files parsed successfully!');
