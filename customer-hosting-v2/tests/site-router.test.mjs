import test from "node:test";
import assert from "node:assert/strict";
import {handleCustomerRequest} from "../src/site-router.mjs";
const a="aaaaaaaaaaaa",b="bbbbbbbbbbbb";
const host="https://sites.sho-support.com";
class MockObject {
  constructor(body){this.body=new TextEncoder().encode(body);this.size=this.body.byteLength;this.httpEtag='"fixture"'}
  async text(){return new TextDecoder().decode(this.body)}
}
const storage=new Map([
  ["sites/1000/active.json",JSON.stringify({release:a,status:"live"})],
  ["sites/1000/releases/"+a+"/index.html","<h1>Customer 1000</h1><a href='assets/app.js'>Open</a>"],
  ["sites/1000/releases/"+a+"/assets/app.js","console.log('1000')"],
  ["sites/1001/active.json",JSON.stringify({release:b,status:"live"})],
  ["sites/1001/releases/"+b+"/index.html","<h1>Customer 1001</h1>"],
  ["sites/1002/active.json",JSON.stringify({release:a,status:"draft"})],
  ["sites/1002/releases/"+a+"/index.html","UNAPPROVED"],
  ["sites/1003/active.json",JSON.stringify({release:"../../bad",status:"live"})]
]);
const calls=[];
const env={PUBLIC_HOSTNAME:"sites.sho-support.com",SITES:{async get(key){calls.push(key);const value=storage.get(key);return value===undefined?null:new MockObject(value)}}};
const fetchSite=(path,opt={})=>handleCustomerRequest(new Request(host+path,opt),env);
test("published customer is served only under own stable URL",async()=>{
  const r=await fetchSite("/1000/");
  assert.equal(r.status,200);
  assert.match(await r.text(),/Customer 1000/);
  assert.match(r.headers.get("Content-Type"),/text\/html/);
});
test("per-site assets come from same active release",async()=>{
  assert.equal(await (await fetchSite("/1000/assets/app.js")).text(),"console.log('1000')");
  assert.equal((await fetchSite("/1000/assets/app.js")).headers.get("Content-Type"),"text/javascript; charset=utf-8");
});
test("customer sites cannot read one another's files",async()=>{
  assert.match(await (await fetchSite("/1001/")).text(),/Customer 1001/);
  assert.equal((await fetchSite("/1001/assets/app.js")).status,404);
});
test("canonical site path has trailing slash so relative links work",async()=>{
  const r=await fetchSite("/1000",{redirect:"manual"});assert.equal(r.status,308);
  assert.equal(r.headers.get("location"),host+"/1000/");
});
test("draft site is never published",async()=>assert.equal((await fetchSite("/1002/")).status,404));
test("missing or malformed release ID is hidden",async()=>assert.equal((await fetchSite("/1003/")).status,404));
test("unknown ID is 404",async()=>assert.equal((await fetchSite("/9000/")).status,404));
test("non-numeric ID is 404",async()=>assert.equal((await fetchSite("/site-1000/")).status,404));
test("hidden and traversal files cannot be served",async()=>{
  for(const p of ["/1000/.env","/1000/foo/.hidden","/1000/foo//bad","/1000/..%2Fsecret","/1000/%5Csecret","/1000/x%20y"]){
    assert.equal((await fetchSite(p)).status,404,p)
  }
});
test("unsupported asset types are not served",async()=>{
  storage.set("sites/1000/releases/"+a+"/.git","secret");
  assert.equal((await fetchSite("/1000/.git")).status,404);
  storage.set("sites/1000/releases/"+a+"/secret.exe","secret");
  assert.equal((await fetchSite("/1000/secret.exe")).status,404);
});
test("POST cannot modify site",async()=>assert.equal((await fetchSite("/1000/",{method:"POST"})).status,405));
test("HEAD returns metadata without body",async()=>{
  const r=await fetchSite("/1000/",{method:"HEAD"});
  assert.equal(r.status,200);assert.equal(await r.text(),"");
});
test("pages.dev or lookalike hostname never shows customer data",async()=>{
  const r=await handleCustomerRequest(new Request("https://demo.pages.dev/1000/"),env);
  assert.equal(r.status,404)
});
test("public HTML must not be cached immutably",async()=>{
  const r=await fetchSite("/1000/");assert.equal(r.headers.get("Cache-Control"),"no-cache, must-revalidate");
});
test("release switching changes content without changing URL",async()=>{
  const previous=storage.get("sites/1000/active.json");
  try{
    storage.set("sites/1000/releases/"+b+"/index.html","<h1>Updated without URL change</h1>");
    storage.set("sites/1000/active.json",JSON.stringify({release:b,status:"live"}));
    const r=await fetchSite("/1000/");
    assert.match(await r.text(),/Updated without URL change/);
  }finally{storage.set("sites/1000/active.json",previous)}
});
test("rollback changes manifest only, not public URL",async()=>{
  const r=await fetchSite("/1000/");assert.match(await r.text(),/Customer 1000/);
});
test("external origin is not trusted without a hostname match",async()=>{
  const r=await handleCustomerRequest(new Request("https://sites.sho-support.com.evil.test/1000/"),env);
  assert.equal(r.status,404);
});
