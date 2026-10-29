import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {supabase,configured,configurationError,rpc} from './client';
import {defaults,validatePreferences,validateProfile,accessError} from './model';
const AccountContext = createContext(null);
export const useAccount=()=>useContext(AccountContext);

export function AccountProvider({children}) {
  const [session,setSession]=useState(null),[account,setAccount]=useState(null);
  const [loading,setLoading]=useState(configured),[error,setError]=useState(configurationError||'');
  const [recovery,setRecovery]=useState(false);
  const generation=useRef(0), current=useRef(null);
  const settingsQueue=useRef(Promise.resolve());
  const apply=value=>{current.current=value;setAccount(value);};
  async function loadAccount(nextSession) {
    const request=++generation.current;
    setSession(nextSession);
    // Remove the previous identity's UI before fetching another identity.
    if(current.current?.profile?.user_id!==nextSession?.user.id)apply(null);
    if(!nextSession){apply(null);setLoading(false);return;}
    if(!current.current)setLoading(true);
    try{
      const result=await rpc('account_bootstrap');
      if(request!==generation.current)return;
      apply(result);setError('');
    }catch(e){
      if(request!==generation.current)return;
      apply(null);setError(accessError(e));
    }finally{if(request===generation.current)setLoading(false);}
  }
  useEffect(()=>{
    if(!supabase)return;
    let disposed=false;
    // Avoid calling async Auth APIs inside onAuthStateChange's internal lock.
    const {data:{subscription}}=supabase.auth.onAuthStateChange((event,next)=>{
      if(event==='PASSWORD_RECOVERY')setRecovery(true);
      setTimeout(()=>{if(!disposed)void loadAccount(next);},0);
    });
    // The SDK emits INITIAL_SESSION after storage and PKCE callback processing.
    return()=>{disposed=true;++generation.current;subscription.unsubscribe();};
  },[]);
  useEffect(()=>{
    if(!session||!supabase)return;
    let stopped=false;
    async function recheck(){
      if(document.visibilityState!=='visible')return;
      const snapshot=current.current;
      try{
        const next=await rpc('account_bootstrap');
        if(!stopped&&current.current===snapshot&&session.user.id===next.profile.user_id)apply(next);
      }catch(e){if(!stopped){apply(null);setError(accessError(e));}}
    }
    // Revocation is immediate at the DB. Recheck removes already-rendered UI within 60s.
    const timer=setInterval(recheck,60000);
    window.addEventListener('focus',recheck);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',recheck);};
  },[session?.user.id]);
  async function signOut(){++generation.current;apply(null);setSession(null);setRecovery(false);setError('');await supabase?.auth.signOut({scope:'local'});}
  async function saveProfile(profile){
    const origin=current.current;const clean=validateProfile(profile);
    const result=await rpc('update_profile',{p_display_name:clean.display_name,p_avatar_url:clean.avatar_url,p_bio:clean.bio,p_expected_version:origin.profile.version});
    if(current.current?.profile.user_id===origin.profile.user_id)apply({...current.current,profile:result});
    return result;
  }
  function savePreferences(patch){
    validatePreferences(patch);
    // Serialize this tab's writes; DB version checks catch other-tab/device conflicts.
    const identity=current.current?.profile.user_id;
    const operation=settingsQueue.current.catch(()=>{}).then(async()=>{
      const origin=current.current;
      if(!origin||origin.profile.user_id!==identity)throw Error('Account changed. Please retry.');
      const result=await rpc('patch_settings',{p_preferences:patch,p_expected_version:origin.settings.version});
      if(current.current?.profile.user_id===identity)apply({...current.current,settings:result});
      return result;
    });
    settingsQueue.current=operation;
    return operation;
  }
  return <AccountContext.Provider value={{enabled:configured,configurationError,session,account,loading,error,recovery,setRecovery,
    profile:account?.profile,preferences:{...defaults,...account?.settings.preferences},role:account?.access.role,
    saveProfile,savePreferences,signOut,reload:()=>loadAccount(session)}}>{children}</AccountContext.Provider>;
}

export function AccountGate({children}) {
  const auth=useAccount();
  if(auth.configurationError)return <AccountScreen><h1>Account setup needs attention</h1><p role="alert">{auth.configurationError}</p></AccountScreen>;
  if(!auth.enabled)return children;
  if(auth.loading)return <AccountScreen><h1>Opening your workspace…</h1><p role="status">Checking your access securely.</p></AccountScreen>;
  if(!auth.account||auth.recovery)return <LoginScreen/>;
  return children;
}
function AccountScreen({children}){return <div className="account-screen"><section className="account-card"><div className="account-brand">↗ shiftpay</div>{children}</section></div>;}
function LoginScreen(){
  const auth=useAccount();const [mode,setMode]=useState('login'),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  async function submit(e){
    e.preventDefault();setBusy(true);setError('');setMessage('');
    const f=new FormData(e.target),email=String(f.get('email')||'').trim(),password=String(f.get('password')||'');
    const redirect=new URL(import.meta.env.BASE_URL,location.href).href;
    try{
      let response;
      if(auth.recovery){response=await supabase.auth.updateUser({password});if(response.error)throw response.error;auth.setRecovery(false);setMessage('Password updated.');await auth.reload();}
      else if(mode==='reset'){response=await supabase.auth.resetPasswordForEmail(email,{redirectTo:redirect});if(response.error)throw response.error;setMessage('If the account is eligible, a password reset email will arrive shortly.');}
      else if(mode==='signup'){response=await supabase.auth.signUp({email,password,options:{emailRedirectTo:redirect}});if(response.error)throw response.error;setMessage('If your address is approved, check your email to confirm your account.');}
      else{response=await supabase.auth.signInWithPassword({email,password});if(response.error)throw response.error;}
    }catch(err){setError(accessError(err));}finally{setBusy(false);}
  }
  return <AccountScreen><p className="eyebrow">YOUR WORKSPACE, SECURELY</p><h1>{auth.recovery?'Choose a new password':auth.session&&!auth.account?'Access restricted':mode==='signup'?'Create your account':mode==='reset'?'Reset your password':'Welcome back'}</h1><p>Access is available to approved email addresses. Contact your administrator if you need an invitation.</p>
    {(error||auth.error)&&<p className="error" role="alert">{error||auth.error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    {auth.session&&!auth.account&&!auth.recovery?<div className="actions"><button onClick={auth.reload}>Check access again</button><button onClick={auth.signOut}>Sign out</button></div>:<><form onSubmit={submit}>{!auth.recovery&&<label>Email address<input type="email" name="email" required autoComplete="email" maxLength="254"/></label>}{(auth.recovery||mode!=='reset')&&<label>Password<input name="password" type="password" required minLength={auth.recovery||mode==='signup'?12:1} maxLength="128" autoComplete={auth.recovery||mode==='signup'?'new-password':'current-password'}/></label>}<button className="primary" disabled={busy}>{busy?'Please wait…':auth.recovery?'Update password':mode==='signup'?'Create account':mode==='reset'?'Send reset email':'Sign in'}</button></form>{!auth.recovery&&<div className="auth-links">{['login','signup','reset'].filter(m=>m!==mode).map(m=><button key={m} onClick={()=>{setMode(m);setError('');setMessage('')}}>{m==='login'?'Sign in':m==='signup'?'Create an account':'Forgot password?'}</button>)}</div>}</>}
    <small>Passwords are handled by Supabase Auth. Profile and preference data is stored in your project. Shift records stay on this device.</small>
  </AccountScreen>;
}
