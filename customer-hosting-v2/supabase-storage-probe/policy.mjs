export const PROBE_BUCKET='sho-resource-qa';
export function allowedProbeClaims(c,runId,sha,now=Math.floor(Date.now()/1000)){
  return /^\d{8,20}$/.test(runId)&&/^[a-f0-9]{40}$/.test(sha)
    &&c.repository==='sho-support/sho-support.github.io'&&c.repository_id==='1224256882'&&c.repository_owner_id==='275386651'
    &&c.ref==='refs/heads/architecture/customer-hosting-v2'&&c.event_name==='push'&&c.run_attempt==='1'
    &&c.workflow_ref==='sho-support/sho-support.github.io/.github/workflows/customer-hosting-v2-tests.yml@refs/heads/architecture/customer-hosting-v2'
    &&c.run_id===runId&&c.sha===sha&&c.workflow_sha===sha
    &&Number.isInteger(c.exp)&&Number.isInteger(c.iat)&&c.exp>now&&c.exp<=now+600&&c.iat>=now-600&&c.iat<=now+30;
}
