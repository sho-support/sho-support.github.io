import { downloadPng, imageFont, wrapImageText } from './website-share-image.js';

const photoMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

function drawTrialImage({ title, intro, theme, photo }) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const appearance = getComputedStyle(document.body);
  const color = (name) => appearance.getPropertyValue('--' + name).trim();
  const width = 900;
  const side = 52;
  const contentWidth = width - side * 2;
  const photoHeight = 434;
  const titleFont = '800 62px ' + imageFont;
  const introFont = '400 34px ' + imageFont;

  context.font = titleFont;
  const titleLines = wrapImageText(context, title, contentWidth);
  context.font = introFont;
  const introLines = wrapImageText(context, intro, contentWidth);
  const photoY = 169 + titleLines.length * 76 + introLines.length * 51 + 20;
  canvas.width = width;
  canvas.height = photoY + photoHeight + 104;

  context.fillStyle = color('bg');
  context.fillRect(0, 0, width, canvas.height);
  context.fillStyle = color('text');
  context.font = '700 27px ' + imageFont;
  context.fillText('試作イメージ / メンバー検討用', side, 62);
  context.fillStyle = color('accent');
  context.fillRect(side, 86, contentWidth, 4);
  context.fillStyle = color('soft');
  context.font = '700 25px ' + imageFont;
  context.fillText(theme, side, 138);

  context.textBaseline = 'top';
  context.fillStyle = color('text');
  context.font = titleFont;
  titleLines.forEach((line, index) => context.fillText(line, side, 169 + index * 76));
  context.fillStyle = color('soft');
  context.font = introFont;
  introLines.forEach((line, index) => context.fillText(line, side, 169 + titleLines.length * 76 + index * 51));

  context.save();
  context.beginPath();
  context.roundRect(side, photoY, contentWidth, photoHeight, 22);
  context.clip();
  const gradient = context.createLinearGradient(side, photoY, width - side, photoY + photoHeight);
  const [start, end = start] = color('hero').match(/#[a-f\d]{6}/gi) || [color('panel'), color('bg')];
  gradient.addColorStop(0, start);
  gradient.addColorStop(1, end);
  context.fillStyle = gradient;
  context.fillRect(side, photoY, contentWidth, photoHeight);
  if (photo) {
    const scale = Math.min(contentWidth / photo.naturalWidth, photoHeight / photo.naturalHeight);
    const photoWidth = photo.naturalWidth * scale;
    const scaledHeight = photo.naturalHeight * scale;
    context.drawImage(photo, (width - photoWidth) / 2, photoY + (photoHeight - scaledHeight) / 2, photoWidth, scaledHeight);
  } else {
    context.fillStyle = color('text');
    context.font = '700 30px ' + imageFont;
    context.textAlign = 'center';
    context.fillText('トップ写真の掲載位置', width / 2, photoY + photoHeight / 2 - 18);
  }
  context.restore();

  context.fillStyle = color('soft');
  context.font = '700 24px ' + imageFont;
  context.fillText('SHO WEB SUPPORT', side, photoY + photoHeight + 36);
  return canvas;
}

export function initializeTrial({ data, theme, showTheme, heroTitle, heroText, themeLabel }) {
  const controls = document.getElementById('trialControls');
  const style = document.getElementById('trialStyle');
  const name = document.getElementById('trialName');
  const intro = document.getElementById('trialIntro');
  const fileInput = document.getElementById('trialPhoto');
  const heroPhoto = document.getElementById('heroPhoto');
  const save = document.getElementById('saveTrialImage');
  const remove = document.getElementById('removeTrialPhoto');
  const status = document.getElementById('trialStatus');
  const clean = (value) => value.trim().replace(/\s+/g, ' ');

  for (const [key, entry] of Object.entries(data)) style.add(new Option(entry.label, key));
  style.value = theme;
  document.body.dataset.trial = '';
  heroTitle.setAttribute('role', 'heading');
  heroTitle.setAttribute('aria-level', '2');
  controls.hidden = false;

  function render() {
    showTheme(style.value);
    if (clean(name.value)) heroTitle.textContent = clean(name.value);
    if (clean(intro.value)) heroText.textContent = clean(intro.value);
  }

  async function loadPhoto() {
    const previous = heroPhoto.querySelector('img');
    if (previous) {
      previous.remove();
      URL.revokeObjectURL(previous.src);
    }
    const file = fileInput.files[0];
    status.textContent = '';
    remove.hidden = !file;
    save.disabled = Boolean(file);
    if (!file) return;

    let url;
    try {
      if (!photoMimeTypes.has(file.type) || file.size > 12_000_000) throw new Error('Unsupported photo');
      url = URL.createObjectURL(file);
      const image = new Image();
      image.alt = '試作で選んだトップ写真';
      image.src = url;
      await image.decode();
      if (fileInput.files[0] !== file) {
        URL.revokeObjectURL(url);
        return;
      }
      heroPhoto.append(image);
    } catch {
      if (url) URL.revokeObjectURL(url);
      if (fileInput.files[0] !== file) return;
      fileInput.value = '';
      remove.hidden = true;
      status.textContent = '写真を読み込めませんでした。12 MB以内のJPEG・PNG・WebPを選んでください。';
    }
    save.disabled = false;
  }

  style.addEventListener('change', render);
  name.addEventListener('input', render);
  intro.addEventListener('input', render);
  fileInput.addEventListener('change', loadPhoto);
  remove.addEventListener('click', () => {
    fileInput.value = '';
    loadPhoto();
    fileInput.focus();
  });
  save.addEventListener('click', () => {
    try {
      const canvas = drawTrialImage({
        title: clean(heroTitle.innerText),
        intro: clean(heroText.textContent),
        theme: themeLabel.textContent,
        photo: heroPhoto.querySelector('img'),
      });
      downloadPng(canvas, 'sho-website-trial.png');
      status.textContent = '試作画像を作成しました。端末のダウンロードから確認できます。';
    } catch {
      status.textContent = '画像を作成できませんでした。写真を外すか、画面のスクリーンショットをご利用ください。';
    }
  });
  render();
}
