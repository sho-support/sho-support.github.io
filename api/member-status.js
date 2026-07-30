import { getAdminClient, getAuthenticatedUser, isActiveStatus, normalizeEmail, sendJson } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const user = await getAuthenticatedUser(req);
    const email = normalizeEmail(user?.email);
    if (!email) {
      return sendJson(res, 401, { active: false, error: 'ログインが必要です。' });
    }

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('supporters')
      .select('status, plan_amount, current_period_end, cancel_at_period_end')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    return sendJson(res, 200, {
      active: Boolean(data && isActiveStatus(data.status)),
      email,
      status: data?.status || 'not_found',
      planAmount: data?.plan_amount ?? null,
      currentPeriodEnd: data?.current_period_end ?? null,
      cancelAtPeriodEnd: Boolean(data?.cancel_at_period_end)
    });
  } catch (error) {
    console.error('Member status error:', error);
    return sendJson(res, 500, { active: false, error: '会員状態を確認できませんでした。' });
  }
}
