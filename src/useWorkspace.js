import {useEffect,useMemo,useState} from 'react';
import {createSync} from './sync.js';
import {rpc} from './account/client.js';
import {repositoryFor,initial} from './storage.js';
export function useWorkspace(auth){
 const [data,setData]=useState(null),[status,setStatus]=useState({kind:'loading',message:'Loading…'});
 const local=useMemo(()=>repositoryFor(null),[]);
 const sync=useMemo(()=>auth.enabled?createSync({userId:auth.session.user.id,storage:localStorage,call:rpc,onChange:setData,onStatus:setStatus}):null,[auth.enabled,auth.session?.user.id]);
 useEffect(()=>{if(!sync){try{setData(local.load());setStatus({kind:'local',message:'Saved on this device'});}catch(e){setStatus({kind:'blocked',message:e.message});}return;}
 void sync.start();const retry=()=>void sync.retry();const focus=()=>{if(document.visibilityState==='visible')retry();};window.addEventListener('online',retry);window.addEventListener('focus',focus);const timer=setInterval(focus,30000);
 return()=>{sync.stop();clearInterval(timer);window.removeEventListener('online',retry);window.removeEventListener('focus',focus);};},[sync]);
 return {data:data||initial(),ready:!!data,status,retry:()=>sync?.retry(),resolve:keep=>sync?.resolve(keep),save:next=>{if(sync)return sync.save(next);local.save(next);setData(next);return true;}};
}
