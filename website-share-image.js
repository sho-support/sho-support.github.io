export const imageFont = '"Noto Sans JP", "Hiragino Sans", Meiryo, sans-serif';

export function wrapImageText(context, text, width) {
  const lines = [''];
  for (const character of text) {
    const line = lines.length - 1;
    const next = lines[line] + character;
    if (lines[line] && context.measureText(next).width > width) lines.push(character.trimStart());
    else lines[line] = next;
  }
  return lines;
}

export function downloadPng(canvas, filename) {
  const link = document.createElement('a');
  const image = canvas.toDataURL('image/png');
  if (image === 'data:,') throw new Error('Could not draw the image');
  link.href = image;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
}
