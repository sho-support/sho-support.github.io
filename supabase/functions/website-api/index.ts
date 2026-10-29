import { adminClient, corsHeaders, getUser, json, notifyOwner, siteRole, linePush, setGithubPagesDomain, setGithubPagesSource, triggerWebsiteWorker } from '../_shared/website.ts';

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
  order_code?: string;
};


function randomAccessKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function adminAllowed(admin: ReturnType<typeof adminClient>, userId: string) {
  const { data, error } = await admin.from('website_admins').select('user_id').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

function validSiteId(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{3,32}$/.test(value);
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


    if (action === 'list_orders') {
      if (!(await adminAllowed(admin, user.id))) return json({ error: '管理者権限が必要です。' }, 403);
      const { data, error } = await admin
        .from('website_orders')
        .select('order_code,status,plan,template_style,update_plan,custom_domain,amount_from,line_user_id,line_display_name,line_linked_at,site_id,created_at,updated_at')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return json({ orders: data || [] });
    }

    if (action === 'mark_order_paid') {
      if (!(await adminAllowed(admin, user.id))) return json({ error: '管理者権限が必要です。' }, 403);
      const orderCode = String(body.order_code || '').trim().toUpperCase();
      if (!/^[FSP]\d{4,6}$/.test(orderCode)) return json({ error: '注文IDが不正です。' }, 400);

      const { data: order, error: orderError } = await admin
        .from('website_orders')
        .select('*')
        .eq('order_code', orderCode)
        .maybeSingle();
      if (orderError) throw orderError;
      if (!order) return json({ error: '注文が見つかりません。' }, 404);
      if (!order.line_user_id) return json({ error: '先にお客様からLINEで注文内容を送信してもらってください。' }, 409);

      const numeric = orderCode.replace(/^[FSP]/, '');
      const siteId = numeric;
      const accessKey = randomAccessKey();
      const accessHash = await sha256Hex(accessKey);
      const planLabel = order.plan === 'one' ? '1ページ完結サイト' : order.plan === 'semi' ? 'セミオーダーサイト' : 'フルオーダーサイト';

      const { data: existingSite, error: existingError } = await admin
        .from('website_sites')
        .select('site_id')
        .eq('site_id', siteId)
        .maybeSingle();
      if (existingError) throw existingError;

      if (!existingSite) {
        const { error: siteError } = await admin.from('website_sites').insert({
          site_id: siteId,
          site_name: planLabel,
          status: 'request_waiting',
          current_note: '入金確認済み。ヒアリング入力待ち。',
          customer_approved: false,
          publish_branch: 'main',
          live_path: '/',
          offline_path: '/docs',
        });
        if (siteError) throw siteError;

        const initialPayload = {
          fields: {
            build_plan: order.plan,
            template_style: order.template_style || '',
          },
          checks: {},
          members: [],
          lives: [],
          contacts: [],
          files: { top_photos: [], gallery_photos: [], logo_file: [] },
          meta: {},
        };
        const { error: intakeError } = await admin.from('website_intakes').insert({
          site_id: siteId,
          payload: initialPayload,
        });
        if (intakeError) throw intakeError;

        await admin.from('website_activity').insert({
          site_id: siteId,
          actor_type: 'admin',
          actor_user_id: user.id,
          action: 'site_created',
          detail: `注文 ${orderCode} の入金確認後に案件を作成。`,
        });
      }

      const { error: linkError } = await admin.from('website_line_links').upsert({
        site_id: siteId,
        line_user_id: order.line_user_id,
        line_display_name: order.line_display_name || null,
      }, { onConflict: 'site_id' });
      if (linkError) throw linkError;

      const { error: updateError } = await admin.from('website_orders').update({
        status: 'site_created',
        site_id: siteId,
        customer_access_token_hash: accessHash,
        access_token_created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('order_code', orderCode);
      if (updateError) throw updateError;

      const intakeUrl = `https://sho-support.github.io/website-intake.html?id=${encodeURIComponent(siteId)}&prod=1&key=${encodeURIComponent(accessKey)}`;
      await linePush(order.line_user_id,
        `ご入金を確認しました。ありがとうございます。\n\n正式なSITE IDは ${siteId} です。\n下の専用URLから制作内容・写真をご入力ください。入力途中でも自動保存され、同じURLなら別端末・別ブラウザから続けられます。\n\n${intakeUrl}`
      );
      await linePush(order.line_user_id, `SITE ID ${siteId}`);
      await notifyOwner(`【入金確認・案件作成】\n注文ID ${orderCode}\nSITE ID ${siteId}\nヒアリングURL送信済み`);
      return json({ ok: true, order_code: orderCode, site_id: siteId, intake_url: intakeUrl });
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
      ] = await Promise.all([
        admin.from('website_sites').select('*').eq('site_id', siteId).single(),
        admin.from('website_intakes').select('*').eq('site_id', siteId).maybeSingle(),
        admin.from('website_activity').select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(100),
        admin.from('website_jobs').select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(20),
        admin.from('website_profiles').select('*').eq('site_id', siteId).maybeSingle(),
      ]);
      if (siteError) throw siteError;
      if (intakeError) throw intakeError;
      if (activityError) throw activityError;
      if (jobsError) throw jobsError;
      if (profileError) throw profileError;
      return json({ site, intake, activity: activity || [], jobs: jobs || [], profile, role });
    }

    if (action === 'save_draft') {
      if (!canEdit) return json({ error: '編集権限がありません。' }, 403);
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
          .select('customer_approved,repo_full_name,publish_branch,live_path')
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

        const { error } = await admin.from('website_sites').update({
          status: 'live',
          current_note: 'サイト公開中。',
          customer_approved: false,
        }).eq('site_id', siteId);
        if (error) throw error;
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
          .select('repo_full_name,publish_branch,live_path,offline_path')
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

      const { error } = await admin.from('website_sites').update({
        status: body.status,
        current_note: String(body.current_note || ''),
        customer_approved: false,
      }).eq('site_id', siteId);
      if (error) throw error;
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

      if (body.status === 'customer_review') {
        const { data: link } = await admin.from('website_line_links').select('line_user_id').eq('site_id', siteId).maybeSingle();
        await linePush(link?.line_user_id, `SITE ID ${siteId} のホームページが最終確認できる状態になりました。お客様確認画面からご確認ください。`);
      }
      return json({ ok: true, status: body.status });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('website-api error', error);
    return json({ error: '処理に失敗しました。', detail: String(error) }, 500);
  }
});
