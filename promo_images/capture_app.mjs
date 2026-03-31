import puppeteer from 'puppeteer';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 앱의 Vocab 탭 화면을 캡처 (로그인 없이 UI만)
(async () => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // 모바일 사이즈
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  await page.goto('https://multi-translator-seven.vercel.app', {
    waitUntil: 'networkidle2',
    timeout: 30000
  });

  // 잠시 대기
  await new Promise(r => setTimeout(r, 3000));

  const outputPath = path.resolve(__dirname, 'app_screen_capture.png');
  await page.screenshot({ path: outputPath, type: 'png' });
  console.log(`App screen captured: ${outputPath}`);

  await browser.close();
})();
