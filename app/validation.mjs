// Pure input validation, normalization and unit conversion.
//
// These moved out of server.mjs so they can be exercised directly: importing the
// server would start an HTTP listener and open a database, which is far too much
// machinery to assert that a password rule or a kilogram-to-pound conversion is
// correct. Nothing here reaches a database, a socket or a clock it does not own.
import { normalizeBarcode } from './food-lookup.mjs';

const cleanEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = value => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validName = value => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80;
const validPassword = value => typeof value === 'string' && value.length >= 10 && value.length <= 128 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /\d/.test(value) && /[^A-Za-z0-9]/.test(value);
function normalizeWorkoutInput(body){const name=typeof body.name==='string'?body.name.trim():'',description=typeof body.description==='string'?body.description.trim():'',dueDate=String(body.dueDate||'').slice(0,10),parsedDate=dueDate?new Date(`${dueDate}T00:00:00.000Z`):null,validDate=!dueDate||/^\d{4}-\d{2}-\d{2}$/.test(dueDate)&&!Number.isNaN(parsedDate.getTime())&&parsedDate.toISOString().slice(0,10)===dueDate;if(name.length<3||name.length>100||description.length>500||!Array.isArray(body.exercises)||body.exercises.length<1||body.exercises.length>30||!validDate)return null;const exercises=body.exercises.map(item=>({name:String(item.name||'').trim(),sets:Number(item.sets),reps:Number(item.reps),restSeconds:Number(item.restSeconds)}));if(exercises.some(item=>item.name.length<2||item.name.length>100||!Number.isInteger(item.sets)||item.sets<1||item.sets>20||!Number.isInteger(item.reps)||item.reps<1||item.reps>1000||!Number.isInteger(item.restSeconds)||item.restSeconds<0||item.restSeconds>900))return null;return{name,description,dueDate,exercises}}
const FOOD_DATA_SOURCES=new Set(['OPEN_FOOD_FACTS','PTRAINER_CATALOG']);
const NUTRITION_ENTRY_TYPES=new Set(['BREAKFAST','LUNCH','DINNER','SNACK','DAILY','WATER']);
function validDateOnly(value){const text=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(text))return false;const parsed=new Date(`${text}T00:00:00.000Z`);return !Number.isNaN(parsed.getTime())&&parsed.toISOString().slice(0,10)===text}
const LOAD_UNITS=new Set(['kg','lb']),DISTANCE_UNITS=new Set(['m','km','mi']);
// A draft is keyed by assignment rather than by a client token, and the colon
// is deliberate: the client-supplied idempotency format rejects it, so a caller
// cannot craft a submission that collides with somebody else's draft row.
const draftKey=assignmentId=>`draft:${assignmentId}`;
const numberOrNull=value=>value===''||value==null?null:Number(value);
const boundedNumber=(value,min,max,integer)=>value===null||Number.isFinite(value)&&value>=min&&value<=max&&(!integer||Number.isInteger(value));
// Actual performance, checked against the assignment's own exercise list so a
// forged index cannot write rows for a movement the workout never prescribed.
// Returns null for invalid input rather than throwing, like the other
// normalizers in this file.
function normalizeSetRows(rows,exerciseCount){
  if(rows==null)return [];
  if(!Array.isArray(rows)||rows.length>200)return null;
  const seen=new Set(),normalized=[];
  for(const row of rows){
    if(!row||typeof row!=='object')return null;
    const exerciseIndex=Number(row.exerciseIndex),setIndex=Number(row.setIndex);
    if(!Number.isInteger(exerciseIndex)||exerciseIndex<0||exerciseIndex>=exerciseCount)return null;
    if(!Number.isInteger(setIndex)||setIndex<0||setIndex>=50)return null;
    const slot=`${exerciseIndex}:${setIndex}`;if(seen.has(slot))return null;seen.add(slot);
    const reps=numberOrNull(row.reps),loadValue=numberOrNull(row.loadValue),durationSeconds=numberOrNull(row.durationSeconds),distanceValue=numberOrNull(row.distanceValue),restSeconds=numberOrNull(row.restSeconds),exertion=numberOrNull(row.exertion);
    if(!boundedNumber(reps,0,1000,true)||!boundedNumber(loadValue,0,100000,false)||!boundedNumber(durationSeconds,0,86400,true))return null;
    if(!boundedNumber(distanceValue,0,100000,false)||!boundedNumber(restSeconds,0,3600,true)||!boundedNumber(exertion,1,10,false))return null;
    const loadUnit=row.loadUnit==null||row.loadUnit===''?null:String(row.loadUnit).toLowerCase();
    const distanceUnit=row.distanceUnit==null||row.distanceUnit===''?null:String(row.distanceUnit).toLowerCase();
    // A measurement without its unit is not a measurement.
    if(loadUnit!==null&&!LOAD_UNITS.has(loadUnit)||loadValue!==null&&loadUnit===null)return null;
    if(distanceUnit!==null&&!DISTANCE_UNITS.has(distanceUnit)||distanceValue!==null&&distanceUnit===null)return null;
    const note=String(row.note||'').trim();if(note.length>500)return null;
    normalized.push({exerciseIndex,setIndex,completed:Boolean(row.completed),reps,loadValue,loadUnit:loadValue===null?null:loadUnit,durationSeconds,distanceValue,distanceUnit:distanceValue===null?null:distanceUnit,restSeconds,exertion,painFlag:Boolean(row.painFlag),note});
  }
  return normalized.sort((a,b)=>a.exerciseIndex-b.exerciseIndex||a.setIndex-b.setIndex);
}
// Explicit per-exercise flags win when the client sends them; otherwise an
// exercise counts as done once every set recorded against it is done.
function exerciseCompletion(body,sets,exerciseCount){
  if(Array.isArray(body.exercises)){
    if(body.exercises.length>exerciseCount)return null;
    const flags=new Array(exerciseCount).fill(false);
    body.exercises.forEach((item,index)=>{flags[index]=Boolean(item&&item.completed)});
    return flags;
  }
  return Array.from({length:exerciseCount},(unusedValue,index)=>{
    const own=sets.filter(row=>row.exerciseIndex===index);
    return own.length>0&&own.every(row=>row.completed);
  });
}
// Unit conversion keeps what the trainee typed and derives what charts read, so
// a profile switching between metric and imperial never rewrites history.
const UNIT_DIMENSION={kg:'MASS',lb:'MASS',cm:'LENGTH',in:'LENGTH',percent:'RATIO'};
const CANONICAL_UNIT={MASS:'kg',LENGTH:'cm',RATIO:'percent'};
const UNIT_FACTOR={kg:1,lb:0.45359237,cm:1,in:2.54,percent:1};
const PROGRESS_UNITS=new Set(Object.keys(UNIT_DIMENSION));
const DISPLAY_UNIT={METRIC:{MASS:'kg',LENGTH:'cm',RATIO:'percent'},IMPERIAL:{MASS:'lb',LENGTH:'in',RATIO:'percent'}};
// Returns null rather than a wrong number when the units measure different
// things, so a caller cannot quietly turn centimetres into kilograms.
function convertUnit(value,fromUnit,toUnit){
  if(!Number.isFinite(value))return null;
  if(fromUnit===toUnit)return value;
  const from=UNIT_DIMENSION[fromUnit],to=UNIT_DIMENSION[toUnit];
  if(!from||!to||from!==to)return null;
  return Math.round(value*UNIT_FACTOR[fromUnit]/UNIT_FACTOR[toUnit]*1000)/1000;
}
function normalizedProgressValue(value,unit){
  const canonical=CANONICAL_UNIT[UNIT_DIMENSION[unit]];
  if(!canonical)return null;
  return {value:convertUnit(value,unit,canonical),unit:canonical};
}
const exerciseNameKey=name=>String(name||'').trim().toLocaleLowerCase();
const EXERCISE_DIFFICULTY=new Set(['BEGINNER','INTERMEDIATE','ADVANCED']);
function normalizeExerciseInput(body){
  const name=String(body.name||'').trim(),muscleGroup=String(body.muscleGroup||'').trim(),equipment=String(body.equipment||'').trim();
  const instructions=String(body.instructions||'').trim(),difficulty=String(body.difficulty||'INTERMEDIATE').toUpperCase();
  const mediaUrl=String(body.mediaUrl||'').trim();
  if(name.length<2||name.length>100||muscleGroup.length>50||equipment.length>50||instructions.length>2000)return null;
  if(!EXERCISE_DIFFICULTY.has(difficulty))return null;
  // Only https media is accepted: an http reference on an https page is blocked
  // by the browser anyway, and other schemes have no business here.
  if(mediaUrl&&(mediaUrl.length>500||!mediaUrl.startsWith('https://')))return null;
  return {name,muscleGroup,equipment,instructions,difficulty,mediaUrl:mediaUrl||null};
}
function normalizeTrainerNote(body){
  const text=String(body.body||'').trim(),visibility=String(body.visibility||'PRIVATE').toUpperCase();
  if(text.length<1||text.length>2000||!['PRIVATE','SHARED'].includes(visibility))return null;
  return {body:text,visibility};
}
// The metric definitions come from the caller rather than a module-level map,
// so this stays a pure function of its inputs.
function normalizeProgressEntry(body,metrics=new Map()){
  const metricType=String(body.metricType||'').trim().toLowerCase(),unit=String(body.unit||'').trim().toLowerCase();
  const value=Number(body.value),measuredAt=new Date(body.measuredAt||Date.now());
  if(!/^[a-z][a-z0-9_]{1,49}$/.test(metricType)||!PROGRESS_UNITS.has(unit))return null;
  if(!Number.isFinite(value)||value<0||value>10000||Number.isNaN(measuredAt.getTime()))return null;
  // A known metric fixes what it measures, so logging a waist in kilograms is a
  // validation failure rather than a chart that silently lies later.
  const definition=metrics.get(metricType);
  if(definition&&definition.dimension!==UNIT_DIMENSION[unit])return null;
  const normalized=normalizedProgressValue(value,unit);
  if(!normalized)return null;
  return {metricType,unit,value,normalizedValue:normalized.value,normalizedUnit:normalized.unit,measuredAt:measuredAt.toISOString(),note:String(body.note||'').trim().slice(0,500)};
}
const SCHEDULE_STEP_DAYS={DAILY:1,WEEKLY:7,BIWEEKLY:14};
// Recurrence is expanded here, at assign time, into one dated occurrence per
// session. Storing a rule instead would mean re-deriving history every time the
// rule changed, which is exactly what snapshotting exists to prevent.
function normalizeSchedule(body){
  const frequency=String(body.frequency||'ONCE').toUpperCase();
  const startDate=String(body.startDate||body.dueDate||'').slice(0,10);
  const endDate=String(body.endDate||'').slice(0,10);
  if(!['ONCE','DAILY','WEEKLY','BIWEEKLY'].includes(frequency))return null;
  if(startDate&&!validDateOnly(startDate))return null;
  if(endDate&&!validDateOnly(endDate))return null;
  if(frequency==='ONCE')return {frequency,startDate:startDate||null,endDate:null,dates:[startDate||null]};
  // A repeat with no end has no defensible number of occurrences to create.
  if(!startDate||!endDate||endDate<startDate)return null;
  const step=SCHEDULE_STEP_DAYS[frequency],dates=[];
  const limit=new Date(`${endDate}T00:00:00.000Z`).getTime();
  for(let cursor=new Date(`${startDate}T00:00:00.000Z`).getTime();cursor<=limit&&dates.length<52;cursor+=step*86400000)dates.push(new Date(cursor).toISOString().slice(0,10));
  if(!dates.length)return null;
  return {frequency,startDate,endDate,dates};
}

