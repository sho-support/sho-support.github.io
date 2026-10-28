import { adminClient, json, linePush, notifyOwner } from '../_shared/website.ts';

function base64Bytes(value: string) {
  try {
    const raw = atob(value);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

async function verifySignature(rawBody: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const received = base64Bytes(signature);
  if (digest.length !== received.length) return false;
  let diff = 0;
  for (let i = 0; i < digest.length; i++) diff |= digest[i] ^ received[i];
  return diff === 0;
}

async function reply(replyToken: string | undefined, text: string) {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token || !replyToken) return;
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text: text.slice(0, 5000) }] }),
  });
  if (!response.ok) console.error('LINE reply failed', response.status, await response.text());
}

async function profile(lineUserId: string) {
  const token = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) return null;
  const response = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(lineUserId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return await response.json().catch(() => null);
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ ok: true });

  try {
    const raw = await req.text();
    const secret = Deno.env.get('LINE_CHANNEL_SECRET') || '';
    const signature = req.headers.get('x-line-signature') || '';
    if (!secret || !(await verifySignature(raw, signature, secret))) {
      return new Response('Invalid signature', { status: 401 });
    }

    const payload = JSON.parse(raw);
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const admin = adminClient();
    const ownerLineUserId = Deno.env.get('LINE_OWNER_USER_ID') || '';

    for (const event of events) {
      if (event?.type !== 'message' || event?.message?.type !== 'text') continue;
      const lineUserId = String(event?.source?.userId || '');
      if (!lineUserId) continue;

      const text = String(event.message.text || '').trim();
      const idMatch = text.match(/SITE\s*ID\s*[:：]?\s*([A-Za-z0-9_-]{3,32})/i);

      let siteId: string | null = null;
      let newlyLinked = false;

      if (idMatch) {
        const candidate = idMatch[1];
        const { data: site, error: siteError } = await admin
          .from('website_sites')
          .select('site_id')
          .eq('site_id', candidate)
          .maybeSingle();
        if (siteError) throw siteError;

        if (site) {
          siteId = site.site_id;
          const p = await profile(lineUserId);
          const { data: previous } = await admin
            .from('website_line_links')
            .select('line_user_id')
            .eq('site_id', siteId)
            .maybeSingle();

          const { error: linkError } = await admin.from('website_line_links').upsert({
            site_id: siteId,
            line_user_id: lineUserId,
            line_display_name: p?.displayName || null,
          }, { onConflict: 'site_id' });
          if (linkError) throw linkError;
          newlyLinked = !previous || previous.line_user_id !== lineUserId;
        }
      }

      if (!siteId) {
        const { data: link, error: linkError } = await admin
          .from('website_line_links')
          .select('site_id')
          .eq('line_user_id', lineUserId)
          .maybeSingle();
        if (linkError) throw linkError;
        siteId = link?.site_id || null;
      }

      if (!siteId) continue;

      await admin.from('website_activity').insert({
        site_id: siteId,
        actor_type: 'customer_line',
        action: 'line_message',
        detail: text.slice(0, 5000),
        payload: { line_user_id: lineUserId, message_id: event?.message?.id || null },
      });

      if (newlyLinked) {
        await reply(
          event.replyToken,
          `SITE ID ${siteId} とこのLINEを紐づけました。今後のホームページ相談は、このトークからそのまま送っていただけます。`,
        );
      }

      if (lineUserId !== ownerLineUserId) {
        await notifyOwner(`【LINE相談 / SITE ID ${siteId}】\n${text.slice(0, 1500)}`);
      }
    }

    return json({ ok: true });
  } catch (error) {
    console.error('LINE webhook error', error);
    return json({ ok: false }, 500);
  }
});
