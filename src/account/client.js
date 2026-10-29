import {createClient} from '@supabase/supabase-js';
import {configurationProblem} from './model';
const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
export const configurationError = configurationProblem(url,key,import.meta.env.VITE_REQUIRE_AUTH==='true',import.meta.env.DEV);
export const configured = Boolean(url && key && !configurationError);
const authStorage={
  // Only the one-time PKCE verifier is shared across tabs so email links work
  // from a mail client. Access and refresh tokens remain in sessionStorage.
  getItem(name){return (name.endsWith('-code-verifier')?localStorage:sessionStorage).getItem(name);},
  setItem(name,value){(name.endsWith('-code-verifier')?localStorage:sessionStorage).setItem(name,value);},
  removeItem(name){(name.endsWith('-code-verifier')?localStorage:sessionStorage).removeItem(name);},
};
// sessionStorage survives refresh in this tab, but is removed when the tab closes.
// JWT authentication is needed on a static host; HttpOnly cookies would require a server/BFF.
export const supabase = configured ? createClient(url, key, {
  auth:{storage:authStorage, storageKey:'shiftpay-auth-v2', persistSession:true,
    autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce'},
}) : null;
export async function rpc(name, args = {}) {
  if (!supabase) throw Error('Accounts have not been configured.');
  const {data,error} = await supabase.rpc(name,args);
  if (error) throw error;
  return data;
}
