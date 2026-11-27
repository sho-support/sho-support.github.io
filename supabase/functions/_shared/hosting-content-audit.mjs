// Conservative first-sale static-site policy. This is a deny-list review aid, not a JS sandbox.
// Tenant origin isolation and keeping every account/session secret out of the site are essential.
export function auditHostedContent(files){
  const errors=[];
  for(const f of files){
    if(!/\.(?:html?|css|m?js|json|svg)$/i.test(f.path))continue;
    const s=typeof f.content==='string'?f.content:new TextDecoder('utf-8',{fatal:true}).decode(f.content);
    const rules=[
      [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{24,}|sb_secret_[A-Za-z0-9_-]{20,})\b/,'credential-like value'],
      [/https?:\/\/[^\s"'<>]*\.supabase\.co\b/i,'backend project URL'],
      [/\b(?:document\s*\.\s*cookie|localStorage|sessionStorage|indexedDB|serviceWorker)\b/i,'browser account/storage access'],
      [/\b(?:eval\s*\(|new\s+Function\s*\(|importScripts\s*\(|import\s*\()/i,'dynamic code execution'],
      [/\b(?:fetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon\s*\()/i,'unreviewed script network access'],
      [/<script\b[^>]*\bsrc\s*=\s*["']\s*(?:https?:|\/\/|data:)/i,'external script'],
      [/\b(?:javascript|vbscript)\s*:/i,'executable link'],
      [/<(?:iframe|object|embed)\b[^>]*(?:src|data)\s*=\s*["']\s*(?:data:|javascript:)/i,'executable embedded document'],
      [/\b(?:srcdoc|onerror)\s*=/i,'unreviewed executable HTML attribute']
    ];
    for(const [pattern,reason] of rules)if(pattern.test(s))errors.push({path:f.path,reason});
  }
  if(errors.length)throw new Error('Hosted content needs security review: '+errors.map(e=>e.path+' ('+e.reason+')').join('; '));
  return {ok:true,policy:'static-site-first-sale-v1',files:files.length};
}
