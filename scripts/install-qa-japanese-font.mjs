// Test-runner font only. No production asset or application setting is changed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';

const size=16467736, blob='f56224957fb13a81b4c14bac34f2f058a017f9fb';
const response=await fetch('https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTF/Japanese/NotoSansCJKjp-Regular.otf',{
  redirect:'error',signal:AbortSignal.timeout(60000)
});
assert.equal(response.status,200,'Japanese QA font download failed');
const bytes=new Uint8Array(await response.arrayBuffer());
assert.equal(bytes.byteLength,size);
assert.equal(createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex'),blob,'Pinned official font blob differs');
const dir=join(homedir(),'.local/share/fonts/sho-qa');
await mkdir(dir,{recursive:true});
await writeFile(join(dir,'NotoSansCJKjp-Regular.otf'),bytes);
execFileSync('fc-cache',['-f',dir],{stdio:'pipe',timeout:20000});
const family=execFileSync('fc-list',[':lang=ja','--format=%{family}\n'],{encoding:'utf8',timeout:5000});
assert.match(family,/Noto Sans CJK JP/,'Japanese QA font is unavailable to the browser');
console.log('Verified pinned Noto Sans CJK JP for Japanese screenshot rendering.');
