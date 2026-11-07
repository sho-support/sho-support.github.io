import test from "node:test";
import assert from "node:assert/strict";
import {handleCustomerRequest} from "../src/site-router.mjs";
const a="aaaaaaaaaaaa",b="bbbbbbbbbbbb";
const host="https://s1000.sho-support.com";
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
const env={SITES:{async get(key){const value=storage.get(key);return value===undefined?null:new MockObject(value)}}};
const req=(url,options={})=>handleCustomerRequest(new Request(url,options),env);
const home=(path="/",options={})=>req(host+path,options);
test("one customer site per dedicated browser origin",async()=>{
  const r=await home();assert.equal(r.status,200);
  assert.match(await r.text(),/Customer 1000/);
  assert.match(r.headers.get("Content-Type"),/text\/html/);
});
test("per-customer relative assets are served at root",async()=>{
  assert.equal(await (await home("/assets/app.js")).text(),"console.log('1000')");
  assert.equal((await home("/assets/app.js")).headers.get("Content-Type"),"text/javascript; charset=utf-8");
});
test("customers cannot address another site through its hostname",async()=>{
  const other=await req("https://s1001.sho-support.com/");
  assert.match(await other.text(),/Customer 1001/);
  assert.equal((await req("https://s1001.sho-support.com/assets/app.js")).status,404);
});
test("free URL always remains the same across content releases",async()=>{
  const before=await home();const previous=storage.get("sites/1000/active.json");
  try{
    storage.set("sites/1000/releases/"+b+"/index.html","<h1>New version</h1>");
    storage.set("sites/1000/active.json",JSON.stringify({release:b,status:"live"}));
    const after=await home();assert.equal(after.status,200);assert.match(await after.text(),/New version/);
    assert.match(await before.text(),/Customer 1000/);
  }finally{storage.set("sites/1000/active.json",previous)}
});
test("private draft never leaks",async()=>assert.equal((await req("https://s1002.sho-support.com/")).status,404));
test("invalid release pointer never leaks",async()=>assert.equal((await req("https://s1003.sho-support.com/")).status,404));
test("unregistered customer returns 404",async()=>assert.equal((await req("https://s9999.sho-support.com/")).status,404));
test("non-customer hostname returns 404",async()=>assert.equal((await req("https://shop.sho-support.com/")).status,404));
test("site ID path does not select another customer",async()=>assert.equal((await home("/1001/")).status,404));
test("hidden, unexpected and traversal paths cannot be served",async()=>{
 for(const path of ["/.env","/a/.secret","/a//b","/..%2Fsecret","/%5Csecret","/x%20y"]){
   assert.equal((await home(path)).status,404,path)
 }
});
test("unsupported types are blocked",async()=>{
 storage.set("sites/1000/releases/"+a+"/evil.exe","evil");
 assert.equal((await home("/evil.exe")).status,404);
});
test("POST cannot modify content",async()=>assert.equal((await home("/",{method:"POST"})).status,405));
test("HEAD returns headers with no body",async()=>{
 const r=await home("/",{method:"HEAD"});assert.equal(r.status,200);assert.equal(await r.text(),"");
});
test("pages.dev previews cannot serve customer files",async()=>{
 assert.equal((await req("https://preview.pages.dev/")).status,404);
});
test("lookalike subdomain is refused",async()=>{
 assert.equal((await req("https://s1000.sho-support.com.evil.test/")).status,404);
});
test("public HTML is not immutable cached",async()=>{
 assert.equal((await home()).headers.get("Cache-Control"),"no-cache, must-revalidate");
});
test("manifest rollback retains previous URL",async()=>{
 assert.match(await (await home()).text(),/Customer 1000/);
});
