import React,{createContext,useContext,useEffect,useRef,useState} from 'react';
import {supabase,configured,configurationError,rpc} from './client';
import {defaults,validatePreferences,validateProfile,accessError} from './model';
import {accountQueue} from './pending';
const AccountContext = createContext(null);
export const useAccount=()=>useContext(AccountContext);

export function AccountProvider({children}) {
  const [session,setSession]=useState(null),[account,setAccount]=useState(null);
  const [loading,setLoading]=useState(configured),[error,setError]=useState(configurationError||'');
  const [recovery,setRecovery]=useState(false);
  const [syncMessage,setSyncMessage]=useState('');
  const replaying=useRef(false);
  const generation=useRef(0), current=useRef(null);
  
  const apply=value=>{current.current=value;setAccount(value);};
  const withPending=value=>{const pending=accountQueue(localStorage,value.profile.user_id).read();return {...value,profile:{...value.profile,...pending.profile?.value},settings:{...value.settings,preferences:{...value.settings.preferences,...pending.settings?.value}}};};
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
      apply(withPending(result));setError('');
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
        if(!stopped&&current.current===snapshot&&session.user.id===next.profile.user_id&&!Object.keys(accountQueue(localStorage,session.user.id).read()).length)apply(next);
      }catch(e){if(!stopped){if(['42501','PGRST301','PGRST302'].includes(e.code)||e.status===401||e.status===403){apply(null);setError(accessError(e));}else setSyncMessage('Account connection unavailable. Cached profile remains visible; retry when online.');}}
    }
    // Revocation is immediate at the DB. Recheck removes already-rendered UI within 60s.
    const timer=setInterval(recheck,60000);
    window.addEventListener('focus',recheck);
    return()=>{stopped=true;clearInterval(timer);window.removeEventListener('focus',recheck);};
  },[session?.user.id]);
  async function signOut(){++generation.current;apply(null);setSession(null);setRecovery(false);setError('');await supabase?.auth.signOut({scope:'local'});}
  async function replayPending(){
    const origin=current.current;if(!origin||replaying.current)return;
    const identity=origin.profile.user_id,queue=accountQueue(localStorage,identity);replaying.current=true;
    try{for(const kind of ['profile','settings']){const pending=queue.read();const item=pending[kind];if(!item)continue;
      setSyncMessage('Saving account changes…');
      const result=kind==='profile'?await rpc('update_profile',{p_display_name:item.value.display_name,p_avatar_url:item.value.avatar_url,p_bio:item.value.bio,p_expected_version:item.version}):await rpc('patch_settings',{p_preferences:item.value,p_expected_version:item.version});
      const latest=queue.read();if(latest[kind]?.token===item.token){delete latest[kind];queue.write(latest);}
      else if(latest[kind]){latest[kind].version=result.version;queue.write(latest);}
      if(current.current?.profile.user_id===identity)apply(withPending({...current.current,[kind]:result}));
    }setSyncMessage(Object.keys(queue.read()).length?'Changes queued. Retry account sync.':'Account saved to cloud');
    }catch(e){setSyncMessage(e.code==='PT409'?'Newer account data exists. Download queued changes, then reload before retrying.':'Failed to save account (retry). '+e.message);throw e;}
    finally{replaying.current=false;}
  }
  function queueChange(kind,value){const origin=current.current;if(!origin)throw Error('Sign in first.');const queue=accountQueue(localStorage,origin.profile.user_id),pending=queue.read();
    pending[kind]={value:kind==='settings'?{...pending.settings?.value,...value}:value,version:pending[kind]?.version??origin[kind].version,token:crypto.randomUUID()};queue.write(pending);
    // Show edits immediately; the queue preserves the server version for safe replay.
    apply({...origin,[kind]:kind==='profile'?{...origin.profile,...value}:{...origin.settings,preferences:{...origin.settings.preferences,...value}}});
    setSyncMessage('Saving account changes…');void replayPending().catch(()=>{});return Promise.resolve();
  }
  function saveProfile(profile){return queueChange('profile',validateProfile(profile));}
  function savePreferences(patch){validatePreferences(patch);return queueChange('settings',patch);}
  useEffect(()=>{if(!session?.user.id)return;const retry=()=>void replayPending().catch(()=>{});window.addEventListener('online',retry);const timer=setInterval(retry,30000);retry();return()=>{clearInterval(timer);window.removeEventListener('online',retry);};},[session?.user.id,!!account]);
  function discardPending(){if(!current.current)return;accountQueue(localStorage,current.current.profile.user_id).clear();setSyncMessage('');return loadAccount(session);}
  return <AccountContext.Provider value={{enabled:configured,configurationError,session,account,loading,error,recovery,setRecovery,
    profile:account?.profile,preferences:{...defaults,...account?.settings.preferences},role:account?.access.role,
    saveProfile,savePreferences,syncMessage,retryAccount:replayPending,discardPending,signOut,reload:()=>loadAccount(session)}}>{children}</AccountContext.Provider>;
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
