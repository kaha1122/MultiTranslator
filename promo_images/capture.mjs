import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const htmlFile = process.argv[2] || '01_self_directed.html';
const outputFile = process.argv[3] || htmlFile.replace('.html', '.png');

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920, deviceScaleFactor: 1 });

  const filePath = path.resolve(__dirname, htmlFile);
  await page.goto(`file://${filePath}`, { waitUntil: 'networkidle0', timeout: 30000 });

  // 폰트 로드 대기
  await page.evaluate(() => document.fonts.ready);
  await new Promise(r => setTimeout(r, 1000));

  const outputPath = path.resolve(__dirname, outputFile);
  await page.screenshot({ path: outputPath, type: 'png', fullPage: false });

  console.log(`Screenshot saved: ${outputPath}`);
  await browser.close();
})();
