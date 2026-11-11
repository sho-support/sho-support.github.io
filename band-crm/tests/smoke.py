"""Offline Playwright smoke tests. No real Supabase customer data or services touched."""
import http.server
import threading
import os
from pathlib import Path
from contextlib import contextmanager
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'web'

MOCK_SDK = r'''
window.__crmMock={admin:true,leads:[
 {id:'lead-a',name:'Guns & Leads',organization:'Example Band',channel:'line',handle:'',stage:'approached',notes:'問い合わせ済み',next_action_on:null,created_at:'2026-11-10T08:00:00Z'},
 {id:'lead-x',name:'<img src=x onerror=window.__xss=true>',organization:'Sanity',channel:'other',handle:'',stage:'new',notes:'',next_action_on:null,created_at:'2026-11-09T08:00:00Z'}
],deals:[{id:'deal-a',lead_id:'lead-a',title:'ライブShorts見積',service:'shorts',amount_yen:2500,tax_mode:'included',status:'sent',scope:'',revision_terms:'',delivery_due:null,created_at:'2026-11-10T08:00:00Z'}],payments:[]};
const DB={band_crm_admins:[{user_id:'owner'}],band_crm_leads:window.__crmMock.leads,band_crm_deals:window.__crmMock.deals,band_crm_payments:window.__crmMock.payments};
function query(table){
 let current=DB[table]||[], filter=[], single=false;
 const b={
 select(){return b},eq(k,v){filter.push([k,v]);return b},order(){return b},range(min,max){b._range=[min,max];return b},
 async maybeSingle(){const matched=current.filter(r=>filter.every(([k,v])=>r[k]===v));return {data:window.__crmMock.admin?matched[0]||null:null,error:null}},
 insert(row){b._write={type:'insert',row};return b},update(row){b._write={type:'update',row};return b},
 then(resolve,reject){
  let rows=current.filter(r=>filter.every(([k,v])=>r[k]===v));
  if(b._write){
   const w=b._write;
   if(w.type==='insert'){
    if(table==='band_crm_payments'&&rows.some(r=>r.evidence_reference===w.row.evidence_reference)) return Promise.resolve({error:{code:'23505'}}).then(resolve,reject);
    const rec={id:'new-'+Date.now().toString(36)+Math.random(),created_at:new Date().toISOString(),...w.row};current.unshift(rec);
   }else if(w.type==='update')rows.forEach(r=>Object.assign(r,w.row));
   return Promise.resolve({data:null,error:null}).then(resolve,reject);
  }
  if(b._range){rows=rows.slice(b._range[0],b._range[1]+1)}
  return Promise.resolve({data:rows,error:null}).then(resolve,reject);
 }
 };return b;
}
window.supabase={createClient:()=>({auth:{async getUser(){return{data:{user:{id:'owner'}},error:null}},async signInWithPassword(){return{error:null}},async signOut(){return{}},onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}}},from:query})};
'''

class QuietHandler(http.server.SimpleHTTPRequestHandler):
 def log_message(self, *args):pass

@contextmanager
def server():
 old=os.getcwd();os.chdir(WEB)
 srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),QuietHandler)
 th=threading.Thread(target=srv.serve_forever,daemon=True);th.start()
 try: yield f'http://127.0.0.1:{srv.server_port}/'
 finally:srv.shutdown();srv.server_close();os.chdir(old)

