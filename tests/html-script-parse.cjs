const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const child=require('node:child_process');
const root=path.resolve('.');
const all=[...fs.readdirSync(root).filter(x=>x.endsWith('.html')).map(x=>path.join(root,x)),...fs.readdirSync(path.join(root,'admin')).filter(x=>x.endsWith('.html')).map(x=>path.join(root,'admin',x))];
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sho-html-js-'));let tested=0,errors=[];
try{
 for(const file of all){
  const content=fs.readFileSync(file,'utf8');
  for(const m of content.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
   if(/\bsrc\s*=|\btype\s*=\s*['"]application\/ld\+json/i.test(m[1])||!m[2].trim())continue;
   const ext=/type\s*=\s*['"]module['"]/i.test(m[1])?'.mjs':'.cjs';
   const target=path.join(dir,'script-'+tested+ext);
   fs.writeFileSync(target,m[2]);
   try{child.execFileSync(process.execPath,['--check',target],{stdio:'pipe'});}
   catch(e){errors.push(path.relative(root,file)+': '+String(e.stderr||e.message).slice(0,450));}
   tested++;
  }
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('INLINE JAVASCRIPT SYNTAX PASS; scripts='+tested+', html pages='+all.length);
}catch(e){console.error('INLINE JAVASCRIPT SYNTAX FAIL',e.message);process.exitCode=1}
finally{fs.rmSync(dir,{recursive:true,force:true})}