// A calendar asks a different question from a list: not "the next page" but
// "everything scheduled between these two dates". The window is capped because
// an unbounded range is a full-table scan wearing a date filter, and no calendar
// view shows more than a year at once. Half a window is refused rather than
// defaulted: guessing the missing end would quietly return the wrong month.
const MAX_DATE_WINDOW_DAYS=366;
function normalizeDateWindow(from,to){
  const start=String(from||'').slice(0,10),end=String(to||'').slice(0,10);
  if(!start&&!end)return {from:null,to:null};
  if(!start||!end)return null;
  if(!validDateOnly(start)||!validDateOnly(end)||end<start)return null;
  const days=(Date.parse(`${end}T00:00:00.000Z`)-Date.parse(`${start}T00:00:00.000Z`))/86400000;
  if(days+1>MAX_DATE_WINDOW_DAYS)return null;
  return {from:start,to:end};
}

function nutritionValues(body){const numberOrNull=value=>value===''||value==null?null:Number(value),values={calories:numberOrNull(body.calories),proteinG:numberOrNull(body.proteinG),carbsG:numberOrNull(body.carbsG),fatG:numberOrNull(body.fatG),waterMl:numberOrNull(body.waterMl)};if(Object.values(values).some(value=>value!==null&&(!Number.isFinite(value)||value<0||value>100000))||values.calories!==null&&!Number.isInteger(values.calories)||values.waterMl!==null&&!Number.isInteger(values.waterMl))return null;return values}
function normalizeNutritionEntry(body){const values=nutritionValues(body),entryDate=String(body.entryDate||''),entryType=String(body.entryType||'').toUpperCase(),description=String(body.description||'').trim(),rawBarcode=String(body.foodBarcode||''),foodBarcode=rawBarcode?normalizeBarcode(rawBarcode):null,foodName=String(body.foodName||'').trim(),foodBrand=String(body.foodBrand||'').trim(),foodQuantityG=body.foodQuantityG===''||body.foodQuantityG==null?null:Number(body.foodQuantityG),dataSource=FOOD_DATA_SOURCES.has(body.dataSource)?body.dataSource:null;if(!values||!validDateOnly(entryDate)||!NUTRITION_ENTRY_TYPES.has(entryType)||description.length>1000||foodName.length>200||foodBrand.length>200||rawBarcode&&!foodBarcode||foodQuantityG!==null&&(!Number.isFinite(foodQuantityG)||foodQuantityG<=0||foodQuantityG>100000)||(!description&&Object.values(values).every(value=>value===null)))return null;if(!foodBarcode&&!foodName)return{entryDate,entryType,description,...values,foodBarcode:null,foodName:null,foodBrand:null,foodQuantityG:null,dataSource:null};return{entryDate,entryType,description,...values,foodBarcode,foodName:foodName||'Packaged food',foodBrand,foodQuantityG,dataSource}}
// Keyset pagination, not offset. An offset re-scans everything it skips and, if
// a row is inserted or removed between two requests, silently repeats or drops
// entries at the page boundary. A cursor anchored on the sort key cannot.
//
// The cursor is opaque on purpose: it encodes the sort values of the last row
// returned, so its shape stays an implementation detail callers do not build on.
// "Today" is a question about where somebody is, not about UTC. A trainee in
// Vancouver logging at 6pm sees the server roll over to tomorrow six hours
// early, which marks a workout overdue that is not, and files a meal under the
// wrong day. Intl does the zone arithmetic, including daylight saving.
function todayIn(timezone, now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    // An unknown zone must not take a dashboard down.
    return now.toISOString().slice(0, 10);
  }
}
const encodeCursor=values=>Buffer.from(JSON.stringify(values)).toString('base64url');
function decodeCursor(text,length){
  if(!text)return null;
  try{
    const parsed=JSON.parse(Buffer.from(String(text),'base64url').toString('utf8'));
    return Array.isArray(parsed)&&parsed.length===length?parsed:null;
  }catch{return null}
}
const pageLimit=(url,fallback=50,max=200)=>Math.min(max,Math.max(1,Number(url.searchParams.get('limit'))||fallback));
// A page is full when it reaches the limit, and only then is there a next one.
const nextCursorFor=(rows,limit,pick)=>rows.length===limit?encodeCursor(pick(rows[rows.length-1])):null;


