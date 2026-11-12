export class UploadGateError extends Error{
  status:number;
  constructor(message:string,status=503){super(message);this.name='UploadGateError';this.status=status;}
}
export async function issueIntakeUpload(admin:any,siteId:string,folder:string,fileName:string){
  if(!['top_photos','gallery_photos','logo_file','member_photos'].includes(folder))throw new UploadGateError('アップロード先が不正です。',400);
  if(!/\.(jpe?g|png|webp|gif|avif)$/i.test(fileName))throw new UploadGateError('JPEG・PNG・WebP・GIF・AVIFの画像を選択してください。',400);
  const safeName=('_'+fileName.replace(/[^A-Za-z0-9._-]+/g,'_').slice(-98)).replace(/\.[^.]+$/,ext=>ext.toLowerCase());
  const id=crypto.randomUUID();
  const {data:reserved,error}=await admin.rpc('website_upload_reserve',{p_site:siteId,p_id:id,p_folder:folder,p_name:safeName});
  if(error||!reserved?.path){
    const code=String(error?.message||'');
    if(/UPLOAD_CAPACITY|UPLOAD_RATE_LIMIT/.test(code))throw new UploadGateError('画像の受付上限に達しました。時間を置くか、LINEで運営者へご連絡ください。',429);
    if(code.includes('UPLOAD_STATE'))throw new UploadGateError('現在はこのサイトに画像を追加できません。',409);
    throw new UploadGateError('画像受付の設定を確認中です。LINEで運営者へご連絡ください。');
  }
  const expected=`${siteId}/secure-intake/${folder}/${id}-${safeName}`;
  if(reserved.path!==expected)throw new UploadGateError('画像の保存先を確認できませんでした。');
  // No refund on errors: signing or its response may already have succeeded.
  const {data,error:signError}=await admin.storage.from('website-intake-files').createSignedUploadUrl(expected,{upsert:false});
  if(signError||!data?.token)throw new UploadGateError('画像の送信準備ができませんでした。LINEで運営者へご連絡ください。');
  return {ok:true,path:expected,token:data.token};
}
