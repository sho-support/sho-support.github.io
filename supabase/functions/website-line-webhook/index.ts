import { adminClient, json, linePush, notifyOwner, getLineMessagingToken } from './_shared/website.ts';

async function sha256Hex(value:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');}

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

async function reply(replyToken: string | undefined, text: string | string[]) {
  const token = await getLineMessagingToken();
  if (!token || !replyToken) return;
  const texts = (Array.isArray(text) ? text : [text]).filter(Boolean).slice(0, 5);
  const response = await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: texts.map((t) => ({ type: 'text', text: String(t).slice(0, 5000) })) }),
  });
  if (!response.ok) console.error('LINE reply failed', response.status, await response.text());
}

async function profile(lineUserId: string) {
  const token = await getLineMessagingToken();
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

      const adminCode = Deno.env.get('LINE_ADMIN_LINK_CODE') || '';
      const adminLink = text.match(/^SHO\s+ADMIN\s+LINK\s+(.+)$/i);
      if (adminLink && adminCode && adminLink[1].trim() === adminCode) {
        const p = await profile(lineUserId);
        const { error: settingError } = await admin.from('website_settings').upsert({
          key: 'line_owner',
          value: { user_id: lineUserId, display_name: p?.displayName || null },
          updated_at: new Date().toISOString(),
        }, { onConflict: 'key' });
        if (settingError) throw settingError;
        await reply(event.replyToken, 'SHO WEB SUPPORTの自動通知先として、このLINEを登録しました。');
        continue;
      }

      const orderMatch = text.match(/注文ID\s*[:：]?\s*([FSP]\d{4,6})/i) || text.match(/\b([FSP]\d{4,6})\b/i);
      if (orderMatch) {
        const orderCode = String(orderMatch[1] || orderMatch[0]).toUpperCase();
        const { data: order, error: orderError } = await admin
          .from('website_orders')
          .select('id,order_code,status,plan,template_style,update_plan,custom_domain,amount_from,line_user_id,line_link_token_hash')
          .eq('order_code', orderCode)
          .maybeSingle();
        if (orderError) throw orderError;

        if (order) {
          if(order.status==='pending_line'){
            const match=text.match(/連携コード\s*[:：]\s*([a-f0-9]{40})/i);
            if(!match||!order.line_link_token_hash||(await sha256Hex(match[1].toLowerCase()))!==order.line_link_token_hash){
              await reply(event.replyToken,'注文IDと連携コードを確認できませんでした。お申込み完了画面の「公式LINEで注文内容を送信」から送り直してください。');
              continue;
            }
          }
          if(order.line_user_id&&order.line_user_id!==lineUserId){await reply(event.replyToken,'この注文IDは別のLINEアカウントに紐づいています。ご本人確認が必要な場合は管理者へご相談ください。');continue;}
          const p = await profile(lineUserId);
          const { error: orderUpdateError } = await admin
            .from('website_orders')
            .update({
              status: order.status === 'pending_line' ? 'pending_payment' : order.status,
              line_user_id: lineUserId,
              line_display_name: p?.displayName || null,
              line_linked_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('id', order.id);
          if (orderUpdateError) throw orderUpdateError;

          const planLabel = order.plan === 'one' ? '1ページサイト' : order.plan === 'semi' ? 'セミオーダーサイト' : 'フルオーダーサイト';
          const templateLine = order.template_style ? `\nテンプレート: ${order.template_style}` : '';
          const { data: bankSetting } = await admin
            .from('website_settings')
            .select('value')
            .eq('key', 'bank_transfer')
            .maybeSingle();
          const bankMessage = String(bankSetting?.value?.message || '').trim();

          if (bankMessage) {
            await reply(event.replyToken, [
              `ご注文を受け付けました。\n注文ID: ${order.order_code}\n${planLabel} ¥${Number(order.amount_from || 0).toLocaleString()}〜${templateLine}\n\n【お振込先】\n${bankMessage}\n\nお振込みの際は、振込人名義の前に下記の注文IDを入力してください。必要に応じて、次のメッセージを長押ししてコピーしてお使いください。\n\n入金確認後、正式なSITE IDと制作ヒアリングURLをお送りします。`,
              order.order_code,
            ]);
          } else {
            await reply(
              event.replyToken,
              `ご注文を受け付けました。\n注文ID: ${order.order_code}\n${planLabel} ¥${Number(order.amount_from || 0).toLocaleString()}〜${templateLine}\n\n振込先はこのLINEでご案内します。入金確認後、正式なSITE IDと制作ヒアリングURLをお送りします。`,
            );
          }
          await notifyOwner(`【注文LINE紐付け】\n${order.order_code}\n${p?.displayName || 'お客様'}\n入金案内待ち`);
          continue;
        }
      }

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

          const {data:orderOwner,error:orderOwnerError}=await admin.from('website_orders').select('line_user_id').eq('site_id',siteId).maybeSingle();
          if(orderOwnerError)throw orderOwnerError;
          if((previous?.line_user_id&&previous.line_user_id!==lineUserId)||(!previous&&orderOwner?.line_user_id!==lineUserId)){
            await reply(event.replyToken,'このSITE IDは現在のLINEアカウントと紐づけできません。管理者へご相談ください。');
            siteId=null;
            continue;
          }
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