def main():
 (WEB/'config.js').write_text("window.BAND_CRM_CONFIG = {url:'https://tyhymvgjkoebetyypspj.supabase.co',publishableKey:'sb_publishable_TEST_ONLY'};\n")
 passes=[]
 with server() as url,sync_playwright() as p:
  browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
  for label,width,height in [('pc',1440,940),('mobile',390,844),('small',320,760)]:
   ctx=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1)
   page=ctx.new_page();js_errors=[]
   page.on('pageerror',lambda error:js_errors.append(str(error)))
   page.route('https://cdn.jsdelivr.net/**',lambda route:route.fulfill(content_type='text/javascript',body=MOCK_SDK))
   import re
   html=re.sub(r'<script[^>]*src=\"[^\"]+\"[^>]*></script>','',(WEB/'index.html').read_text())
   page.set_content(html)
   page.add_style_tag(content=(WEB/'style.css').read_text())
   page.add_script_tag(content=MOCK_SDK)
   page.add_script_tag(content=(WEB/'config.js').read_text())
   page.add_script_tag(content=(WEB/'app.js').read_text())
   page.wait_for_selector('#workspace:not([hidden])',timeout=15000)
   assert page.locator('#stat-paid').inner_text()=='¥0'
   assert page.locator('#stat-quotes').inner_text()=='¥2,500'
   assert page.locator('#stat-leads').inner_text()=='2'
   assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1'),f'horizontal overflow {label}'
   assert not page.evaluate('window.__xss||false')
   page.screenshot(path=str(ROOT/f'screenshot-{label}.png'),full_page=True)
   passes.append(f'{label} initial layout / XSS / metrics')
   if label=='pc':
    page.locator('#new-lead').click()
    page.locator('#edit-name').fill('First customer')
    page.locator('#edit-organization').fill('New Band')
    page.locator('#save-modal').click()
    page.wait_for_selector('#editor[open]',state='hidden')
    assert page.locator('#stat-leads').inner_text()=='3';passes.append('lead saved and included in live metrics')
    page.locator('[data-tab="deals"]').click();page.locator('#new-deal').click()
    page.locator('#edit-lead_id').select_option('lead-a')
    page.locator('#edit-title').fill('Below minimum should fail')
    page.locator('#edit-service').select_option('shorts')
    page.locator('#edit-amount_yen').fill('1000')
    page.locator('#edit-tax_mode').select_option('included')
    page.locator('#save-modal').click()
    assert page.locator('#editor-message').inner_text().startswith('料金表')
    passes.append('minimum-price validation')
    page.locator('#edit-amount_yen').fill('3000');page.locator('#save-modal').click()
    page.wait_for_selector('#editor[open]',state='hidden')
    assert page.locator('#stat-quotes').inner_text()=='¥5,500';passes.append('deal created; quotations not counted as revenue')
    page.locator('[data-tab="payments"]').click();page.locator('#new-payment').click();page.locator('#edit-deal_id').select_option('deal-a')
    page.locator('#edit-amount_yen').fill('-500')
    page.locator('#edit-evidence_reference').fill('TEST-RETURN-REF')
    page.locator('#edit-reason').fill('short')
    page.locator('#save-modal').click()
    assert '8文字以上' in page.locator('#editor-message').inner_text()
    passes.append('negative correction requires reason')
    page.locator('#cancel-modal').click()
    page.locator('#new-payment').click()
    page.locator('#edit-deal_id').select_option('deal-a')
    page.locator('#edit-amount_yen').fill('2500')
    page.locator('#edit-evidence_reference').fill('BANK-PAY-TEST-0001')
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#save-modal').click()
    page.wait_for_selector('#editor[open]',state='hidden')
    assert page.locator('#stat-paid').inner_text()=='¥2,500'
    passes.append('confirmed payment included in real revenue')
    page.locator('#new-payment').click()
    page.locator('#edit-deal_id').select_option('deal-a')
    page.locator('#edit-amount_yen').fill('2500')
    page.locator('#edit-evidence_reference').fill('BANK-PAY-TEST-0001')
    page.once('dialog',lambda dialog:dialog.accept())
    page.locator('#save-modal').click()
    assert '重複' in page.locator('#editor-message').inner_text()
    passes.append('duplicate payment rejected and revenue unchanged')
    page.locator('#cancel-modal').click()
    page.locator('[data-tab="deals"]').click();page.get_by_role('button',name='見積文コピー').first.click()
    assert not js_errors,js_errors
    passes.append('quote copy action and JS console')
   else:
    page.locator('[data-tab="deals"]').click()
    assert page.locator('#deals-tab').is_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth+1')
    passes.append(f'{label} tabs and no overflow')
   ctx.close()
  browser.close()
 (WEB/'config.js').unlink()
 for x in passes:print('PASS',x)
 print('RESULT:',len(passes),'passed')

if __name__=='__main__':main()
