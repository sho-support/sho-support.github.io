import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedProbeClaims} from '../supabase-storage-probe/policy.mjs';
const run='43200000000',sha='a'.repeat(40),now=1794480000;
const claims={repository:'sho-support/sho-support.github.io',repository_id:'1224256882',repository_owner_id:'275386651',ref:'refs/heads/architecture/customer-hosting-v2',event_name:'push',run_attempt:'1',workflow_ref:'sho-support/sho-support.github.io/.github/workflows/customer-hosting-v2-tests.yml@refs/heads/architecture/customer-hosting-v2',run_id:run,sha,workflow_sha:sha,iat:now,exp:now+300};
test('the isolated probe defaults closed and accepts only its exact short-lived CI identity',()=>{
 assert.equal(allowedProbeClaims(claims,'__ALLOWED_RUN_ID__','__ALLOWED_SHA__',now),false);assert.equal(allowedProbeClaims(claims,run,sha,now),true);
 for(const changed of [{repository:'someone/fork'},{repository_id:'0'},{repository_owner_id:'0'},{ref:'refs/heads/main'},{event_name:'pull_request'},{run_attempt:'2'},{workflow_ref:'other-workflow'},{run_id:'43200000001'},{sha:'b'.repeat(40)},{workflow_sha:'b'.repeat(40)},{iat:now-601},{exp:now-1},{exp:now+601}])assert.equal(allowedProbeClaims({...claims,...changed},run,sha,now),false);
});
