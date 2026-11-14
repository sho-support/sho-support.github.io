// Browser preflight only. The server verifies ownership and actual Storage metadata again.
export const MATERIAL_LIMITS=Object.freeze({files:50,totalBytes:30_000_000,fileBytes:7_000_000});
const types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'};
export function checkMaterialSelection(retained,selected){
 const saved=[...new Map(retained.filter(x=>x?.path).map(x=>[x.path,x])).values()];
 if(saved.length+selected.length>MATERIAL_LIMITS.files)throw new Error('画像素材は合計50点以内です。多い場合は送信前にLINEでご相談ください。');
 let total=saved.reduce((sum,x)=>sum+(Number.isSafeInteger(Number(x.size))&&Number(x.size)>0?Number(x.size):MATERIAL_LIMITS.fileBytes),0);
 for(const file of selected){
  const type=types[String(file.name||'').split('.').pop().toLowerCase()];
  if(!type||(file.type&&file.type!==type))throw new Error('画像はJPEG・PNG・WebP・GIF・AVIFを選択してください。');
  if(!String(file.name||'').trim()||file.name.length>160)throw new Error('画像ファイル名は160文字以内にしてください。');
  if(!Number.isSafeInteger(file.size)||file.size<1||file.size>MATERIAL_LIMITS.fileBytes)throw new Error(file.name+' は1点7MB以内の画像を選択してください。');
  total+=file.size;
 }
 if(total>MATERIAL_LIMITS.totalBytes)throw new Error('画像素材の合計は30MB以内です。多い場合は送信前にLINEでご相談ください。');
 return {fileCount:saved.length+selected.length,totalBytes:total};
}
