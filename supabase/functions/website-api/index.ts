import { adminClient, corsHeaders, getUser, json, notifyOwner, siteRole, linePush, setGithubPagesDomain, setGithubPagesSource, publishApprovedStagedBranch, verifyWebsiteBeforeDelivery, triggerWebsiteWorker, requireStablePublicationUrl, normalizeCustomerHostname } from './_shared/website.ts';

type Body = {
  action?: string;
  site_id?: string;
  payload?: Record<string, unknown>;
  status?: string;
  current_note?: string;
  detail?: string;
  site_name?: string;
  customer_user_id?: string;
  customer_email?: string;
  repo_full_name?: string;
  publish_branch?: string;
  live_path?: '/' | '/docs';
  offline_path?: '/' | '/docs';
  custom_domain?: string | null;
  review_action?: 'revision' | 'approve' | 'publish';
};

function validSiteId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,32}$/.test(value);
}

const sha256Hex=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const randomReviewKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const addMonths=(base:Date,months:number)=>{const d=new Date(base),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);d.setUTCDate(Math.min(day,new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate()));return d.toISOString();};
async function setOrderFreePeriod(admin:ReturnType<typeof adminClient>,siteId:string,now:Date){const {error}=await admin.from('website_orders').update({update_free_until:addMonths(now,3)}).eq('site_id',siteId).in('plan',['semi','full']);if(error)throw error;}
const paidTemplates=new Set(['rock','cafe','cute','minimal','premium','pop','vintage','cyber','organic','editorial']);
async function normalizePaidIntake(admin:ReturnType<typeof adminClient>,siteId:string,raw:unknown){
  const {data:order,error}=await admin.from('website_orders')
    .select('order_code,plan,template_style').eq('site_id',siteId).maybeSingle();
  if(error)throw error;
  const payload=raw&&typeof raw==='object'&&!Array.isArray(raw)?structuredClone(raw as Record<string,any>):{};
  if(order){
    payload.fields=payload.fields&&typeof payload.fields==='object'?payload.fields:{};
    payload.fields.build_plan=order.plan;
    if(order.plan==='semi'){
      const wanted=String(payload.fields.template_style||'').trim();
      payload.fields.template_style=paidTemplates.has(wanted)?wanted:(order.template_style||'');
    }else payload.fields.template_style='';
  }
  return {payload,order};
}

