export const MATERIAL_LIMITS=Object.freeze({files:50,totalBytes:30_000_000,fileBytes:7_000_000});
const groups=['top_photos','gallery_photos','logo_file','member_photos'];
const mimeByExtension={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',avif:'image/avif'};
export class IntakeAssetError extends Error{
  constructor(message,status=400){super(message);this.name='IntakeAssetError';this.status=status;}
}
function ownedPath(siteId,path){
  if(typeof path!=='string'||path.length>300||!path.startsWith(siteId+'/')||!/^[A-Za-z0-9_./-]+$/.test(path)
    ||path.split('/').some(s=>!s||s==='.'||s==='..'||s.startsWith('.')))throw new IntakeAssetError('添付画像の保存先を確認できません。フォームから画像を選び直してください。');
  const ext=path.split('.').pop().toLowerCase();
  if(!mimeByExtension[ext])throw new IntakeAssetError('画像はJPEG・PNG・WebP・GIF・AVIFを選択してください。');
  return ext;
}
// Validate EVERY reference before privileged Storage/GitHub/AI work, including member photos.
export function normalizeIntakeAssets(siteId,payload){
  if(!/^[A-Za-z0-9_-]{3,32}$/.test(siteId)||!payload||typeof payload!=='object'||Array.isArray(payload))throw new IntakeAssetError('制作データの形式が正しくありません。');
  const input=payload.files??{};
  if(typeof input!=='object'||Array.isArray(input))throw new IntakeAssetError('添付画像の形式が正しくありません。');
  const files=Object.fromEntries(groups.map(k=>[k,[]])),seen=new Map();let references=0;
  function add(group,item){
    if(++references>200)throw new IntakeAssetError('画像の指定が多すぎます。',413);
    if(!item||typeof item!=='object'||Array.isArray(item))throw new IntakeAssetError('添付画像の形式が正しくありません。');
    const ext=ownedPath(siteId,item.path),name=String(item.name||'').trim();
    if(!name||name.length>160)throw new IntakeAssetError('添付画像の名前を確認してください。');
    const previous=seen.get(item.path);
    if(previous){if(previous!==group)throw new IntakeAssetError('同じ保存画像を別の入力欄に直接指定することはできません。');return;}
    if(seen.size>=MATERIAL_LIMITS.files)throw new IntakeAssetError('画像素材は合計50点以内です。多い場合は送信前にLINEでご相談ください。',413);
    seen.set(item.path,group);files[group].push({path:item.path,name,...(Number.isSafeInteger(item.size)&&item.size>0?{size:item.size}:{}),type:mimeByExtension[ext]});
  }
  for(const [group,list]of Object.entries(input)){
    if(!groups.includes(group)||!Array.isArray(list))throw new IntakeAssetError('添付画像の項目が正しくありません。');
    for(const item of list)add(group,item);
  }
  if(payload.members!==undefined&&!Array.isArray(payload.members))throw new IntakeAssetError('メンバー情報の形式が正しくありません。');
  if((payload.members||[]).length>50)throw new IntakeAssetError('メンバー情報は50件以内で入力してください。',413);
  for(const member of payload.members||[])if(member?.photo?.path)add('member_photos',member.photo);
  return {...payload,files};
}
export async function verifyIntakeAssets(siteId,payload,getMetadata){
  const normalized=normalizeIntakeAssets(siteId,payload),files=Object.values(normalized.files).flat();
  let total=0;
  for(let i=0;i<files.length;i+=4){
    const batch=files.slice(i,i+4);
    const metadata=await Promise.all(batch.map(async file=>{
      try{return await getMetadata(file.path);}catch{throw new IntakeAssetError('画像の保存確認ができませんでした。時間を置いて再度送信してください。',503);}
    }));
    for(let j=0;j<batch.length;j++){
      const m=metadata[j],size=Number(m?.size??m?.metadata?.size),type=m?.contentType??m?.metadata?.mimetype;
      if(!Number.isSafeInteger(size)||size<1||size>MATERIAL_LIMITS.fileBytes)throw new IntakeAssetError('保存画像は1点7MB以内のファイルを選んでください。',413);
      if(type!==batch[j].type)throw new IntakeAssetError('画像の形式と保存内容が一致しません。画像を選び直してください。');
      total+=size;if(total>MATERIAL_LIMITS.totalBytes)throw new IntakeAssetError('画像素材の合計は30MB以内です。多い場合は送信前にLINEでご相談ください。',413);
      batch[j].size=size;
    }
  }
  return {payload:normalized,totalBytes:total,fileCount:files.length};
}
