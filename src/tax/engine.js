import config from './2026.json' with {type:'json'};
export const taxConfig=config;
export const taxDefaults={frequency:'weekly',basis:'week1',status:'single',spouseIncome:0,extraCredits:0,expenseAllowance:0,age:25,statePension:false,legacyPensionExempt:false,medicalCard:false,annualIncome:30000,prsiClass:'A1',pensionPercent:0,cycle:0,union:0,insurance:0,other:0,hasPps:true,employmentWeek:1,useRpn:false,rpnCredits:4000,rpnBand:44000,allocatedCredits:null,allocatedBand:null,uscBand1:12012,uscBand2:28700,uscBand3:70044,period:1,priorTaxable:0,priorPaye:0,priorUscGross:0,priorUsc:0};
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const nonneg=(n,name)=>{if(!Number.isFinite(n)||n<0)throw Error(`Invalid ${name}`);return n;};
export function bandsTax(gross,bands,factor=1){let lower=0,total=0;for(const [limit,rate] of bands){const upper=limit===null?Infinity:limit*factor;total+=Math.max(0,Math.min(gross,upper)-lower)*rate;lower=upper;}return total;}
export function allocations(s,c=config){const p=c.paye;const married=s.status!=='single';
 // The lower earner's increase is non-transferable. This estimates the current employer;
 // spouse income is informational, never added to this employee's band.
 const band=s.status==='married-secondary'?Math.min(p.secondIncomeMax.value,s.spouseIncome):married?p.marriedBand.value:p.singleBand.value;
 return {band:s.useRpn?s.rpnBand:(s.allocatedBand??band),credits:s.useRpn?s.rpnCredits:(s.allocatedCredits??((s.status==='married-secondary'?0:married?p.personalMarried.value:p.personalSingle.value)+p.employeeCredit.value+s.extraCredits))};}
export function employeePrsi(gross,s,payDate,c=config){const p=c.prsi;const periods={weekly:52,fortnightly:26,monthly:12}[s.frequency];const weeks=52/periods;const weekly=gross/weeks;
 if(s.age<p.minAge.value||s.prsiClass==='M')return {amount:0,credit:0,class:'M'};
 if(s.prsiClass==='J'||s.age>=p.maxAge.value||(s.age>=66&&(s.statePension||s.legacyPensionExempt))||weekly<p.classJBelow.value)return {amount:0,credit:0,class:'J'};
 if(!['A1','A0','AX','AL'].includes(s.prsiClass))throw Error('Unsupported PRSI class');
 const rate=p.rates.value.filter(([d])=>d<=payDate).at(-1)?.[1];if(rate===undefined)throw Error('No PRSI rate for pay date');
 if(weekly<=p.freeWeekly.value)return {amount:0,credit:0,class:'A0'};
 const credit=weekly<=p.creditEnd.value?Math.max(0,p.maxCredit.value-(weekly-p.creditStart.value)/p.taperDivisor.value)*weeks:0;
 return {amount:round(Math.max(0,gross*rate-credit)),credit:round(credit),class:weekly<=p.creditEnd.value?'AX':weekly<=p.subclassALMax.value?'AL':'A1'};
}
export function estimateTax(input,c=config){const s={...taxDefaults,...input};const gross=nonneg(s.gross,'gross pay');const periods={weekly:52,fortnightly:26,monthly:12}[s.frequency];if(!periods)throw Error('Invalid frequency');
 if(!['week1','cumulative','emergency'].includes(s.basis))throw Error('Invalid tax basis');
 if(!['single','married-main','married-secondary'].includes(s.status))throw Error('Invalid assessment');
 const payDate=s.payDate;if(!/^\d{4}-\d{2}-\d{2}$/.test(payDate||'')||Number(payDate.slice(0,4))!==c.year)throw Error(`Only verified ${c.year} tax dates are supported`);
 for(const key of ['age','spouseIncome','extraCredits','expenseAllowance','annualIncome','pensionPercent','cycle','union','insurance','other','rpnCredits','rpnBand','uscBand1','uscBand2','uscBand3','priorTaxable','priorPaye','priorUscGross','priorUsc'])nonneg(s[key],key);
 for(const key of ['allocatedBand','allocatedCredits'])if(s[key]!==null)nonneg(s[key],key);
 if(s.pensionPercent>100||s.age>120||s.cycle>gross||s.uscBand1>s.uscBand2||s.uscBand2>s.uscBand3)throw Error('Check pension, age, salary sacrifice or USC bands');
 if(!Number.isInteger(s.employmentWeek)||s.employmentWeek<1)throw Error('Invalid emergency employment week');
 if(!Number.isInteger(s.period)||s.period<1||s.period>periods)throw Error('Invalid tax period');
 if(!Number.isFinite(Date.parse(payDate+'T00:00:00Z'))||new Date(payDate+'T00:00:00Z').toISOString().slice(0,10)!==payDate)throw Error('Invalid pay date');
 const sacrifice=round(s.cycle),uscGross=round(gross-sacrifice),pension=round(uscGross*s.pensionPercent/100),taxable=round(Math.max(0,uscGross-pension-s.expenseAllowance/periods));
 const a=allocations(s,c);let band=a.band,credits=a.credits;
 const emergency=s.basis==='emergency';if(emergency){band=s.hasPps&&s.employmentWeek<=c.emergency.weeksWithBand.value?c.paye.singleBand.value:0;credits=0;}
 const factor=s.basis==='cumulative'?s.period/periods:1/periods;
 const income=taxable+(s.basis==='cumulative'?s.priorTaxable:0);
 const liability=Math.max(0,Math.min(income,band*factor)*c.paye.standard.value+Math.max(0,income-band*factor)*c.paye.higher.value-credits*factor);
 // Cumulative refunds are limited to tax already paid; unused credits alone never generate cash.
 const paye=round(liability-(s.basis==='cumulative'?s.priorPaye:0));
 const reduced=(s.age>=c.usc.reducedAge.value||s.medicalCard)&&s.annualIncome<=c.usc.reducedLimit.value;
 const uscBands=reduced?c.usc.reducedBands.value:[[s.uscBand1,c.usc.bands.value[0][1]],[s.uscBand2,c.usc.bands.value[1][1]],[s.uscBand3,c.usc.bands.value[2][1]],[null,c.usc.bands.value[3][1]]];
 const uscIncome=uscGross+(s.basis==='cumulative'?s.priorUscGross:0);
 const uscLiability=emergency?uscGross*c.usc.emergencyRate.value:s.annualIncome<=c.usc.exemption.value?0:bandsTax(uscIncome,uscBands,factor);
 const usc=round(uscLiability-(s.basis==='cumulative'?s.priorUsc:0));const prsi=employeePrsi(uscGross,s,payDate,c);const other=round(s.union+s.insurance+s.other);
 return {gross:round(gross),taxable,paye,usc,prsi:prsi.amount,prsiClass:prsi.class,prsiCredit:prsi.credit,pension,cycle:sacrifice,other,net:round(gross-paye-usc-prsi.amount-pension-sacrifice-other),annualBand:band,annualCredits:credits,year:c.year};
}
export function configWarning(now=new Date(),c=config){return now.toISOString().slice(0,10)>c.reviewAfter||now.getFullYear()!==c.year?`Tax tables need review. Only ${c.year} is verified.`:'';}
