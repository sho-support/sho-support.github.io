import { downloadPng, imageFont, wrapImageText } from './website-share-image.js';

function priceRows(selector, label, amount) {
  return Array.from(document.querySelectorAll(selector), (row) => [
    row.querySelector(label).textContent.trim(),
    row.querySelector(amount).textContent.trim(),
  ]);
}

function drawPriceImage() {
  const offer = window.SHO_HOSTING_OFFER;
  const restoration = window.SHO_HOSTING_RESTORATION;
  const yen = new Intl.NumberFormat('ja-JP');
  const annualFee = yen.format(offer.renewal_fee_jpy);
  const groups = [
    ['制作プラン', priceRows('.plan-drop > summary', '.plan-head strong', '.plan-price')],
    ['SHO管理での公開維持', [
      ['公開から最初の' + offer.initial_months + 'か月', '制作料金に含む'],
      ['2年目以降・継続を希望する場合', annualFee + '円 / 年'],
      ...(restoration ? [['満了後の標準復元（希望時）', yen.format(restoration.total_jpy) + '円']] : []),
    ]],
    ['公開後の内容更新', priceRows('.update-prices summary', 'b', 'strong')],
  ];
  const notes = [
    '公開後30日間は、プラン内の調整が無料。',
    '公開維持は継続申込み制。自動更新・自動課金なし。',
    ...(restoration ? [`満了後${restoration.request_days}日以内の申込み。${restoration.price_label}。`] : []),
    '振込手数料は別途。合計は正式見積りでご確認ください。',
  ];
  const campaign = document.querySelector('.campaign strong');
  if (campaign) notes.push(campaign.textContent.trim(), '対象は申込時の掲載条件によります。月8回まで。');

  const canvas = document.createElement('canvas');
  const side = 48;
  canvas.width = 900;
  const width = canvas.width - side * 2;
  const context = canvas.getContext('2d');
  const noteFont = '400 29px ' + imageFont;
  context.font = noteFont;
  const noteLines = notes.flatMap((note) => wrapImageText(context, note, width));
  canvas.height = 187 + groups.reduce((height, [, rows]) => height + 62 + rows.length * 60, 0) + noteLines.length * 42 + 87;

  context.fillStyle = '#11100f';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#ffbb86';
  context.font = '700 28px ' + imageFont;
  context.fillText('SHO WEB SUPPORT', side, 62);
  context.fillStyle = '#fffaf4';
  context.font = '800 58px ' + imageFont;
  context.fillText('ホームページ制作 料金表', side, 137);
  context.fillStyle = '#d6ccc3';
  context.font = '400 28px ' + imageFont;
  context.fillText('料金の目安・すべて税込', side, 180);

  let y = 195;
  for (const [title, rows] of groups) {
    context.fillStyle = '#ffbb86';
    context.font = '800 32px ' + imageFont;
    context.fillText(title, side, y + 44);
    y += 62;
    for (const [label, amount] of rows) {
      context.fillStyle = '#44352b';
      context.fillRect(side, y, width, 1);
      context.fillStyle = '#fffaf4';
      context.font = '600 32px ' + imageFont;
      context.fillText(label, side, y + 41, width - 294);
      context.textAlign = 'right';
      context.font = '800 36px ' + imageFont;
      context.fillText(amount, side + width, y + 41, 276);
      context.textAlign = 'left';
      y += 60;
    }
  }

  context.fillStyle = '#d6ccc3';
  context.font = noteFont;
  noteLines.forEach((line, index) => context.fillText(line, side, y + 40 + index * 42));
  const date = Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeZone: 'Asia/Tokyo' }).format(new Date());
  context.fillStyle = '#ffbb86';
  context.fillText('画像作成日 ' + date, side, canvas.height - 29);
  return canvas;
}

const save = document.getElementById('savePriceImage');
const status = document.getElementById('priceImageStatus');
save.hidden = false;
save.addEventListener('click', () => {
  try {
    downloadPng(drawPriceImage(), 'sho-website-prices.png');
    status.textContent = '料金表の画像を作成しました。端末のダウンロードから確認できます。';
  } catch {
    status.textContent = '画像を作成できませんでした。画面のスクリーンショットをご利用ください。';
  }
});
