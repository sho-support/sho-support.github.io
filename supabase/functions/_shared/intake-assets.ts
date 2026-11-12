import {normalizeIntakeAssets,verifyIntakeAssets,IntakeAssetError} from './intake-assets.mjs';
export async function requireIntakeAssets(admin:any,siteId:string,payload:any,verify=false){
  if(!verify)return normalizeIntakeAssets(siteId,payload);
  const result=await verifyIntakeAssets(siteId,payload,async(path:string)=>{
    const {data,error}=await admin.storage.from('website-intake-files').info(path);
    if(error||!data)throw new Error('Storage metadata unavailable');return data;
  });
  return result.payload;
}
export async function intakeAssetProblem(admin:any,siteId:string,payload:any,verify=false){
  try{Object.assign(payload,await requireIntakeAssets(admin,siteId,payload,verify));return null;}
  catch(e){return e instanceof IntakeAssetError?{message:e.message,status:e.status}:{message:'画像の確認に失敗しました。再度お試しください。',status:503};}
}
