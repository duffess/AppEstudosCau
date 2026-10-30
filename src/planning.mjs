import { db, transaction, logEvent, mondayOf, addDays, toISODate } from './database.mjs';

export function rebuildPlan(spaceId, weekStart=mondayOf(), targetMinutes=null){
 const prefs=db.prepare('SELECT * FROM preferences WHERE space_id=?').get(spaceId)||{daily_minutes:90,weekly_minutes:450,available_days:'[1,2,3,4,5]'};
 const weekly=Number(targetMinutes)||prefs.weekly_minutes;const configuredDays=(JSON.parse(prefs.available_days||'[1,2,3,4,5]')).filter(Number.isInteger);const futureDays=configuredDays.filter(day=>addDays(weekStart,day)>=toISODate());const days=futureDays.length?futureDays:configuredDays;const daily=Math.max(25,Math.min(prefs.daily_minutes,Math.ceil(weekly/Math.max(1,configuredDays.length))));
 const reviews=db.prepare(`SELECT r.*,s.name subject_name,s.priority,s.mastery FROM reviews r JOIN subjects s ON s.id=r.subject_id WHERE r.space_id=? AND r.status IN ('scheduled','overdue') AND r.due_at<=? ORDER BY r.due_at ASC,s.priority ASC`).all(spaceId,addDays(weekStart,6));
 const subjects=db.prepare(`SELECT * FROM subjects WHERE space_id=? AND status!='archived' ORDER BY CASE WHEN mastery<.45 THEN 0 ELSE 1 END,priority ASC,created_at ASC`).all(spaceId);
 let plan=db.prepare('SELECT id FROM plans WHERE space_id=? AND week_start=?').get(spaceId,weekStart);if(plan){db.prepare("DELETE FROM plan_items WHERE plan_id=? AND status!='done'").run(plan.id);db.prepare('UPDATE plans SET target_minutes=? WHERE id=?').run(weekly,plan.id)}else{const result=db.prepare('INSERT INTO plans(space_id,week_start,target_minutes) VALUES(?,?,?)').run(spaceId,weekStart,weekly);plan={id:result.lastInsertRowid}}
 const used=Array.from({length:7},()=>0);let order=0;
 function dayFor(preferred){if(preferred!==undefined){const target=Math.max(0,Math.min(6,preferred));if(days.includes(target)&&used[target]+20<=daily)return target;}let best=-1;for(const idx of days)if(best<0||used[idx]<used[best])best=idx;return best;}
 transaction(()=>{
  for(const r of reviews){const overdue=r.due_at<toISODate();const prefDay=overdue?undefined:Math.max(0,Math.min(6,Math.floor((new Date(`${r.due_at}T12:00:00`)-new Date(`${weekStart}T12:00:00`))/86400000)));const d=dayFor(prefDay);if(d<0)continue;const date=addDays(weekStart,d);const mins=20;db.prepare(`INSERT INTO plan_items(plan_id,space_id,subject_id,review_id,scheduled_for,kind,title,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?,?)`).run(plan.id,spaceId,r.subject_id,r.id,date,'review',`${overdue?'Revisão atrasada':'Revisão'} · ${r.subject_name}`,mins,order++);used[d]+=mins;}
  for(const s of subjects){const existing=db.prepare("SELECT 1 FROM plan_items WHERE plan_id=? AND subject_id=? AND kind IN ('new','reinforcement') AND status='planned'").get(plan.id,s.id);if(existing)continue;const kind=s.mastery<.45&&s.mastery>0?'reinforcement':s.status==='new'?'new':null;if(!kind)continue;const mins=Math.min(s.estimated_minutes,60);const d=days.find(idx=>used[idx]+mins<=daily);if(d===undefined)continue;db.prepare(`INSERT INTO plan_items(plan_id,space_id,subject_id,scheduled_for,kind,title,estimated_minutes,sort_order) VALUES(?,?,?,?,?,?,?,?)`).run(plan.id,spaceId,s.id,addDays(weekStart,d),kind,s.name,mins,order++);used[d]+=mins;}
  db.prepare("UPDATE reviews SET status='overdue' WHERE space_id=? AND status='scheduled' AND due_at<?").run(spaceId,toISODate());
  logEvent(spaceId,'PlanoAtualizado',{planId:plan.id,weekStart});
 });
 return plan.id;
}
export function planForSpace(spaceId,weekStart=mondayOf()){
 let plan=db.prepare('SELECT * FROM plans WHERE space_id=? AND week_start=?').get(spaceId,weekStart);if(!plan){rebuildPlan(spaceId,weekStart);plan=db.prepare('SELECT * FROM plans WHERE space_id=? AND week_start=?').get(spaceId,weekStart)}
 return {...plan,items:db.prepare(`SELECT p.*,s.name subject_name,r.stage review_stage FROM plan_items p LEFT JOIN subjects s ON s.id=p.subject_id LEFT JOIN reviews r ON r.id=p.review_id WHERE p.plan_id=? ORDER BY p.scheduled_for,p.sort_order,p.id`).all(plan.id)};
}
