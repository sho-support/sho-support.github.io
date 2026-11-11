const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const {chromium} = require('playwright');
const target = require('../customer-hosting-v2/preview-target.json');

(async()=>{
  assert.equal(target.worker_host,'sho-customer-sites-preview.zodiac-suu.workers.dev');
  const dir=process.env.QA_SCREENSHOTS_DIR || '/tmp/sho-live-preview-screenshots';
  await fs.mkdir(dir,{recursive:true});
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [320,360,390,430,768,1366]) {
      const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
      const failures=[];
      page.on('pageerror',error=>failures.push(error.message));
      page.on('requestfailed',request=>failures.push(request.url()));
      const response=await page.goto('https://'+target.worker_host,{waitUntil:'networkidle',timeout:30000});
      assert.equal(response.status(),200);
      assert.match(response.headers()['x-robots-tag'],/noindex/);
      await assert.doesNotReject(()=>page.locator('h1').waitFor({state:'visible'}));
      const rendering=await page.evaluate(()=>({
        overflow:document.documentElement.scrollWidth>innerWidth,
        stylesheet:document.styleSheets.length,
        label:document.querySelector('[data-release-label]')?.dataset.releaseLabel,
        fixture:document.querySelector('meta[name="sho-test-fixture"]')?.content,
        buttons:[...document.querySelectorAll('button,a,input')].length
      }));
      assert.equal(rendering.overflow,false,`Horizontal overflow at ${width}px`);
      assert.equal(rendering.stylesheet,1);
      assert.equal(rendering.label,'A');
      assert.equal(rendering.fixture,'SHO_RESERVED_PREVIEW_FIXTURE_V1');
      assert.equal(rendering.buttons,0);
      assert.deepEqual(failures,[]);
      await page.screenshot({path:`${dir}/preview-${width}.png`,fullPage:true});
      await page.close();
    }
    console.log('Live HTTPS fixture: six widths passed; screenshots saved; no order or notification requests.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
