import { adminClient, corsHeaders, getUser, json, notifyOwner, siteRole, linePush } from '../_shared/website.ts';

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
  review_action?: 'revision' | 'approve' | 'publish';
};

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

    if (action === 'load_site') {
      const [
        { data: site, error: siteError },
        { data: intake, error: intakeError },
        { data: activity, error: activityError },
        { data: jobs, error: jobsError },
      ] = await Promise.all([
        admin.from('website_sites').select('*').eq('site_id', siteId).single(),
        admin.from('website_intakes').select('*').eq('site_id', siteId).maybeSingle(),
        admin.from('website_activity').select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(100),
        admin.from('website_jobs').select('*').eq('site_id', siteId).order('created_at', { ascending: false }).limit(20),
      ]);
      if (siteError) throw siteError;
      if (intakeError) throw intakeError;
      if (activityError) throw activityError;
      if (jobsError) throw jobsError;
      return json({ site, intake, activity: activity || [], jobs: jobs || [], role });
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

      await notifyOwner(`【SHO WEB SUPPORT】\nSITE ID ${siteId}\nヒアリングが送信されました。\n${site?.site_name || ''}`);
      return json({ ok: true, submitted_at: submittedAt });
    }

    if (action === 'review_action') {
      if (!canEdit) return json({ error: '操作権限がありません。' }, 403);
      const reviewAction = body.review_action;

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
          .select('customer_approved')
          .eq('site_id', siteId)
          .single();
        if (readError) throw readError;
        if (!site.customer_approved) return json({ error: '先にサイト内容の承認が必要です。' }, 409);

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

    if (action === 'admin_transition') {
      if (role !== 'admin') return json({ error: '管理者権限が必要です。' }, 403);
      const allowed = ['request_waiting','building','sho_review','customer_review','live','private','improving_private'];
      if (!allowed.includes(String(body.status))) return json({ error: 'ステータスが不正です。' }, 400);
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
