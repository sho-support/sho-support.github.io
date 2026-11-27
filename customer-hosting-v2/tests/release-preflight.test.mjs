import test from "node:test";
import assert from "node:assert/strict";
import {prepareRelease} from "../src/release-preflight.mjs";
const valid="< !doctype html>".replace("< !","<!")+"<html lang='ja'><head><title>Sample</title></head><body><h1>Site</h1></body></html>";
const files=[{path:"index.html",content:valid},{path:"assets/style.css",content:"body{color:black}"}];
test("site release uses immutable R2 keys and separate live pointer",()=>{
  const out=prepareRelease("1000","aaaaaaaaaaaa",files);
  assert.equal(out.file_count,2);
  assert.equal(out.objects[0].key,"sites/1000/releases/aaaaaaaaaaaa/index.html");
  assert.equal(out.activation.key,"sites/1000/active.json");
  assert.deepEqual(JSON.parse(out.activation.json),{status:"live",release:"aaaaaaaaaaaa"});
});
test("reject wrong customer ID",()=>assert.throws(()=>prepareRelease("site1000","aaaaaaaaaaaa",files)));
test("reject wrong release token",()=>assert.throws(()=>prepareRelease("1000","../../main",files)));
test("reject missing entry point",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",files.slice(1))));
test("reject duplicate asset path",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[files[0],files[0]])));
test("reject unsafe root path",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[files[0],{path:"/secret.html",content:valid}])));
test("reject traversal path",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[files[0],{path:"assets/../admin.js",content:"a"}])));
test("reject directory-invisible file",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[files[0],{path:".env",content:"secret"}])));
test("reject unsupported executable",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[files[0],{path:"malware.exe",content:"xx"}])));
test("reject empty images",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[files[0],{path:"photo.webp",content:new Uint8Array(0)}])));
test("reject legacy per-customer GitHub Pages URLs",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[{path:"index.html",content:valid+"https://sho-support.github.io/site-1000/"}])));
test("reject legacy Netlify management URLs embedded in customers",()=>assert.throws(()=>prepareRelease("1000","aaaaaaaaaaaa",[{path:"index.html",content:valid+"https://sho-web-support.netlify.app/website-portal.html"}])));
test("prepareRelease itself does not set any live storage",()=>{
  const out=prepareRelease("1000","aaaaaaaaaaaa",files);
  assert.equal(typeof out.activation.json,"string");
  assert.equal(out.objects.length,2);
});

test('binary HTML passes through the same structure and URL checks',()=>{
 const content=new TextEncoder().encode(valid+'https://sho-support.github.io/site-1000/');
 assert.throws(()=>prepareRelease('1000','aaaaaaaaaaaa',[{path:'index.html',content}]),/provider URL/);
 assert.throws(()=>prepareRelease('1000','aaaaaaaaaaaa',[{path:'index.html',content:new Uint8Array([255])}]));
});

test('the old tracking dependency is rejected in scripts as well as HTML',()=>{
 assert.throws(()=>prepareRelease('1000','aaaaaaaaaaaa',[
   files[0],{path:'app.js',content:'import("https://sho-support.github.io/website-track.js")'}
 ]),/provider URL/);
});
