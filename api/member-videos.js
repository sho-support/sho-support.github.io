import videos from '../data/member-videos.json' with { type: 'json' };
import { getAdminClient, getAuthenticatedUser, isActiveStatus, sendJson } from './_shared.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed' });
  try {
    const user = await getAuthenticatedUser(req);
    if (!user?.email) return sendJson(res, 401, { error: 'ログインが必要です。' });

    const supabase = getAdminClient();
    const { data, error } = await supabase
      .from('supporters')
      .select('status')
      .eq('email', user.email.toLowerCase())
      .maybeSingle();

    if (error) throw error;
    if (!data || !isActiveStatus(data.status)) {
      return sendJson(res, 403, { error: '有効な月額サポートを確認できません。' });
    }

    return sendJson(res, 200, { videos });
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { error: '動画一覧を取得できませんでした。' });
  }
}
