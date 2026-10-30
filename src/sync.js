import {initial,validate,repositoryFor} from './storage.js';
// One atomic workspace per identity: shift snapshots and related rules travel together.
// CAS is deliberately stricter than last-write-wins: offline edits never silently erase another device.
export function createSync({userId,storage,call,onChange=()=>{},onStatus=()=>{}}){
 const key=`shiftpay-cloud-v3:${userId}`;const migratedKey=key+':migrated';let state, running=false,stopped=false,conflict=false;
 const persist=()=>storage.setItem(key,JSON.stringify(state));
 const status=(kind,message)=>onStatus({kind,message});
 function emit(){if(!stopped)onChange(state.payload);}
 async function pull(){
  const remote=await call('load_workspace');
  if(remote){validate(remote.payload);if(state?.pending){if(remote.version!==state.version){conflict=true;status('conflict','A newer cloud version exists. Your offline changes are kept in this browser.');return;}}
   else{state={payload:remote.payload,version:remote.version,updated_at:remote.updated_at,pending:false};
    if(!storage.getItem(migratedKey)){const legacy=repositoryFor(userId,storage);if(legacy.exists()){
      const old=legacy.load(),payload={...remote.payload};for(const kind of ['rates','shifts','payouts']){const ids=new Set(payload[kind].map(x=>x.id));payload[kind]=[...payload[kind],...old[kind].filter(x=>!ids.has(x.id))];}
      if(!remote.payload.shifts.length&&!remote.payload.payouts.length){payload.rules=old.rules;if(JSON.stringify(remote.payload.rates)===JSON.stringify(initial().rates))payload.rates=old.rates;if(old.tax)payload.tax=old.tax;}
      if(JSON.stringify(payload)!==JSON.stringify(remote.payload))state={...state,payload,pending:true};
    }}persist();emit();}}
  else if(!state){const local=repositoryFor(userId,storage);state={payload:local.load(),version:0,pending:true};persist();emit();}
 }
 async function flush(){
  if(running||stopped||conflict||!state?.pending)return;running=true;
  try{while(state.pending&&!stopped){status('saving','Saving…');const payload=state.payload;const result=await call('save_workspace',{p_payload:payload,p_expected_version:state.version});
   state={...state,version:result.version,updated_at:result.updated_at,pending:state.payload!==payload};persist();storage.setItem(migratedKey,'1');}
   if(!stopped)status('saved','Saved to cloud');
  }catch(e){if(e.code==='PT409'){conflict=true;status('conflict','A newer cloud version exists. Download your local backup before choosing a version.');}else status('failed','Failed to save (retry). '+(e.message||'Connection unavailable'));}
  finally{running=false;}
 }
 return {
 async start(){status('loading','Loading cloud data…');try{const raw=storage.getItem(key);if(raw){state=JSON.parse(raw);validate(state.payload);}await pull();if(state)emit();if(!conflict){if(state.pending)await flush();else {storage.setItem(migratedKey,'1');status('saved','Saved to cloud');}}}
 catch(e){if(state){emit();status('failed','Offline cache loaded. Retry to sync. '+e.message);}else status('blocked','Could not load cloud data. Retry. '+e.message);}},
 save(payload){if(!state)throw Error('Wait for cloud data to load.');validate(payload);const next={...state,payload,pending:true};storage.setItem(key,JSON.stringify(next));state=next;emit();if(conflict)status('conflict','A newer cloud version exists. Local changes are kept until you choose a version.');else status('saving','Saving…');void flush();return true;},
 async retry(){if(running||stopped)return;if(!state)return this.start();try{await pull();if(!conflict){if(state.pending)await flush();else {storage.setItem(migratedKey,'1');status('saved','Saved to cloud');}}}catch(e){status('failed','Failed to sync (retry). '+e.message);}},
 async resolve(keepLocal){const remote=await call('load_workspace');if(!remote)throw Error('Cloud workspace missing. Retry.');validate(remote.payload);
 state=keepLocal?{...state,version:remote.version,pending:true}:{payload:remote.payload,version:remote.version,updated_at:remote.updated_at,pending:false};persist();conflict=false;emit();if(keepLocal)await flush();else status('saved','Loaded cloud version');},
 stop(){stopped=true;},
 };
}
