const { chromium } = require('playwright');
(async () => { const b = await chromium.launch(); const p = await b.newPage();
await p.goto('file://' + process.argv[2] + '/guia.html'); await p.waitForTimeout(500);
await p.pdf({ path: process.argv[2] + '/Guia-equipo-prospeccion.pdf', format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '18mm', left: '16mm', right: '16mm' } });
await b.close(); })();
