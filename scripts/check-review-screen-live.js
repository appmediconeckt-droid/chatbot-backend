// Exact four authorized review accounts. Never overwrite an existing device session.
const base=process.env.REVIEW_TEST_BASE_URL;
if(!['http://127.0.0.1:5005','https://chatbot-backend-production-82fb.up.railway.app'].includes(base)) throw new Error('Select the local or production Humaeli backend explicitly');
const password=process.env.DEMO_ACCOUNT_PASSWORD;
if(!password) throw new Error('DEMO_ACCOUNT_PASSWORD required');
const emails=['demo.user1@humaeli.com','appstore.user@humaeli.com','demo.counsellor1@humaeli.com','appstore.counsellor@humaeli.com'];
const post=async(path,body,session)=>{
 const r=await fetch(base+'/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(session?{Authorization:'Bearer '+session.accessToken,Cookie:'refreshToken='+encodeURIComponent(session.refreshToken)}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 return {status:r.status,data:await r.json().catch(()=>({}))};
};
const results={at:new Date().toISOString(),target:base,accounts:[]};
for(const email of emails){
 const role=email.includes('counsellor')?'counsellor':'user',body={email,password,role};
 const row={email}; let session;
 try{
  const fresh=await post('login',body); row.passwordLogin=fresh.status;
  if(fresh.status!==200){row.existingSessionNotReplaced=true;continue;}
  session=fresh.data;
  row.send=(await post('generateOtp',body)).status;
  if(row.send!==200) continue;
  row.missingPassword=(await post('verifyOtp',{email,role,otp:'123456'})).status;
  row.wrongPassword=(await post('verifyOtp',{...body,password:password+'-incorrect',otp:'123456'})).status;
  row.wrong=(await post('verifyOtp',{...body,otp:'000000'})).status;
  row.resend=(await post('resendOtp',body)).status;
  const verifications=await Promise.all([1,2].map(()=>post('verifyOtp',{...body,otp:'123456'})));
  row.fixedCodeStatuses=verifications.map(x=>x.status);
  const accepted=verifications.find(x=>x.status===200);
  if(accepted){session=accepted.data;row.role=session.role||session.user?.role;}
  row.singleSuccess=verifications.filter(x=>x.status===200).length===1;
  const me=await fetch(base+'/api/auth/me',{headers:{Authorization:'Bearer '+session.accessToken},signal:AbortSignal.timeout(10000)});
  row.session=me.status;
  const refreshed=await post('refresh-token',{refreshToken:session.refreshToken});
  row.refresh=refreshed.status;
  if(refreshed.status===200) session={...session,...refreshed.data};
  row.resetCodeRejected=(await post('verify-forgot-password-otp',{email,otp:'123456'})).status;
  row.replay=(await post('verifyOtp',{...body,otp:'123456'})).status;
 }catch{row.transportError=true;}
 finally{
  if(session?.accessToken){try{row.ownSessionLogout=(await post('logout',{},session)).status;}catch{row.logoutTransportError=true;}}
  results.accounts.push(row);
 }
}
console.log(JSON.stringify(results,null,2));
