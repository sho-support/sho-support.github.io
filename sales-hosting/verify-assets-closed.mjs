const base='https://tyhymvgjkoebetyypspj.supabase.co/functions/v1/';
const targets=['website-backup-crypto-check','website-private-assets-backup','website-production-r2-check','website-resource-qa'];
const results=[];
for(const target of targets){
 const statuses=[];
 for(const request of [{method:'GET'},{method:'POST',headers:{'content-type':'application/json'},body:'{}'},{method:'GET',headers:{origin:'https://example.invalid'}}]){
  const response=await fetch(base+target,{...request,redirect:'error',signal:AbortSignal.timeout(15000)});
  statuses.push(response.status);await response.body?.cancel();
 }
 results.push({target,statuses,closed:statuses.every(status=>status===403)});
}
const proof={purpose:'private-backup-endpoints-closed',source_commit:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,ok:results.every(x=>x.closed),endpoints:results,credentials_used:false,source_data_changed:false};
console.log('HP_BACKUP_ENDPOINTS_CLOSED',JSON.stringify(proof));if(!proof.ok)process.exitCode=1;
