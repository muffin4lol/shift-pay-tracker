import React,{useState} from 'react';
import './roster.css';
import {X,CalendarDays,Check} from 'lucide-react';
import {weekOf,addDays,totals} from './pay';
import {buildWeeklyShifts} from './roster';
const dayNames=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const money=(n,c)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:c}).format(n/100);
const labelDate=d=>new Date(d+'T12:00:00').toLocaleDateString('en-IE',{day:'numeric',month:'short'});
export default function WeeklyShiftForm({data,initialWeek,onSave,onClose}) {
  const [week,setWeek]=useState(weekOf(initialWeek));
  const [name,setName]=useState(''),[rateId,setRateId]=useState(data.rates[0]?.id||'');
  const [defaults,setDefaults]=useState({start:'09:00',end:'17:00',breakMinutes:0});
  const [days,setDays]=useState(()=>dayNames.map((_,i)=>({...defaults,enabled:i<5})));
  const [saveError,setSaveError]=useState('');
  function updateDay(index,patch){setSaveError('');setDays(current=>current.map((day,i)=>i===index?{...day,...patch}:day));}
  const draft={week,name,rateId,days};
  let preview=[],validation='';
  try{preview=buildWeeklyShifts(draft,data.rates,data.rules,data.shifts,()=> 'preview');}catch(e){validation=e.message;}
  const summary=totals(preview),rate=data.rates.find(r=>r.id===rateId);
  async function submit(e){
    e.preventDefault();setSaveError('');
    try{
      const shifts=buildWeeklyShifts(draft,data.rates,data.rules,data.shifts);
      const saved=onSave(shifts,week);
      if(saved===false)setSaveError('The week could not be saved. Check available browser storage and try again.');
    }catch(err){setSaveError(err.message);}
  }
  return <div className="overlay"><dialog className="weekly-dialog" ref={el=>{if(el&&!el.open)el.showModal()}} aria-labelledby="weekly-title" onCancel={e=>{e.preventDefault();onClose();}}>
    <div className="modal-heading"><div><p className="eyebrow">YOUR WHOLE ROSTER, ONE SAVE</p><h2 id="weekly-title">Add a week of shifts</h2></div><button className="icon" aria-label="Close weekly entry" onClick={onClose}><X size={20}/></button></div>
    <form onSubmit={submit}>
      <div className="form-row"><label>Week containing<input autoFocus type="date" required value={week} onChange={e=>{if(e.target.value){setWeek(weekOf(e.target.value));setSaveError('');}}}/><small>Monday {labelDate(week)} – Sunday {labelDate(addDays(week,6))}</small></label><label>Shift / job name<input required maxLength="100" value={name} onChange={e=>{setName(e.target.value);setSaveError('');}} placeholder="e.g. Café roster"/></label></div>
      <label>Hourly rate for this roster<select required value={rateId} onChange={e=>{setRateId(e.target.value);setSaveError('');}}><option value="" disabled>Choose a rate</option>{data.rates.map(r=><option key={r.id} value={r.id}>{r.name} · {money(Math.round(r.amount*100),r.currency)}/hr</option>)}</select></label>
      <fieldset className="roster-defaults"><legend>Use the same times on working days</legend><div className="roster-default-fields"><label>Start<input type="time" value={defaults.start} onChange={e=>setDefaults({...defaults,start:e.target.value})}/></label><label>End<input type="time" value={defaults.end} onChange={e=>setDefaults({...defaults,end:e.target.value})}/></label><label>Break (minutes)<input type="number" min="0" step="1" value={defaults.breakMinutes} onChange={e=>setDefaults({...defaults,breakMinutes:e.target.value})}/></label></div><button type="button" onClick={()=>{setDays(current=>current.map(day=>day.enabled?{...day,...defaults}:day));setSaveError('');}}>Apply to selected days</button></fieldset>
      <div className="roster-selection"><span>Select working days</span><button type="button" onClick={()=>{setDays(current=>current.map((d,i)=>({...d,enabled:i<5})));setSaveError('');}}>Mon–Fri</button><button type="button" onClick={()=>{setDays(current=>current.map(d=>({...d,enabled:true})));setSaveError('');}}>All days</button><button type="button" onClick={()=>{setDays(current=>current.map(d=>({...d,enabled:false})));setSaveError('');}}>Clear</button></div>
      <div className="roster-days">{days.map((day,index)=>{
        const date=addDays(week,index),pay=preview.find(s=>s.date===date)?.pay;
        return <section className={'roster-day '+(!day.enabled?'day-off':'')} key={index} aria-label={dayNames[index]}><div className="roster-day-heading"><label className="roster-checkbox"><input type="checkbox" checked={day.enabled} onChange={e=>updateDay(index,{enabled:e.target.checked})}/><span>{dayNames[index]}<small>{labelDate(date)}</small></span></label><span className="roster-pay">{day.enabled?(pay?money(pay.total,pay.rate.currency):'—'):'Day off'}{pay?.labels.length>0&&<small className="bonus">✦ {pay.labels.join(' + ')}</small>}</span></div>{day.enabled&&<div className="roster-times"><label>Start<input aria-label={`${dayNames[index]} start`} type="time" required value={day.start} onChange={e=>updateDay(index,{start:e.target.value})}/></label><label>End<input aria-label={`${dayNames[index]} end`} type="time" required value={day.end} onChange={e=>updateDay(index,{end:e.target.value})}/></label><label>Break (min)<input aria-label={`${dayNames[index]} break`} type="number" min="0" step="1" required value={day.breakMinutes} onChange={e=>updateDay(index,{breakMinutes:e.target.value})}/></label>{day.end<day.start&&<small className="overnight-note">Ends the following day</small>}</div>}</section>;
      })}</div>
      {(saveError||validation)&&<p className={saveError?'error':'form-help'} role={saveError?'alert':'status'}>{saveError||validation}</p>}
      <div className="estimate-preview"><span>{summary.count} shifts · {summary.hours.toFixed(2)} paid hours</span><strong>{rate?money(summary.total,rate.currency):'—'}</strong><small>Each day keeps its own rate and bonus calculation. Existing shifts are preserved.</small></div>
      <p className="form-help">Deselect days off and adjust each day’s times or break. Overnight shifts and special-day bonuses work just like a single shift. You can edit each saved day separately afterwards.</p>
      <div className="roster-submit"><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={Boolean(validation)||!preview.length}><Check size={16}/> Save {summary.count||''} shifts</button></div>
    </form>
  </dialog></div>;
}
