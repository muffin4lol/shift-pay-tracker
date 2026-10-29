import {addDays,weekOf,calculate} from './pay.js';
const signature=s=>JSON.stringify([s.name.trim().toLowerCase(),s.date,s.start,s.end]);

// Build and validate the whole roster before the repository performs one atomic save.
export function buildWeeklyShifts({week,name,rateId,days},rates,rules,existing=[],makeId=()=>crypto.randomUUID()) {
  const monday=weekOf(week);
  const cleanName=typeof name==='string'?name.trim():'';
  if(!cleanName||cleanName.length>100)throw Error('Enter a shift / job name (up to 100 characters).');
  const rate=rates.find(r=>r.id===rateId);
  if(!rate)throw Error('Choose an hourly rate. Add one in Settings if needed.');
  if(!Array.isArray(days)||days.length!==7)throw Error('A roster must contain Monday through Sunday.');
  if(!days.some(day=>day.enabled))throw Error('Select at least one working day.');
  const used=new Set(existing.map(signature));
  return days.flatMap((day,index)=>{
    if(!day.enabled)return [];
    const shift={name:cleanName,date:addDays(monday,index),start:day.start,end:day.end,breakMinutes:Number(day.breakMinutes)};
    try{
      if(used.has(signature(shift)))throw Error('This shift is already in your list. Edit the existing entry or deselect this day.');
      const pay=calculate(shift,rate,rules);
      return [{...shift,id:makeId(),pay}];
    }catch(error){throw Error(`${shift.date}: ${error.message}`);}
  });
}