async function findUserIdByEmail(admin: ReturnType<typeof adminClient>, email: string) {
  const target = email.trim().toLowerCase();
  if (!target) return null;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const found = data.users.find((u) => String(u.email || '').toLowerCase() === target);
    if (found) return found.id;
    if (data.users.length < 100) break;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const admin = adminClient();
    const user = await getUser(req, admin);
    if (!user) return json({ error: 'ログインが必要です。' }, 401);

    const body = (await req.json().catch(() => ({}))) as Body;
    const action = body.action || '';

    if (action === 'list_sites') {
      const { data: adminRow, error: adminError } = await admin
        .from('website_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (adminError) throw adminError;

      if (adminRow) {
        const { data, error } = await admin
          .from('website_sites')
          .select('*')
          .order('updated_at', { ascending: false });
        if (error) throw error;
        return json({ sites: data || [], admin: true });
      }

      const { data: memberships, error: memberError } = await admin
        .from('website_site_users')
        .select('site_id,role')
        .eq('user_id', user.id);
      if (memberError) throw memberError;
      const ids = (memberships || []).map((x) => x.site_id);
      if (!ids.length) return json({ sites: [], admin: false });

      const { data: sites, error: siteError } = await admin
        .from('website_sites')
        .select('*')
        .in('site_id', ids)
        .order('updated_at', { ascending: false });
      if (siteError) throw siteError;
      return json({ sites: sites || [], memberships: memberships || [], admin: false });
    }

    if (action === 'create_site') {
      const { data: adminRow, error: adminError } = await admin
        .from('website_admins')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (adminError) throw adminError;
      if (!adminRow) return json({ error: '管理者権限が必要です。' }, 403);
      if (!validSiteId(body.site_id)) return json({ error: 'SITE IDが不正です。' }, 400);

      let customerUserId = body.customer_user_id || null;
      if (!customerUserId && body.customer_email) {
        customerUserId = await findUserIdByEmail(admin, body.customer_email);
      }

      const { data: duplicateSite, error: duplicateError } = await admin.from('website_sites').select('site_id').eq('site_id',body.site_id).maybeSingle();
      if(duplicateError)throw duplicateError;
      if(duplicateSite)return json({error:'このSITE IDはすでに存在します。公開URLの保護のため既存案件を上書きできません。'},409);
      const { error: siteError } = await admin.from('website_sites').insert({
        site_id: body.site_id,
        site_name: String(body.site_name || ''),
        status: 'request_waiting',
        current_note: 'ヒアリング入力待ち。',
        customer_approved: false,
        repo_full_name: body.repo_full_name || null,
        publish_branch: body.publish_branch || 'main',
        live_path: body.live_path || '/',
        offline_path: body.offline_path || '/docs',
      });
      if (siteError) throw siteError;

      if (customerUserId) {
        const { error: memberError } = await admin.from('website_site_users').upsert({
          site_id: body.site_id,
          user_id: customerUserId,
          role: 'owner',
        }, { onConflict: 'site_id,user_id' });
        if (memberError) throw memberError;
      }

      await admin.from('website_activity').insert({
        site_id: body.site_id,
        actor_type: 'admin',
        actor_user_id: user.id,
        action: 'site_created',
        detail: customerUserId ? '顧客アカウントを紐付けて案件を作成。' : '案件を作成。顧客アカウント未紐付け。',
      });
      return json({ ok: true, site_id: body.site_id, customer_user_id: customerUserId });
    }

    if (!validSiteId(body.site_id)) return json({ error: 'SITE IDが不正です。' }, 400);
    const siteId = body.site_id!;
    const role = await siteRole(admin, user.id, siteId);
    if (!role) return json({ error: 'このSITE IDへのアクセス権がありません。' }, 403);
    const canEdit = role === 'admin' || role === 'owner' || role === 'editor';

    if (action === 'admin_run_worker') {
      if (role !== 'admin') return json({ error: '管理者権限が必要です。' }, 403);
      const { data: latest, error: latestError } = await admin
        .from('website_jobs')
        .select('*')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) throw latestError;
      if (!latest) return json({ error: '実行できるAIジョブがありません。' }, 409);

      let jobId = latest.id;
      if (latest.status === 'error') {
        const { data: retry, error: retryError } = await admin.from('website_jobs').insert({
          site_id: siteId,
          kind: latest.kind,
          status: 'queued',
          instruction: latest.instruction || '最新の依頼内容をもとに再実行してください。',
          payload: { ...(latest.payload || {}), source: 'admin_retry', retry_of: latest.id },
        }).select('id').single();
        if (retryError) throw retryError;
        jobId = retry.id;
      } else if (latest.status === 'running') {
        // Staged generation can be killed by the Edge runtime before it checkpoints.
        // Only the administrator may recover a full-order build older than 3 minutes.
        const stale=!!latest.started_at && (Date.now()-new Date(latest.started_at).getTime()>180000);
        if(stale && latest.kind==='initial_create'){
          const {data:intake,error:intakeErr}=await admin.from('website_intakes').select('payload').eq('site_id',siteId).maybeSingle();
          if(intakeErr)throw intakeErr;
          if(intake?.payload?.fields?.build_plan==='full'){
            const deadline=new Date(Date.now()-180000).toISOString();
            const {data:recovered,error:recoverErr}=await admin.from('website_jobs').update({
              status:'queued',started_at:null,error_message:'実行時間超過を検出し、保存済み工程から再開しました。'
            }).eq('id',latest.id).eq('status','running').lt('started_at',deadline).select('id').maybeSingle();
            if(recoverErr)throw recoverErr;
            if(!recovered)return json({ok:true,status:'running',job_id:latest.id});
          }else return json({ok:true,status:'running',job_id:latest.id});
        }else return json({ok:true,status:'running',job_id:latest.id});
      } else if (latest.status !== 'queued') {
        return json({ error: '現在はAIを再実行する必要がありません。' }, 409);
      }

      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch((error) => console.error('website-worker trigger error', error)));
      return json({ ok: true, status: 'queued', job_id: jobId });
    }

    if(action==='site_view_stats'){
      const {data:site,error:siteError}=await admin.from('website_sites').select('status,published_at').eq('site_id',siteId).single();
      if(siteError)throw siteError;
      if(site.status!=='live'||!site.published_at)return json({site_id:siteId,views_total:0,views_today:0,published:false});
      const {data:rows,error:countError}=await admin.from('website_pageviews').select('view_date,views').eq('site_id',siteId);
      if(countError)throw countError;
      const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
      return json({site_id:siteId,published:true,
        views_total:(rows||[]).reduce((n:number,x:any)=>n+Number(x.views||0),0),
        views_today:Number((rows||[]).find((x:any)=>x.view_date===today)?.views||0)});
    }

    if (action === 'load_site') {
      const [
        { data: site, error: siteError },
        { data: intake, error: intakeError },
        { data: activity, error: activityError },
        { data: jobs, error: jobsError },
        { data: profile, error: profileError },
        { data: updates, error: updatesError },
      ] = await Promise.all([
        admin.from('website_sites').select('*').eq('site_id', siteId).single(),
        admin.from('website_intakes').select('*').eq('site_id', siteId).maybeSingle(),
        admin.from('website_activity').select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(100),
        admin.from('website_jobs').select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(20),
        admin.from('website_profiles').select('*').eq('site_id', siteId).maybeSingle(),
        admin.from('website_update_requests').select('id,status,request_note,billing_category,created_at,files').eq('site_id',siteId).order('created_at',{ascending:false}).limit(30),
      ]);
      if (siteError) throw siteError;
      if (intakeError) throw intakeError;
      if (activityError) throw activityError;
      if (jobsError) throw jobsError;
      if (profileError) throw profileError;
      if (updatesError) throw updatesError;
      let reviewIssues:any[]=[];
      if(role==='admin'){
        const {data:found,error:reviewError}=await admin.from('website_review_issues').select('id,note,status,created_at,updated_at,confirmed_at,job_id').eq('site_id',siteId).order('created_at',{ascending:false}).limit(80);
        if(reviewError)throw reviewError;
        reviewIssues=found||[];
      }
      // Customers and collaborators must not read unapproved staged HTML, private
      // preview URLs or operational job payloads before SHO's quality gate.
      const publicSite=role==='admin'?site:{
        ...site,
        preview_url:site.status==='customer_review'||site.status==='live'?site.preview_url:null,
        preview_access_token_hash:null,review_access_token_hash:null
      };
      const visibleJobs=role==='admin'?(jobs||[]):(jobs||[]).map((j:any)=>({
        id:j.id,site_id:j.site_id,kind:j.kind,status:j.status,
        created_at:j.created_at,started_at:j.started_at,finished_at:j.finished_at
      }));
      const visibleActivity=role==='admin'?(activity||[]):(activity||[]).filter((x:any)=>
        x.actor_type!=='admin'&&x.action!=='ai_build_error'&&x.action!=='review_issue_requested');
      return json({site:publicSite,intake,activity:visibleActivity,jobs:visibleJobs,profile,updates:updates||[],reviewIssues,role});
    }

    if (action === 'save_draft') {
      if (!canEdit) return json({ error: '編集権限がありません。' }, 403);
      const {data:currentSite,error:stateErr}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();if(stateErr)throw stateErr;
      if(currentSite.status!=='request_waiting')return json({error:'初回ヒアリングは受付終了です。更新依頼は専用の窓口からお願いします。'},409);
      const savedAt = new Date().toISOString();
      const {payload}=await normalizePaidIntake(admin,siteId,body.payload);
      const { error } = await admin.from('website_intakes').upsert({
        site_id: siteId,
        payload,
        last_saved_at: savedAt,
      }, { onConflict: 'site_id' });
      if (error) throw error;
      return json({ ok: true, last_saved_at: savedAt });
    }

    if (action === 'submit_intake') {
      if (!canEdit) return json({ error: '編集権限がありません。' }, 403);
      const {data:currentSite,error:stateErr}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();if(stateErr)throw stateErr;
      if(currentSite.status!=='request_waiting')return json({error:'初回ヒアリングは送信済みです。更新依頼は専用の窓口からお願いします。'},409);
      const submittedAt = new Date().toISOString();
      const {payload,order}=await normalizePaidIntake(admin,siteId,body.payload);
      if(order?.plan==='semi' && payload.fields?.template_style!==order.template_style){
        const {error:templateError}=await admin.from('website_orders').update({
          template_style:payload.fields.template_style,updated_at:submittedAt
        }).eq('order_code',order.order_code).eq('status','site_created');
        if(templateError)throw templateError;
      }
      const { error: intakeError } = await admin.from('website_intakes').upsert({
        site_id: siteId,
        payload,
        last_saved_at: submittedAt,
        submitted_at: submittedAt,
      }, { onConflict: 'site_id' });
      if (intakeError) throw intakeError;

      const { data: site, error: siteError } = await admin
        .from('website_sites')
        .update({
          status: 'building',
          current_note: 'ヒアリング内容を受信。サイト作成中。',
          customer_approved: false,
        })
        .eq('site_id', siteId)
        .eq('status', 'request_waiting')
        .select('site_name')
        .maybeSingle();
      if (siteError) throw siteError;
      if (!site) return json({ error: '制作依頼はすでに送信済みです。二重受付は行いません。' }, 409);

      const intakePayload = payload as Record<string, any>;
      const intakeFields = (intakePayload.fields || {}) as Record<string, any>;
      const intakeChecks = (intakePayload.checks || {}) as Record<string, any>;
      await admin.from('website_profiles').upsert({
        site_id: siteId,
        industry: String(intakeFields.purpose || ''),
        summary: String(intakeFields.image_text || ''),
        preferences: {
          mood: intakeFields.image_text ? [String(intakeFields.image_text)] : [],
          colors: intakeFields.colors ? [String(intakeFields.colors)] : [],
          likes: Array.isArray(intakeChecks.features) ? intakeChecks.features : [],
          dislikes: [],
        },
        decisions: {
          live_layout: Array.isArray(intakeChecks.live_all_page) && intakeChecks.live_all_page.length
            ? 'all_live_on_separate_page'
            : 'upcoming_on_top_history_separate',
          custom_domain_requested: Array.isArray(intakeChecks.custom_domain) && intakeChecks.custom_domain.length > 0,
        },
      }, { onConflict: 'site_id' });

      await admin.from('website_activity').insert({
        site_id: siteId,
        actor_type: 'customer',
        actor_user_id: user.id,
        action: 'intake_submitted',
        detail: 'ヒアリングフォームを送信。',
      });
      await admin.from('website_jobs').insert({
        site_id: siteId,
        kind: 'initial_create',
        status: 'queued',
        instruction: '最新のヒアリング内容をもとにサイトを制作してください。',
        payload: { source: 'intake_submit' },
      });
      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch((error) => console.error('website-worker trigger error', error)));

      await notifyOwner(`【SHO WEB SUPPORT】\nSITE ID ${siteId}\nヒアリングが送信されました。\n${site?.site_name || ''}`);
      return json({ ok: true, submitted_at: submittedAt });
    }

    if (action === 'review_action') {
      if (!canEdit) return json({ error: '操作権限がありません。' }, 403);
      const reviewAction = body.review_action;
      const { data: reviewSite, error: reviewSiteError } = await admin
        .from('website_sites')
        .select('status,customer_approved')
        .eq('site_id', siteId)
        .single();
      if (reviewSiteError) throw reviewSiteError;
      if (!['revision','approve','publish'].includes(String(reviewAction))) {
        return json({ error: 'review_actionが不正です。' }, 400);
      }
      if (reviewSite.status !== 'customer_review') {
        return json({ error: '現在はお客様の最終確認を受け付ける状態ではありません。' }, 409);
      }

      if (reviewAction === 'revision') {
        const detail = String(body.detail || '').trim();
        if (!detail) return json({ error: '修正内容を入力してください。' }, 400);
        const { error } = await admin.from('website_sites').update({
          status: 'building',
          current_note: 'お客様から修正依頼。再作成中。',
          customer_approved: false,
        }).eq('site_id', siteId);
        if (error) throw error;
        await admin.from('website_activity').insert({
          site_id: siteId, actor_type: 'customer', actor_user_id: user.id,
          action: 'customer_revision_requested', detail,
        });
        await admin.from('website_jobs').insert({
          site_id: siteId,
          kind: 'customer_revision',
          status: 'queued',
          instruction: detail,
          payload: { source: 'customer_review' },
        });
        EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch((error) => console.error('website-worker trigger error', error)));
        await notifyOwner(`【修正依頼】SITE ID ${siteId}\n${detail.slice(0, 1200)}`);
        return json({ ok: true, status: 'building' });
      }

      if (reviewAction === 'approve') {
        const { error } = await admin.from('website_sites').update({
          customer_approved: true,
          current_note: 'お客様が内容承認。公開操作待ち。',
        }).eq('site_id', siteId);
        if (error) throw error;
        await admin.from('website_activity').insert({
          site_id: siteId, actor_type: 'customer', actor_user_id: user.id,
          action: 'customer_approved', detail: 'サイト内容を承認。',
        });
        await notifyOwner(`【お客様確認OK】SITE ID ${siteId}\n公開操作待ちです。`);
        return json({ ok: true, customer_approved: true });
      }

      if (reviewAction === 'publish') {
        const { data: site, error: readError } = await admin
          .from('website_sites')
          .select('customer_approved,repo_full_name,publish_branch,preview_branch,live_path,custom_domain,published_at,adjustment_free_until,update_free_until')
          .eq('site_id', siteId)
          .single();
        if (readError) throw readError;
        if (!site.customer_approved || !reviewSite.customer_approved) return json({ error: '先にサイト内容の承認が必要です。' }, 409);
        if (!site.repo_full_name) return json({ error: '公開先GitHub Repoがまだ設定されていません。' }, 409);

        // Verify the durable public hostname BEFORE changing any branch or visibility.
        const verifiedPublicUrl=await requireStablePublicationUrl(site.repo_full_name,site.custom_domain);
        const {data:preflightOrder,error:preflightError}=await admin.from('website_orders').select('plan,template_style').eq('site_id',siteId).maybeSingle();
        if(preflightError)throw preflightError;
        await verifyWebsiteBeforeDelivery(site.repo_full_name,site.preview_branch||site.publish_branch||'main',preflightOrder?.plan==='semi'?String(preflightOrder.template_style||''):'');
        await publishApprovedStagedBranch(site.repo_full_name,site.publish_branch||'main',site.preview_branch);
        await setGithubPagesSource(
          site.repo_full_name,
          site.publish_branch || 'main',
          (site.live_path || '/') as '/' | '/docs',
        );

        const when=new Date(),url=verifiedPublicUrl,first=!site.published_at;
        const {data:order}=await admin.from('website_orders').select('plan').eq('site_id',siteId).maybeSingle();
        const { error } = await admin.from('website_sites').update({
          status:'live',current_note:'サイト公開中。',customer_approved:false,
          public_url:url,preview_url:url,published_at:site.published_at||when.toISOString(),
          adjustment_free_until:first?new Date(when.getTime()+30*86400000).toISOString():site.adjustment_free_until,
          update_free_until:first&&order&&['semi','full'].includes(order.plan)?addMonths(when,3):site.update_free_until,
          review_access_token_hash:null,preview_access_token_hash:null,preview_branch:null,
        }).eq('site_id',siteId);
        if(!error&&first)await setOrderFreePeriod(admin,siteId,when);
        if (error) throw error;
        await admin.from('website_jobs').update({status:'done'}).eq('site_id',siteId).eq('status','sho_review');
        await admin.from('website_update_requests').update({status:'completed'}).eq('site_id',siteId).eq('status','building');
        await admin.from('website_activity').insert({
          site_id: siteId, actor_type: 'customer', actor_user_id: user.id,
          action: 'published', detail: 'お客様が公開操作。',
        });
        await notifyOwner(`【公開】SITE ID ${siteId}\nお客様が公開しました。`);

        const { data: lineLink } = await admin.from('website_line_links').select('line_user_id').eq('site_id', siteId).maybeSingle();
        await linePush(lineLink?.line_user_id, `SITE ID ${siteId} のホームページを公開しました。ご利用ありがとうございます。`);
        return json({ ok: true, status: 'live' });
      }

      return json({ error: 'review_actionが不正です。' }, 400);
    }

    if(action==='admin_secure_preview'){
      if(role!=='admin')return json({error:'管理者権限が必要です。'},403);
      const {data:site,error:siteError}=await admin.from('website_sites').select('status,repo_full_name,publish_branch,published_at').eq('site_id',siteId).single();
      if(siteError)throw siteError;
      if(site.status==='live'||site.published_at)return json({error:'公開済みサイトの公開元はプレビューへ変更できません。'},409);
      if(!site.repo_full_name)return json({error:'GitHub Repoが未設定です。'},409);
      await setGithubPagesSource(site.repo_full_name,site.publish_branch||'main','/docs');
      const key=randomReviewKey(),hash=await sha256Hex(key);
      const url='https://sho-support.github.io/website-preview.html?id='+encodeURIComponent(siteId)+'&key='+key;
      const {error:updateError}=await admin.from('website_sites').update({preview_url:url,preview_access_token_hash:hash,preview_token_issued_at:new Date().toISOString()}).eq('site_id',siteId);
      if(updateError)throw updateError;
      return json({ok:true,preview_url:url,status:'secure_preview'});
    }

    if(action==='admin_start_update'){
      if(role!=='admin')return json({error:'管理者権限が必要です。'},403);
      const requestId=Number((body as any).update_request_id);
      if(!Number.isSafeInteger(requestId)||requestId<1)return json({error:'更新依頼番号が不正です。'},400);
      const {data:reqItem,error:itemErr}=await admin.from('website_update_requests').select('id,status,billing_category,request_note,files').eq('id',requestId).eq('site_id',siteId).maybeSingle();
      if(itemErr)throw itemErr;
      if(!reqItem||reqItem.status!=='pending_sho')return json({error:'この更新依頼は処理待ちではありません。'},409);
      if(reqItem.billing_category==='estimate_required'&&(body as any).payment_confirmed!==true)return json({error:'有料更新は入金確認が必要です。'},409);
      const {data:siteNow,error:siteErr}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();
      if(siteErr)throw siteErr;
      if(siteNow.status!=='live')return json({error:'現在、別の制作・確認が進行しています。'},409);
      const approvedFiles=reqItem.files&&typeof reqItem.files==='object'?reqItem.files:{};
      if(Object.values(approvedFiles).some((v:any)=>Array.isArray(v)&&v.length)){
        const {data:intake,error:intakeErr}=await admin.from('website_intakes').select('payload').eq('site_id',siteId).single();
        if(intakeErr)throw intakeErr;
        const payload=structuredClone(intake.payload||{});
        payload.files=payload.files||{};
        for(const folder of ['top_photos','gallery_photos','logo_file','member_photos']){
          const additions=Array.isArray(approvedFiles[folder])?approvedFiles[folder]:[];
          if(!additions.length)continue;
          const existing=Array.isArray(payload.files[folder])?payload.files[folder]:[];
          const paths=new Set(existing.map((x:any)=>x.path));
          payload.files[folder]=[...existing,...additions.filter((f:any)=>f?.path&&!paths.has(f.path))];
        }
        const {error:mergeErr}=await admin.from('website_intakes').update({payload}).eq('site_id',siteId);
        if(mergeErr)throw mergeErr;
      }
      const {error:updateError}=await admin.from('website_update_requests').update({status:'queued',reviewed_at:new Date().toISOString()}).eq('id',requestId).eq('status','pending_sho');
      if(updateError)throw updateError;
      const {error:siteError}=await admin.from('website_sites').update({status:'building',current_note:'更新依頼 #'+requestId+' の制作中。',customer_approved:false}).eq('site_id',siteId);
      if(siteError)throw siteError;
      const {error:jobError}=await admin.from('website_jobs').insert({site_id:siteId,kind:'customer_update',status:'queued',instruction:reqItem.request_note,payload:{source:'customer_update',update_request_id:requestId}});
      if(jobError)throw jobError;
      await admin.from('website_activity').insert({site_id:siteId,actor_type:'admin',actor_user_id:user.id,action:'update_approved',detail:'更新依頼 #'+requestId+' をAI制作に送信。'});
      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch(e=>console.error('worker trigger failed',e)));
      return json({ok:true,request_id:requestId,status:'queued'});
    }

    if (action === 'admin_repo_config') {
      if (role !== 'admin') return json({ error: '管理者権限が必要です。' }, 403);
      const repoFullName = String(body.repo_full_name || '').trim();
      if (repoFullName && !/^[^/]+\/[^/]+$/.test(repoFullName)) return json({ error: 'GitHub Repo名が不正です。' }, 400);
      const {data:currentSite,error:currentSiteError}=await admin.from('website_sites').select('published_at,status').eq('site_id',siteId).single();
      if(currentSiteError)throw currentSiteError;
      if(currentSite.published_at || ['live','private','improving_private'].includes(String(currentSite.status)))
        return json({error:'公開済みサイトのRepo・公開元は、この画面から変更できません。URLを維持する移行手順が必要です。'},409);
      const { error } = await admin.from('website_sites').update({
        repo_full_name: repoFullName || null,
        publish_branch: body.publish_branch || 'main',
        live_path: body.live_path || '/',
        offline_path: body.offline_path || '/docs',
      }).eq('site_id', siteId);
      if (error) throw error;
      return json({ ok: true });
    }

    if (action === 'admin_domain') {
      if (role !== 'admin') return json({ error: '管理者権限が必要です。' }, 403);
      const { data: site, error: readError } = await admin
        .from('website_sites')
        .select('repo_full_name,published_at,status,custom_domain,publish_branch,offline_path')
        .eq('site_id', siteId)
        .single();
      if (readError) throw readError;
      if (!site.repo_full_name) return json({ error: '公開先GitHub Repoがまだ設定されていません。' }, 409);
      // Once a URL has appeared on customers' signs/cards, never silently mutate it.
      if(site.published_at || ['live','private','improving_private'].includes(String(site.status)))
        return json({error:'公開後のドメイン変更は名刺・看板などのURLに影響するため、個別の移行手続きが必要です。既存URLを維持してください。'},409);
      const domain = body.custom_domain ? normalizeCustomerHostname(body.custom_domain) : null;
      const {data:contractOrder,error:contractError}=await admin.from('website_orders')
        .select('selections').eq('site_id',siteId).maybeSingle();
      if(contractError)throw contractError;
      const agreedDomain=String(contractOrder?.selections?.final_public_domain||'').trim().toLowerCase();
      if(agreedDomain&&domain!==agreedDomain)
        return json({error:'このURLは契約時にお客様へ案内した正式URLと異なります。名刺・看板への影響を避けるため、勝手に変更できません。'},409);
      if(domain){
        const {data:alreadyUsed,error:duplicateErr}=await admin.from('website_sites')
          .select('site_id').eq('custom_domain',domain).neq('site_id',siteId).limit(1);
        if(duplicateErr)throw duplicateErr;
        if(alreadyUsed?.length)return json({error:'この正式URLは別のお客様のサイトに割り当て済みです。別のURLを指定してください。'},409);
      }
      // Each private draft publishes only docs/ (offline placeholder) until
      // the customer approves the complete site. This enables HTTPS/DNS checks
      // without leaking unreviewed files or changing any already-live site.
      if(domain){
        try{
          await setGithubPagesSource(site.repo_full_name,site.publish_branch||'main','/docs');
        }catch(e:any){
          console.error('Customer domain staging failed',String(e?.message||e).slice(0,420));
          return json({error:'正式URLの事前設定に失敗しました。GitHub Pagesのプラン・非公開リポジトリ利用条件・権限・/docsの公開設定を確認してください。制作途中の非公開リポジトリは勝手に公開しません。'},409);
        }
      }
      await setGithubPagesDomain(site.repo_full_name, domain);
      const { error } = await admin.from('website_sites').update({ custom_domain: domain }).eq('site_id', siteId);
      if (error) throw error;
      await admin.from('website_activity').insert({
        site_id: siteId, actor_type: 'admin', actor_user_id: user.id,
        action: 'domain_updated', detail: domain ? `独自ドメイン設定: ${domain}` : '独自ドメイン設定を解除。',
      });
      return json({ ok: true, custom_domain: domain });
    }

    if(action==='admin_refresh_semi_template'){
      if(role!=='admin')return json({error:'管理者権限が必要です。'},403);
      const {data:siteNow,error:siteError}=await admin.from('website_sites')
        .select('status').eq('site_id',siteId).single();
      if(siteError)throw siteError;
      if(siteNow.status!=='sho_review')return json({error:'運営確認待ちの案件だけ再生成できます。'},409);
      const {data:intake,error:intakeError}=await admin.from('website_intakes')
        .select('payload').eq('site_id',siteId).single();
      if(intakeError)throw intakeError;
      if(intake?.payload?.fields?.build_plan!=='semi')return json({error:'セミオーダーの案件だけ利用できます。'},409);
      const {data:active,error:activeError}=await admin.from('website_jobs')
        .select('id').eq('site_id',siteId).in('status',['queued','running']).limit(1);
      if(activeError)throw activeError;
      if(active?.length)return json({error:'すでに制作処理が進行中です。'},409);
      const {data:job,error:jobError}=await admin.from('website_jobs').insert({
        site_id:siteId,kind:'sho_revision',status:'queued',
        instruction:'最新の保存済み入力内容とテンプレートで再生成する（文章・写真・レイアウトは入力内容に従う）。',
        payload:{source:'admin_template_refresh',qa_rebuild:true}
      }).select('id').single();
      if(jobError)throw jobError;
      const {error:updateError}=await admin.from('website_sites').update({
        status:'building',current_note:'最新のテンプレートで制作案を再生成中。',
        customer_approved:false
      }).eq('site_id',siteId);
      if(updateError)throw updateError;
      await admin.from('website_activity').insert({
        site_id:siteId,actor_type:'admin',actor_user_id:user.id,
        action:'template_refresh_requested',detail:'制作案を最新の入力内容で再生成。',
        payload:{job_id:job.id}
      });
      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch(e=>console.error('template refresh worker failed',e)));
      return json({ok:true,status:'building',job_id:job.id});
    }

    if(action==='admin_request_review_fix'){
      if(role!=='admin')return json({error:'管理者権限が必要です。'},403);
      const note=String(body.detail||'').trim();
      if(note.length<5||note.length>5000)return json({error:'修正箇所・希望内容を5〜5000文字で入力してください。'},400);
      const {data:siteNow,error:siteError}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();
      if(siteError)throw siteError;
      if(siteNow.status!=='sho_review')return json({error:'現在は運営によるサイト確認中ではありません。'},409);
      const {data:issue,error:issueError}=await admin.from('website_review_issues').insert({site_id:siteId,note,status:'fixing'}).select('id').single();
      if(issueError)throw issueError;
      const {data:job,error:jobError}=await admin.from('website_jobs').insert({
        site_id:siteId,kind:'sho_revision',status:'queued',instruction:note,
        payload:{source:'admin_review_issue',review_issue_id:issue.id}
      }).select('id').single();
      if(jobError)throw jobError;
      await admin.from('website_review_issues').update({job_id:job.id}).eq('id',issue.id);
      const {error:updateError}=await admin.from('website_sites').update({status:'building',current_note:'運営の修正依頼を反映中。',customer_approved:false}).eq('site_id',siteId);
      if(updateError)throw updateError;
      await admin.from('website_activity').insert({site_id:siteId,actor_type:'admin',actor_user_id:user.id,action:'review_issue_requested',detail:note,payload:{review_issue_id:issue.id,job_id:job.id}});
      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch(e=>console.error('review worker trigger failed',e)));
      return json({ok:true,status:'building',review_issue_id:issue.id});
    }

    if(action==='admin_confirm_review_fix'){
      if(role!=='admin')return json({error:'管理者権限が必要です。'},403);
      const issueId=Number((body as any).review_issue_id);
      if(!Number.isSafeInteger(issueId)||issueId<=0)return json({error:'確認項目のIDが不正です。'},400);
      const {data:siteNow,error:siteError}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();
      if(siteError)throw siteError;
      if(siteNow.status!=='sho_review')return json({error:'制作案の確認待ちでのみチェックできます。'},409);
      const {data:issue,error:issueError}=await admin.from('website_review_issues').update({
        status:'confirmed',confirmed_at:new Date().toISOString(),updated_at:new Date().toISOString()
      }).eq('id',issueId).eq('site_id',siteId).eq('status','ready_for_check').select('id').maybeSingle();
      if(issueError)throw issueError;
      if(!issue)return json({error:'まだ修正完了していないか、既に確認済みです。'},409);
      await admin.from('website_activity').insert({site_id:siteId,actor_type:'admin',actor_user_id:user.id,action:'review_issue_confirmed',detail:'修正項目 #'+issueId+' を確認済み。'});
      return json({ok:true,review_issue_id:issueId});
    }

    if (action === 'admin_transition') {
      if (role !== 'admin') return json({ error: '管理者権限が必要です。' }, 403);
      const allowed = ['request_waiting','building','sho_review','customer_review','live','private','improving_private'];
      if (!allowed.includes(String(body.status))) return json({ error: 'ステータスが不正です。' }, 400);
      if(body.status==='live')return json({error:'公開はお客様の確認画面から承認・公開操作を行ってください。管理画面から公開を省略できません。'},409);
      if(body.status==='customer_review'){
        const {data:checkSite,error:checkError}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();
        if(checkError)throw checkError;
        if(checkSite.status!=='sho_review')return json({error:'先に運営が制作案を確認してください。'},409);
        const {count,error:issuesError}=await admin.from('website_review_issues').select('id',{count:'exact',head:true}).eq('site_id',siteId).neq('status','confirmed');
        if(issuesError)throw issuesError;
        if(count)return json({error:'修正項目に未確認が残っています。修正後のチェックを完了してください。'},409);
        const {data:ready,error:readyError}=await admin.from('website_sites').select('repo_full_name,publish_branch,preview_branch').eq('site_id',siteId).single();
        if(readyError)throw readyError;
        if(!ready.repo_full_name)return json({error:'制作サイトのGitHubリポジトリがありません。'},409);
        const {data:ordered,error:orderError}=await admin.from('website_orders').select('plan,template_style').eq('site_id',siteId).maybeSingle();
        if(orderError)throw orderError;
        await verifyWebsiteBeforeDelivery(ready.repo_full_name,ready.preview_branch||ready.publish_branch||'main',ordered?.plan==='semi'?String(ordered.template_style||''):'');
      }

      if (['live','private','improving_private'].includes(String(body.status))) {
        const { data: site, error: readError } = await admin
          .from('website_sites')
          .select('repo_full_name,publish_branch,preview_branch,live_path,offline_path,custom_domain')
          .eq('site_id', siteId)
          .single();
        if (readError) throw readError;
        if (!site.repo_full_name) return json({ error: '公開先GitHub Repoがまだ設定されていません。' }, 409);
        if(body.status==='live')await publishApprovedStagedBranch(site.repo_full_name,site.publish_branch||'main',site.preview_branch);
        const path = body.status === 'live' ? (site.live_path || '/') : (site.offline_path || '/docs');
        await setGithubPagesSource(
          site.repo_full_name,
          site.publish_branch || 'main',
          path as '/' | '/docs',
        );
      }

      const newState=String(body.status);
      const publishedAt=new Date();
      let liveData:Record<string,unknown>={};let firstPublication=false;
      if(newState==='live'){
        const {data:siteInfo,error:infoError}=await admin.from('website_sites').select('repo_full_name,custom_domain,published_at,adjustment_free_until,update_free_until').eq('site_id',siteId).single();if(infoError)throw infoError;
        firstPublication=!siteInfo.published_at;
        const {data:order}=await admin.from('website_orders').select('plan').eq('site_id',siteId).maybeSingle();
        const url=await requireStablePublicationUrl(siteInfo.repo_full_name,siteInfo.custom_domain);
        liveData={public_url:url,preview_url:url,published_at:siteInfo.published_at||publishedAt.toISOString(),adjustment_free_until:firstPublication?new Date(publishedAt.getTime()+30*86400000).toISOString():siteInfo.adjustment_free_until,update_free_until:firstPublication&&order&&['semi','full'].includes(order.plan)?addMonths(publishedAt,3):siteInfo.update_free_until,review_access_token_hash:null,preview_access_token_hash:null,preview_branch:null};
      }
      const { error } = await admin.from('website_sites').update({
        status:body.status,current_note:String(body.current_note||''),customer_approved:false,...liveData,
      }).eq('site_id',siteId);
      if(!error&&newState==='live'&&firstPublication)await setOrderFreePeriod(admin,siteId,publishedAt);
      if (error) throw error;
      if(newState==='live'){
        await admin.from('website_jobs').update({status:'done'}).eq('site_id',siteId).eq('status','sho_review');
        await admin.from('website_update_requests').update({status:'completed'}).eq('site_id',siteId).eq('status','building');
      }
      await admin.from('website_activity').insert({
        site_id: siteId, actor_type: 'admin', actor_user_id: user.id,
        action: 'admin_transition', detail: String(body.detail || body.current_note || body.status),
        payload: { status: body.status },
      });
      if (body.status === 'building' && String(body.detail || '').trim()) {
        await admin.from('website_jobs').insert({
          site_id: siteId,
          kind: 'sho_revision',
          status: 'queued',
          instruction: String(body.detail).trim(),
          payload: { source: 'admin_transition' },
        });
        EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch((error) => console.error('website-worker trigger error', error)));
      }

      if(body.status==='customer_review'){
        const {data:link}=await admin.from('website_line_links').select('line_user_id').eq('site_id',siteId).maybeSingle();
        if(!link?.line_user_id)return json({ok:true,status:body.status,warning:'お客様のLINEが未連携です。最終確認URLは送信されていません。'});
        const key=randomReviewKey(),hash=await sha256Hex(key);
        const {error:tokenError}=await admin.from('website_sites').update({review_access_token_hash:hash}).eq('site_id',siteId);
        if(tokenError)throw tokenError;
        const reviewUrl='https://sho-support.github.io/website-customer-review.html?id='+encodeURIComponent(siteId)+'&prod=1&key='+key;
        const previewUrl='https://sho-support.github.io/website-preview.html?id='+encodeURIComponent(siteId)+'&key='+key;
        const sent=await linePush(link.line_user_id,'ホームページの制作案ができました。\n\n【サイトを見る】\n'+previewUrl+'\n\n【確認・修正依頼・公開画面】\n'+reviewUrl+'\n\nサイトを確認して問題なければ、確認画面で承認してから公開をお選びください。');
        if(sent.skipped||sent.ok===false)return json({ok:true,status:body.status,warning:'最終確認URLのLINE送信に失敗しました。再送が必要です。'});
      }
      return json({ok:true,status:body.status});
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('website-api error', error);
    return json({ error: '処理に失敗しました。', detail: String(error) }, 500);
  }
});
