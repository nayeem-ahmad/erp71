const { chromium } = require('playwright');
const path = require('path');

async function runTest() {
  console.log('Launching browser...');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 }
  });

  // Setup logging helper
  const setupPageLogging = (page) => {
    page.on('console', msg => {
      console.log(`[BROWSER CONSOLE] ${msg.type().toUpperCase()}: ${msg.text()}`);
    });
    page.on('pageerror', err => {
      console.error('[BROWSER ERROR]', err);
    });
    page.on('requestfailed', request => {
      console.log(`[REQUEST FAILED] ${request.method()} ${request.url()} - ${request.failure()?.errorText || 'Unknown error'}`);
    });
    page.on('response', response => {
      const status = response.status();
      if (status >= 400) {
        console.log(`[BAD RESPONSE] ${response.request().method()} ${response.url()} -> Status ${status}`);
      }
    });
  };

  // --- PART 1: Login using demo@erp71.com / demo123456 ---
  console.log('\n--- PART 1: Testing Manual Login ---');
  const page1 = await context.newPage();
  setupPageLogging(page1);

  console.log('Navigating to https://erp71-frontend.onrender.com/login ...');
  await page1.goto('https://erp71-frontend.onrender.com/login', { 
    waitUntil: 'networkidle',
    timeout: 60000 
  });

  console.log('Filling demo credentials (demo@erp71.com / demo123456)...');
  await page1.locator('input[type="email"], input[name="email"], #email').first().fill('demo@erp71.com');
  await page1.locator('input[type="password"], input[name="password"], #password').first().fill('demo123456');

  const screenshotManualPath1 = path.join(__dirname, 'manual_login_input.png');
  await page1.screenshot({ path: screenshotManualPath1 });
  console.log('Saved screenshot of manual login inputs to:', screenshotManualPath1);

  console.log('Clicking Sign In...');
  await page1.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")').first().click();

  console.log('Waiting 10 seconds for login transition...');
  await page1.waitForTimeout(10000);

  console.log('Current URL after manual login attempt:', page1.url());
  const screenshotManualPath2 = path.join(__dirname, 'manual_login_after.png');
  await page1.screenshot({ path: screenshotManualPath2 });
  console.log('Saved screenshot after manual login to:', screenshotManualPath2);
  await page1.close();

  // --- PART 2: Try Demo auto-login ---
  console.log('\n--- PART 2: Testing "Try Demo" auto-login ---');
  const page2 = await context.newPage();
  setupPageLogging(page2);

  console.log('Navigating to https://erp71-frontend.onrender.com/login ...');
  await page2.goto('https://erp71-frontend.onrender.com/login', { 
    waitUntil: 'networkidle',
    timeout: 60000 
  });

  const screenshotDemoPath1 = path.join(__dirname, 'demo_login_before.png');
  await page2.screenshot({ path: screenshotDemoPath1 });
  console.log('Saved screenshot of page before clicking "Try Demo" to:', screenshotDemoPath1);

  console.log('Clicking "Try Demo" button...');
  await page2.locator('button:has-text("Try Demo")').first().click();

  console.log('Waiting 10 seconds for demo login transition...');
  await page2.waitForTimeout(10000);

  console.log('Current URL after demo login attempt:', page2.url());
  const screenshotDemoPath2 = path.join(__dirname, 'demo_login_after.png');
  await page2.screenshot({ path: screenshotDemoPath2 });
  console.log('Saved screenshot after "Try Demo" to:', screenshotDemoPath2);
  await page2.close();

  await browser.close();
}

runTest().catch(err => {
  console.error('Error running user test:', err);
  process.exit(1);
});
