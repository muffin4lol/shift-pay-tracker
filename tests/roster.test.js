import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildWeeklyShifts} from '../src/roster.js';
import {initial} from '../src/storage.js';
const data=initial();data.rates[0].amount=10;
const days=()=>Array.from({length:7},(_,i)=>({enabled:i<5,start:'09:00',end:'17:00',breakMinutes:30}));
const roster=(patch={})=>({week:'2026-10-29',name:' Café ',rateId:'default',days:days(),...patch});
test('one roster creates Monday–Friday shifts and independent snapshots',()=>{
  let next=0;const result=buildWeeklyShifts(roster(),data.rates,data.rules,[],()=>String(++next));
  assert.equal(result.length,5);assert.equal(result[0].date,'2026-10-26');assert.equal(result[4].date,'2026-10-30');
  assert.equal(result[0].name,'Café');assert.equal(result[1].pay.total,7500);assert.equal(result[0].pay.total,15000); // Irish October holiday
  assert.notEqual(result[0].pay.rate,result[1].pay.rate);assert.equal(new Set(result.map(s=>s.id)).size,5);
});
test('different hours, overnight shifts, breaks and Sunday premiums',()=>{
  const d=days().map(x=>({...x,enabled:false}));d[5]={enabled:true,start:'22:00',end:'06:00',breakMinutes:60};d[6]={enabled:true,start:'10:00',end:'14:00',breakMinutes:0};
  const result=buildWeeklyShifts(roster({days:d}),data.rates,data.rules);
  assert.equal(result[0].pay.hours,7);assert.equal(result[0].pay.total,7000);assert.equal(result[1].date,'2026-11-01');assert.equal(result[1].pay.total,6000);
});
test('weeks cross year boundaries using calendar dates',()=>{
  const result=buildWeeklyShifts(roster({week:'2027-01-01',days:days().map(x=>({...x,enabled:true}))}),data.rates,data.rules);
  assert.equal(result[0].date,'2026-12-28');assert.equal(result[6].date,'2027-01-03');
});
test('invalid days reject the entire batch without changing existing records',()=>{
  const d=days();d[4].breakMinutes=480;const existing=[];
  assert.throws(()=>buildWeeklyShifts(roster({days:d}),data.rates,data.rules,existing),/2026-10-30.*Break/);assert.deepEqual(existing,[]);
});
test('exact repeated shifts are rejected instead of silently duplicated',()=>{
  const prior=buildWeeklyShifts(roster(),data.rates,data.rules);
  assert.throws(()=>buildWeeklyShifts(roster({name:'café'}),data.rates,data.rules,prior),/already in your list/);assert.equal(prior.length,5);
});
test('days off do not require times; blank rosters and unavailable rates fail clearly',()=>{
  const d=days();d[5]={enabled:false,start:'',end:'',breakMinutes:''};assert.equal(buildWeeklyShifts(roster({days:d}),data.rates,data.rules).length,5);
  assert.throws(()=>buildWeeklyShifts(roster({days:d.map(x=>({...x,enabled:false}))}),data.rates,data.rules),/at least one/);
  assert.throws(()=>buildWeeklyShifts(roster({rateId:'deleted'}),data.rates,data.rules),/hourly rate/);
  assert.throws(()=>buildWeeklyShifts(roster({name:' '}),data.rates,data.rules),/name/);
});
