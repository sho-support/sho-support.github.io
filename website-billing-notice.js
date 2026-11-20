const timeInJapan = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo', dateStyle: 'medium', timeStyle: 'short',
});

export function renderBillingNotices(section, notices) {
  const document = section.ownerDocument;
  const items = [];
  for (const notice of notices) {
    if (notice?.kind !== 'card_renewal_failed' || typeof notice.failed_at !== 'string') continue;
    const timestamp = Date.parse(notice.failed_at);
    if (!Number.isFinite(timestamp)) continue;

    const item = document.createElement('article');
    const title = document.createElement('h3');
    title.textContent = '公開維持費のカード決済に失敗しました';
    const detail = document.createElement('p');
    detail.textContent = `${notice.site_name || 'ホームページ'} · ${timeInJapan.format(timestamp)}（日本時間）`;
    const next = document.createElement('p');
    next.textContent = 'カードの有効期限や利用可能額をご確認ください。お知らせメールのリンクから支払い方法を更新できます。';
    const help = document.createElement('p');
    const contact = document.createElement('a');
    contact.href = 'https://line.me/R/ti/p/@144dlsxp';
    contact.target = '_blank';
    contact.rel = 'noopener noreferrer';
    contact.textContent = '公式LINE';
    help.append('メールが届かない場合は、', contact, 'でご相談ください。');
    item.append(title, detail, next, help);
    items.push(item);
  }
  section.querySelector('[data-billing-notice-list]').replaceChildren(...items);
  section.hidden = items.length === 0;
}
