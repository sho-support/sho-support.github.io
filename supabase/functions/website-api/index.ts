import { adminClient, corsHeaders, getUser, json, notifyOwner, siteRole, linePush, setGithubPagesDomain, setGithubPagesSource, triggerWebsiteWorker } from './_shared/website.ts';

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
function githubSiteUrl(repo:string,domain?:string|null){const p=repo.split('/');const host=String(domain||'').replace('https://','').replace('http://','').split('/')[0];return host?'https://'+host+'/':'https://'+p[0]+'.github.io/'+p[1]+'/';}
async function setOrderFreePeriod(admin:ReturnType<typeof adminClient>,siteId:string,now:Date){const {error}=await admin.from('website_orders').update({update_free_until:addMonths(now,3)}).eq('site_id',siteId).in('plan',['semi','full']);if(error)throw error;}
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

      const { error: siteError } = await admin.from('website_sites').upsert({
        site_id: body.site_id,
        site_name: String(body.site_name || ''),
        status: 'request_waiting',
        current_note: 'ヒアリング入力待ち。',
        customer_approved: false,
        repo_full_name: body.repo_full_name || null,
        publish_branch: body.publish_branch || 'main',
        live_path: body.live_path || '/',
        offline_path: body.offline_path || '/docs',
      }, { onConflict: 'site_id' });
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
        return json({ ok: true, status: 'running', job_id: latest.id });
      } else if (latest.status !== 'queued') {
        return json({ error: '現在はAIを再実行する必要がありません。' }, 409);
      }

      EdgeRuntime.waitUntil(triggerWebsiteWorker(siteId).catch((error) => console.error('website-worker trigger error', error)));
      return json({ ok: true, status: 'queued', job_id: jobId });
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
      return json({site,intake,activity:activity||[],jobs:jobs||[],profile,updates:updates||[],role});
    }

    if (action === 'save_draft') {
      if (!canEdit) return json({ error: '編集権限がありません。' }, 403);
      const {data:currentSite,error:stateErr}=await admin.from('website_sites').select('status').eq('site_id',siteId).single();if(stateErr)throw stateErr;
      if(currentSite.status!=='request_waiting')return json({error:'初回ヒアリングは受付終了です。更新依頼は専用の窓口からお願いします。'},409);
      const savedAt = new Date().toISOString();
      const { error } = await admin.from('website_intakes').upsert({
        site_id: siteId,
        payload: body.payload || {},
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
      const { error: intakeError } = await admin.from('website_intakes').upsert({
        site_id: siteId,
        payload: body.payload || {},
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
        .select('site_name')
        .single();
      if (siteError) throw siteError;

      const intakePayload = (body.payload || {}) as Record<string, any>;
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
          .select('customer_approved,repo_full_name,publish_branch,live_path,custom_domain,published_at,adjustment_free_until,update_free_until')
          .eq('site_id', siteId)
          .single();
        if (readError) throw readError;
        if (!site.customer_approved || !reviewSite.customer_approved) return json({ error: '先にサイト内容の承認が必要です。' }, 409);
        if (!site.repo_full_name) return json({ error: '公開先GitHub Repoがまだ設定されていません。' }, 409);

        await setGithubPagesSource(
          site.repo_full_name,
          site.publish_branch || 'main',
          (site.live_path || '/') as '/' | '/docs',
        );

        const when=new Date(),url=githubSiteUrl(site.repo_full_name,site.custom_domain),first=!site.published_at;
        const {data:order}=await admin.from('website_orders').select('plan').eq('site_id',siteId).maybeSingle();
        const { error } = await admin.from('website_sites').update({
          status:'live',current_note:'サイト公開中。',customer_approved:false,
          public_url:url,preview_url:url,published_at:site.published_at||when.toISOString(),
          adjustment_free_until:first?new Date(when.getTime()+30*86400000).toISOString():site.adjustment_free_until,
          update_free_until:first&&order&&['semi','full'].includes(order.plan)?addMonths(when,3):site.update_free_until,
          review_access_token_hash:null,preview_access_token_hash:null,
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
      const {data:site,error:siteError}=await admin.from('website_sites').select('status,repo_full_name,publish_branch').eq('site_id',siteId).single();
      if(siteError)throw siteError;
      if(site.status==='live')return json({error:'公開中のサイトは非公開プレビューへ切り替えられません。'},409);
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
        .select('repo_full_name')
        .eq('site_id', siteId)
        .single();
      if (readError) throw readError;
      if (!site.repo_full_name) return json({ error: '公開先GitHub Repoがまだ設定されていません。' }, 409);
      const domain = body.custom_domain ? String(body.custom_domain).trim().toLowerCase() : null;
      await setGithubPagesDomain(site.repo_full_name, domain);
      const { error } = await admin.from('website_sites').update({ custom_domain: domain }).eq('site_id', siteId);
      if (error) throw error;
      await admin.from('website_activity').insert({
        site_id: siteId, actor_type: 'admin', actor_user_id: user.id,
        action: 'domain_updated', detail: domain ? `独自ドメイン設定: ${domain}` : '独自ドメイン設定を解除。',
      });
      return json({ ok: true, custom_domain: domain });
    }

    if (action === 'admin_transition') {
      if (role !== 'admin') return json({ error: '管理者権限が必要です。' }, 403);
      const allowed = ['request_waiting','building','sho_review','customer_review','live','private','improving_private'];
      if (!allowed.includes(String(body.status))) return json({ error: 'ステータスが不正です。' }, 400);

      if (['live','private','improving_private'].includes(String(body.status))) {
        const { data: site, error: readError } = await admin
          .from('website_sites')
          .select('repo_full_name,publish_branch,live_path,offline_path,custom_domain')
          .eq('site_id', siteId)
          .single();
        if (readError) throw readError;
        if (!site.repo_full_name) return json({ error: '公開先GitHub Repoがまだ設定されていません。' }, 409);
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
        const url=githubSiteUrl(siteInfo.repo_full_name,siteInfo.custom_domain);
        liveData={public_url:url,preview_url:url,published_at:siteInfo.published_at||publishedAt.toISOString(),adjustment_free_until:firstPublication?new Date(publishedAt.getTime()+30*86400000).toISOString():siteInfo.adjustment_free_until,update_free_until:firstPublication&&order&&['semi','full'].includes(order.plan)?addMonths(publishedAt,3):siteInfo.update_free_until,review_access_token_hash:null,preview_access_token_hash:null};
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
        const sent=await linePush(link.line_user_id,'ホームページの最終確認をお願いします。修正依頼・承認・公開まで専用URLから操作できます。\n\n'+reviewUrl);
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
