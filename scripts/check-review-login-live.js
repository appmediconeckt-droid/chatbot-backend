// Authorized demo credentials only. Never log credentials, bodies, or tokens.
const password=process.env.DEMO_ACCOUNT_PASSWORD;
if(!password) throw new Error('DEMO_ACCOUNT_PASSWORD required');
const base='https://chatbot-backend-production-82fb.up.railway.app';
const emails=['demo.user1@humaeli.com','appstore.user@humaeli.com','demo.counsellor1@humaeli.com','appstore.counsellor@humaeli.com'];
async function post(path,body,token,refresh){
 const r=await fetch(base+'/api/auth/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{}),...(refresh?{Cookie:'refreshToken='+encodeURIComponent(refresh)}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 return {status:r.status,data:await r.json().catch(()=>({}))};
}
const output={at:new Date().toISOString(),accounts:[]};
for(const email of emails){
 const role=email.includes('counsellor')?'counsellor':'user';
 let session;
 const result={email};
 try{
  const existing=await post('verify-password-otp',{email,otp:'123456'});
  result.existingLegacyFixedOtp=existing.status;
  if(process.env.PROBE_REVIEW_OTP==='true') {
   const issued=await post('generateOtp',{email,password,role});
   result.legacyIssue=issued.status;
   if(issued.status===200){
    result.issuedFixedOtpValidation=(await post('verify-password-otp',{email,otp:'123456'})).status;
    result.issuedWrongOtpValidation=(await post('verify-password-otp',{email,otp:'000000'})).status;
   }
  }
  const login=await post('login',{email,password,role});
  result.passwordLogin=login.status;
  if(login.status===200){
   session=login.data;
   result.returnedRole=session.role||session.user?.role;
   const me=await fetch(base+'/api/auth/me',{headers:{Authorization:'Bearer '+session.accessToken},signal:AbortSignal.timeout(15000)});
   result.sessionProfile=me.status;
  } else result.sessionTakeoverSkipped=true;
 }catch{result.transportError=true;}
 finally{
  if(session?.accessToken){
   try{result.ownSessionLogout=(await post('logout',{},session.accessToken,session.refreshToken)).status;}catch{result.logoutTransportError=true;}
  }
 }
 output.accounts.push(result);
}
console.log(JSON.stringify(output,null,2));