// What an active coaching relationship actually grants, field by field. The
// stored object is merged over the defaults so a relationship created before
// this column existed still answers every flag.
const RELATIONSHIP_PERMISSION_DEFAULTS={view_progress:true,view_nutrition:true,log_on_behalf:false};
const RELATIONSHIP_PERMISSION_KEYS=Object.keys(RELATIONSHIP_PERMISSION_DEFAULTS);
function relationshipPermissions(relationship){return {...RELATIONSHIP_PERMISSION_DEFAULTS,...(relationship&&relationship.permissions||{})}}
function normalizeRelationshipPermissions(value){
  if(value==null||typeof value!=='object'||Array.isArray(value))return null;
  const normalized={};
  for(const key of RELATIONSHIP_PERMISSION_KEYS)normalized[key]=key in value?Boolean(value[key]):RELATIONSHIP_PERMISSION_DEFAULTS[key];
  return normalized;
}
export {
  todayIn,
  cleanEmail,
  validEmail,
  validName,
  validPassword,
  normalizeWorkoutInput,
  NUTRITION_ENTRY_TYPES,
  validDateOnly,
  nutritionValues,
  normalizeNutritionEntry,
  LOAD_UNITS,
  draftKey,
  numberOrNull,
  boundedNumber,
  normalizeSetRows,
  exerciseCompletion,
  UNIT_DIMENSION,
  CANONICAL_UNIT,
  UNIT_FACTOR,
  PROGRESS_UNITS,
  DISPLAY_UNIT,
  convertUnit,
  normalizedProgressValue,
  exerciseNameKey,
  EXERCISE_DIFFICULTY,
  normalizeExerciseInput,
  normalizeTrainerNote,
  normalizeProgressEntry,
  SCHEDULE_STEP_DAYS,
  normalizeSchedule,
  MAX_DATE_WINDOW_DAYS,
  normalizeDateWindow,
  RELATIONSHIP_PERMISSION_DEFAULTS,
  RELATIONSHIP_PERMISSION_KEYS,
  relationshipPermissions,
  normalizeRelationshipPermissions,
  encodeCursor,
  decodeCursor,
  pageLimit,
  nextCursorFor
};
