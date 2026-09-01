import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeDatabase, query, transaction, databaseMode, closeDatabase } from './database.mjs';
import { exerciseCatalog } from './exercise-catalog.mjs';
import { lookupFoodProduct, normalizeBarcode, searchFoodsByName, normalizeFoodQuery } from './food-lookup.mjs';
import { sendEmail, emailTransport, emailConfigProblem, verificationEmail, resetEmail, invitationEmail } from './email.mjs';
import { startRetentionSweeps, runRetentionSweep } from './retention.mjs';
import { BoundedMap } from './bounded-map.mjs';
import { reportError, shouldReport, errorReportingEnabled, errorReportingProblem } from './observability.mjs';
import {
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
  RELATIONSHIP_PERMISSION_DEFAULTS,
  RELATIONSHIP_PERMISSION_KEYS,
  relationshipPermissions,
  normalizeRelationshipPermissions,
  encodeCursor,
  decodeCursor,
  pageLimit,
  nextCursorFor
} from './validation.mjs';

const scrypt = promisify(scryptCallback);
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const APP_ORIGIN = process.env.APP_ORIGIN || `http://${HOST}:${PORT}`;
const PRIVACY_NOTICE_VERSION = '2026-08-21';
const PRIVACY_ORGANIZATION = String(process.env.PRIVACY_ORGANIZATION || 'Ptrainer controlled pilot');
const PRIVACY_CONTACT_EMAIL = String(process.env.PRIVACY_CONTACT_EMAIL || 'privacy@ptrainer.local');
const DATA_STORAGE_REGION = String(process.env.DATA_STORAGE_REGION || 'Local development device');
const FOOD_API_USER_AGENT = process.env.FOOD_API_USER_AGENT || 'Ptrainer/0.1 (https://github.com/bora2602/PTrainer)';
if(IS_PRODUCTION&&(!process.env.DATABASE_URL||!APP_ORIGIN.startsWith('https://')||String(process.env.METRICS_TOKEN||'').length<32||PRIVACY_ORGANIZATION==='Ptrainer controlled pilot'||!PRIVACY_CONTACT_EMAIL.includes('@')||PRIVACY_CONTACT_EMAIL.endsWith('.local')||DATA_STORAGE_REGION==='Local development device'))throw new Error('Production requires database, HTTPS, metrics, privacy-organization/contact, and storage-region configuration.');
// A verification or reset link written to a log file is not delivery, and
// treating it as delivery would silently strand every locked-out user.
const errorSinkProblem=errorReportingProblem();if(errorSinkProblem)throw new Error(`Error reporting is misconfigured. ${errorSinkProblem}`);
if(IS_PRODUCTION){const emailProblem=emailTransport()==='log'?'Set EMAIL_TRANSPORT=http with a provider endpoint; the log transport does not deliver mail.':emailConfigProblem();if(emailProblem)throw new Error(`Production email configuration is incomplete. ${emailProblem}`);}
// Behind a tunnel or reverse proxy the socket address is the proxy, so every
// visitor would share one rate-limit bucket. Only enable TRUST_PROXY when the
// app port is not reachable directly, otherwise clients can spoof these headers.
const TRUST_PROXY = String(process.env.TRUST_PROXY || '') === 'true';
// Browsers send the hostname they were served from; a proxied deployment is
// reached by a name that is not APP_ORIGIN, so extra origins can be allowed.
const ALLOWED_ORIGINS = new Set([APP_ORIGIN, ...String(process.env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)]);
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SESSION_TTL = 60 * 60 * 1000;
const COOKIE = 'ptrainer_sid';
// Five new accounts an hour from one address is the right ceiling for a public
// deployment and far too tight for a test run that has to create several. The
// production number is unchanged; only development and CI get the headroom.
// A full test run registers about a dozen accounts, so a ceiling of 100 was
// roughly eight runs an hour - fewer than an afternoon of iteration takes, and
// the resulting failure reads like a broken feature rather than a spent budget.
// Production keeps the tight number; development gets one no test loop reaches.
const REGISTRATION_LIMIT = IS_PRODUCTION ? 5 : 5000;
// Same reasoning for sign-in: eight attempts per quarter hour is right for a
// public deployment and stops a test suite dead on its second run. Production
// keeps the tight number.
const LOGIN_LIMIT = IS_PRODUCTION ? 8 : 5000;
const types = { '.txt':'text/plain; charset=utf-8', '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml' };

const sessions = new BoundedMap({ maxEntries: 20000, ttlMs: SESSION_TTL });
const invitations = new Map();
const workoutTemplates = new Map();
const assignments = new Map();
// Idempotency replay cache. The durable answer is the workout_logs row; this
// only saves the lookup, so dropping an entry costs a query and nothing else.
const workoutSaves = new BoundedMap({ maxEntries: 5000, ttlMs: 24 * 60 * 60 * 1000 });
// One bucket per address-and-action pair, which without eviction is one entry
// per address that ever touched the app.
const rateBuckets = new BoundedMap({ maxEntries: 50000, ttlMs: 60 * 60 * 1000 });
const passwordResets = new BoundedMap({ maxEntries: 10000, ttlMs: 60 * 60 * 1000 });
const foodProductCache = new BoundedMap({ maxEntries: 5000, ttlMs: 6 * 60 * 60 * 1000 });
const foodSearchCache = new BoundedMap({ maxEntries: 2000, ttlMs: 30 * 60 * 1000 });
const telemetry={startedAt:Date.now(),requests:0,errors:0,totalDurationMs:0,byStatus:new Map()};

const id = prefix => `${prefix}_${randomBytes(10).toString('hex')}`;
const tokenDigest = token => createHash('sha256').update(token).digest('base64url');
const publicUser = user => ({ id:user.id, name:user.name, email:user.email, role:user.role, emailVerified:Boolean(user.emailVerifiedAt) });
async function writeSetRows(tx,logId,sets){
  await tx('DELETE FROM set_logs WHERE workout_log_id=$1',[logId]);
  for(const row of sets)await tx('INSERT INTO set_logs(id,workout_log_id,exercise_index,set_index,completed,reps,load_value,load_unit,duration_seconds,distance_value,distance_unit,rest_seconds,exertion,pain_flag,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[id('set'),logId,row.exerciseIndex,row.setIndex,row.completed,row.reps,row.loadValue,row.loadUnit,row.durationSeconds,row.distanceValue,row.distanceUnit,row.restSeconds,row.exertion,row.painFlag,row.note]);
}
async function readSetRows(logIds){
  const grouped=new Map();if(!logIds.length)return grouped;
  const result=await query('SELECT workout_log_id,exercise_index,set_index,completed,reps,load_value::float,load_unit,duration_seconds,distance_value::float,distance_unit,rest_seconds,exertion::float,pain_flag,note FROM set_logs WHERE workout_log_id = ANY($1) ORDER BY exercise_index,set_index',[logIds]);
  for(const row of result.rows){const list=grouped.get(row.workout_log_id)||[];list.push(row);grouped.set(row.workout_log_id,list)}
  return grouped;
}
// A trainee always reaches their own workout. A trainer reaches it only through
// a live coaching relationship, so ending the relationship ends the access with
// it rather than leaving the original assignment as a standing key.
// Accounts are read from the table, not from a process-local mirror. As with
// relationships, this is a correctness matter before it is a memory one: a
// second replica holding a stale copy would keep letting a suspended or deleted
// account in. Reads are cached briefly so the hot path - resolving the session
// user on every request - is not a query every time, but the cache is short
// enough that a status change takes effect in seconds rather than never.
const USER_CACHE_TTL_MS = 5000;
const userCache = new BoundedMap({ maxEntries: 5000, ttlMs: USER_CACHE_TTL_MS });
const emailCache = new BoundedMap({ maxEntries: 5000, ttlMs: USER_CACHE_TTL_MS });
const userRecord = row => row && { id: row.id, name: row.name, email: row.email, passwordHash: row.password_hash, role: row.role, status: row.status, createdAt: row.created_at, emailVerifiedAt: row.email_verified_at };
const USER_COLUMNS = 'id,email,password_hash,name,role,status,created_at,email_verified_at';
async function findUserById(id) {
  if (!id) return null;
  const cached = userCache.get(id);
  if (cached) return cached;
  const result = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id=$1`, [id]);
  const record = userRecord(result.rows[0]);
  if (record) { userCache.set(record.id, record); emailCache.set(record.email, record); }
  return record;
}
async function findUserByEmail(email) {
  if (!email) return null;
  const cached = emailCache.get(email);
  if (cached) return cached;
  const result = await query(`SELECT ${USER_COLUMNS} FROM users WHERE email=$1`, [email]);
  const record = userRecord(result.rows[0]);
  if (record) { userCache.set(record.id, record); emailCache.set(record.email, record); }
  return record;
}
// After any write to a user row, drop the cached copy so the next read is fresh
// rather than up to five seconds stale.
function forgetUser(user) {
  if (!user) return;
  userCache.delete(user.id);
  emailCache.delete(user.email);
}
// Several places render a list and need names for ids they already hold.
async function usersByIds(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const result = await query(`SELECT ${USER_COLUMNS} FROM users WHERE id = ANY($1)`, [unique]);
  const found = new Map();
  for (const row of result.rows) {
    const record = userRecord(row);
    found.set(record.id, record);
    userCache.set(record.id, record);
  }
  return found;
}

// Coaching relationships are read from the table, not from a process-local
// mirror. The mirror was not just a memory concern: with a second replica, a
// relationship revoked on one process would still look active on the other, and
// authorization would fail open. The database is the only place that can answer
// "may this trainer see this trainee's records" correctly.
const relationshipRow=row=>row&&{trainerId:row.trainer_id,traineeId:row.trainee_id,status:row.status,permissions:row.permissions,createdAt:row.created_at,updatedAt:row.updated_at};
async function findRelationship(trainerId,traineeId){
  if(!trainerId||!traineeId)return null;
  const result=await query('SELECT trainer_id,trainee_id,status,permissions,created_at,updated_at FROM trainer_trainee_relationships WHERE trainer_id=$1 AND trainee_id=$2',[trainerId,traineeId]);
  return relationshipRow(result.rows[0]);
}
async function relationshipsFor(user,status=null){
  const column=user.role==='TRAINER'?'trainer_id':'trainee_id';
  const result=await query(`SELECT trainer_id,trainee_id,status,permissions,created_at,updated_at FROM trainer_trainee_relationships WHERE ${column}=$1 AND ($2::text IS NULL OR status=$2) ORDER BY created_at DESC LIMIT 500`,[user.id,status]);
  return result.rows.map(relationshipRow);
}
async function activeTraineeIds(trainerId){
  const result=await query("SELECT trainee_id FROM trainer_trainee_relationships WHERE trainer_id=$1 AND status='ACTIVE'",[trainerId]);
  return result.rows.map(row=>row.trainee_id);
}

async function logAccess(user,assignment,writing=false){
  if(!assignment)return false;
  if(user.role==='TRAINEE')return assignment.traineeId===user.id;
  const relationship=await findRelationship(user.id,assignment.traineeId);
  if(assignment.trainerId!==user.id||relationship?.status!=='ACTIVE')return false;
  // Reviewing a client's session is coaching. Recording one under their name is
  // not, and needs their say-so.
  return !writing||relationshipPermissions(relationship).log_on_behalf;
}
const progressMetrics=new Map();
// Account mail carries the only route back into a locked-out account, so a
// verification token is stored as a hash and checked against the address it was
// issued for - reissuing after an address change must not verify the old one.
async function issueEmailVerification(user){
  const rawToken=randomBytes(24).toString('base64url');
  await query('INSERT INTO email_verification_tokens(token_hash,user_id,email,expires_at) VALUES($1,$2,$3,$4)',[tokenDigest(rawToken),user.id,user.email,new Date(Date.now()+24*3600000).toISOString()]);
  const outcome=await sendEmail({to:user.email,...verificationEmail(user.name,`${APP_ORIGIN}/?verify=${rawToken}`)},log);
  await audit(user.id,'EMAIL_VERIFICATION_SENT','user',user.id,{delivered:outcome.delivered});
  return {delivered:outcome.delivered,...(IS_PRODUCTION?{}:{demoVerificationToken:rawToken})};
}

// The bundled catalog seeds the platform library once. Existing rows are left
// alone so a corrected description is not overwritten on every restart.
async function seedExerciseLibrary(){
  const existing=await query("SELECT count(*)::int AS count FROM exercises WHERE visibility='PLATFORM'");
  if(Number(existing.rows[0].count)>0)return;
  await transaction(async tx=>{
    for(const item of exerciseCatalog)await tx("INSERT INTO exercises(id,name,name_key,muscle_group,equipment,visibility) VALUES($1,$2,$3,$4,$5,'PLATFORM') ON CONFLICT DO NOTHING",[id('ex'),item.name,exerciseNameKey(item.name),item.muscleGroup,item.equipment]);
  });
  log('info','exercise_library_seeded',{count:exerciseCatalog.length});
}

const log=(level,event,fields={})=>{
  console.log(JSON.stringify({timestamp:new Date().toISOString(),level,event,...fields}));
  // stdout stays the primary record. This only forwards the events the runbook
  // says are worth alerting on, and only when a collector is configured.
  if(shouldReport(level,event))reportError(event,{level,...fields});
};
const routeLabel=path=>String(path||'/').replace(/^\/api\/invitations\/[^/]+\/accept$/,'/api/invitations/:token/accept').replace(/^\/api\/assigned-workouts\/[^/]+\/logs$/,'/api/assigned-workouts/:id/logs').replace(/^\/api\/assigned-workouts\/[^/]+$/,'/api/assigned-workouts/:id').replace(/^\/api\/food-products\/[^/]+$/,'/api/food-products/:barcode').replace(/^\/api\/nutrition-entries\/[^/]+$/,'/api/nutrition-entries/:id').replace(/^\/api\/notifications\/[^/]+\/read$/,'/api/notifications/:id/read').replace(/^\/api\/relationships\/[^/]+\/[^/]+$/,'/api/relationships/:trainerId/:traineeId').replace(/^\/api\/exercises\/[^/]+$/,'/api/exercises/:id').replace(/^\/api\/workout-templates\/[^/]+\/duplicate$/,'/api/workout-templates/:id/duplicate').replace(/^\/api\/workout-templates\/[^/]+$/,'/api/workout-templates/:id').replace(/^\/api\/progress-entries\/[^/]+$/,'/api/progress-entries/:id').replace(/^\/api\/trainer-notes\/[^/]+$/,'/api/trainer-notes/:id');


await initializeDatabase();

async function hashPassword(password, salt = randomBytes(16)) {
  const hash = await scrypt(password, salt, 64, { N:16384, r:8, p:1, maxmem:64*1024*1024 });
  return `${salt.toString('base64url')}.${Buffer.from(hash).toString('base64url')}`;
}
async function verifyPassword(password, stored) {
  const [saltText, hashText] = stored.split('.');
  if (!saltText || !hashText) return false;
  const expected = Buffer.from(hashText, 'base64url');
  const actual = Buffer.from(await scrypt(password, Buffer.from(saltText, 'base64url'), expected.length, { N:16384, r:8, p:1, maxmem:64*1024*1024 }));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
async function createUser({ name, email, password, role, privacyNoticeVersion=null }) {
  const normalizedEmail=cleanEmail(email);const existing=await query('SELECT id,email,password_hash,name,role,status,created_at,email_verified_at FROM users WHERE email=$1',[normalizedEmail]);
  if(existing.rowCount){const row=existing.rows[0],user={id:row.id,name:row.name,email:row.email,passwordHash:row.password_hash,role:row.role,status:row.status,createdAt:row.created_at,emailVerifiedAt:row.email_verified_at};return user}
  const user = { id:id('usr'), name:name.trim(), email:cleanEmail(email), passwordHash:await hashPassword(password), role, status:'ACTIVE', createdAt:new Date().toISOString() };
  const insertUser=tx=>tx('INSERT INTO users(id,email,password_hash,name,role,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$7)',[user.id,user.email,user.passwordHash,user.name,user.role,user.status,user.createdAt]);if(privacyNoticeVersion)await transaction(async tx=>{await insertUser(tx);await tx('INSERT INTO privacy_consents(id,user_id,notice_version,source,accepted_at) VALUES($1,$2,$3,$4,$5)',[id('consent'),user.id,privacyNoticeVersion,'REGISTRATION',user.createdAt])});else await insertUser(query);return user;
}

await seedExerciseLibrary();
const storedMetrics=await query('SELECT key,label,dimension,canonical_unit FROM progress_metrics');for(const row of storedMetrics.rows)progressMetrics.set(row.key,{key:row.key,label:row.label,dimension:row.dimension,canonicalUnit:row.canonical_unit});

const storedTemplates=await query('SELECT id,trainer_id,name,description,version,exercises,created_at FROM workout_templates WHERE archived_at IS NULL AND deleted_at IS NULL');for(const row of storedTemplates.rows)workoutTemplates.set(row.id,{id:row.id,trainerId:row.trainer_id,name:row.name,description:row.description,version:row.version,exercises:row.exercises,createdAt:row.created_at});
const storedAssignments=await query('SELECT id,template_id,trainer_id,trainee_id,template_snapshot,due_date,start_date,end_date,frequency,series_id,status,created_at FROM assigned_workouts WHERE deleted_at IS NULL');for(const row of storedAssignments.rows)assignments.set(row.id,{id:row.id,templateId:row.template_id,trainerId:row.trainer_id,traineeId:row.trainee_id,templateSnapshot:row.template_snapshot,dueDate:row.due_date,startDate:row.start_date,endDate:row.end_date,frequency:row.frequency,seriesId:row.series_id,status:row.status,createdAt:row.created_at});
if(!IS_PRODUCTION){
  const trainer=await createUser({name:'Maya Adams',email:'trainer@ptrainer.local',password:'DemoTrainer1!',role:'TRAINER'}),trainee=await createUser({name:'Jordan Lee',email:'trainee@ptrainer.local',password:'DemoTrainee1!',role:'TRAINEE'});
  // A previous production start suspends these; running outside production is
  // what re-enables them, so the two modes stay symmetric.
  for(const demoUser of [trainer,trainee]){
    if(demoUser.status!=='ACTIVE'){
      demoUser.status='ACTIVE';forgetUser(demoUser);
      await query("UPDATE users SET status='ACTIVE',updated_at=now() WHERE id=$1",[demoUser.id]);
      log('info','demo_account_reactivated',{email:demoUser.email});
    }
    if(!demoUser.emailVerifiedAt){
      demoUser.emailVerifiedAt=new Date().toISOString();
      await query('UPDATE users SET email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1',[demoUser.id]);
    }
  }
  if(!await findRelationship(trainer.id,trainee.id)){const relationship={trainerId:trainer.id,traineeId:trainee.id,status:'ACTIVE',createdAt:new Date().toISOString()};await query('INSERT INTO trainer_trainee_relationships(trainer_id,trainee_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$4)',[relationship.trainerId,relationship.traineeId,relationship.status,relationship.createdAt]);}
  let seedTemplate=[...workoutTemplates.values()].find(item=>item.trainerId===trainer.id&&item.name==='Upper Body Strength');if(!seedTemplate){seedTemplate={id:id('tpl'),trainerId:trainer.id,name:'Upper Body Strength',description:'A balanced upper-body strength session.',exercises:[{name:'Barbell bench press',sets:4,reps:8,restSeconds:90},{name:'Single-arm dumbbell row',sets:3,reps:10,restSeconds:75},{name:'Seated shoulder press',sets:3,reps:10,restSeconds:75},{name:'Cable triceps extension',sets:3,reps:12,restSeconds:60}],version:1,createdAt:new Date().toISOString()};await query('INSERT INTO workout_templates(id,trainer_id,name,description,version,exercises,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[seedTemplate.id,seedTemplate.trainerId,seedTemplate.name,seedTemplate.description,seedTemplate.version,JSON.stringify(seedTemplate.exercises),seedTemplate.createdAt]);workoutTemplates.set(seedTemplate.id,seedTemplate)}
  let seedAssignment=assignments.get('assigned_demo_1');if(!seedAssignment){seedAssignment={id:'assigned_demo_1',templateId:seedTemplate.id,templateSnapshot:structuredClone(seedTemplate),trainerId:trainer.id,traineeId:trainee.id,dueDate:new Date().toISOString().slice(0,10),status:'ASSIGNED',createdAt:new Date().toISOString()};await query('INSERT INTO assigned_workouts(id,template_id,trainer_id,trainee_id,template_snapshot,due_date,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[seedAssignment.id,seedAssignment.templateId,seedAssignment.trainerId,seedAssignment.traineeId,JSON.stringify(seedAssignment.templateSnapshot),seedAssignment.dueDate,seedAssignment.status,seedAssignment.createdAt]);assignments.set(seedAssignment.id,seedAssignment)}
  const progressCount=await query('SELECT count(*)::int AS count FROM progress_entries WHERE trainee_id=$1',[trainee.id]);if(Number(progressCount.rows[0].count)===0){for(const [days,value]of [[56,82.4],[42,81.5],[28,80.8],[14,79.9],[0,79.2]])await query("INSERT INTO progress_entries(id,trainee_id,author_id,metric_type,value,unit,measured_at,note) VALUES($1,$2,$2,'weight',$3,'kg',$4,'')",[id('progress'),trainee.id,value,new Date(Date.now()-days*86400000).toISOString()])}
  const nutritionCount=await query('SELECT count(*)::int AS count FROM nutrition_entries WHERE trainee_id=$1',[trainee.id]);if(Number(nutritionCount.rows[0].count)===0)await query("INSERT INTO nutrition_entries(id,trainee_id,author_id,entry_date,entry_type,description,calories,protein_g,carbs_g,fat_g,water_ml) VALUES($1,$2,$2,CURRENT_DATE,'DAILY','Balanced training day',1840,132,188,58,2100)",[id('nutrition'),trainee.id]);
  const notificationCount=await query('SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1',[trainer.id]);if(Number(notificationCount.rows[0].count)===0)await query("INSERT INTO notifications(id,recipient_id,event_type,title,body) VALUES($1,$2,'PROGRESS_ADDED','New progress update','Jordan logged a new weight entry.'),($3,$2,'WORKOUT_COMPLETED','Workout completed','Jordan completed Upper Body Strength.')",[id('notification'),trainer.id,id('notification')]);
} else {
  // A database that was ever started outside production still holds the demo
  // accounts, and their passwords are published in this repository. Skipping the
  // seed is not enough - the existing rows have to stop being usable. Suspending
  // rather than deleting keeps any real data attached to them recoverable.
  for(const email of ['trainer@ptrainer.local','trainee@ptrainer.local']){
    const demoUser=await findUserByEmail(email);
    if(demoUser&&demoUser.status==='ACTIVE'){
      demoUser.status='SUSPENDED';forgetUser(demoUser);
      await query("UPDATE users SET status='SUSPENDED',updated_at=now() WHERE id=$1",[demoUser.id]);
      log('warn','demo_account_suspended',{email});
    }
  }
}

function securityHeaders(res,{cacheControl='no-store'}={}) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY'); res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Permissions-Policy','camera=(self), microphone=(), geolocation=(), payment=()'); res.setHeader('Cross-Origin-Opener-Policy','same-origin'); res.setHeader('Cross-Origin-Resource-Policy','same-origin'); res.setHeader('Cache-Control',cacheControl);
}
function json(res,status,payload){securityHeaders(res);res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(payload))}
function textResponse(res,status,payload,contentType='text/plain; charset=utf-8'){securityHeaders(res);res.statusCode=status;res.setHeader('Content-Type',contentType);res.end(payload)}
function metricsPayload(){const uptime=(Date.now()-telemetry.startedAt)/1000,average=telemetry.requests?telemetry.totalDurationMs/telemetry.requests:0,statusLines=[...telemetry.byStatus].map(([status,count])=>`ptrainer_http_responses_total{status="${status}"} ${count}`).join('\n');return`# HELP ptrainer_up 1 when the process is running\n# TYPE ptrainer_up gauge\nptrainer_up 1\n# TYPE ptrainer_uptime_seconds gauge\nptrainer_uptime_seconds ${uptime.toFixed(3)}\n# TYPE ptrainer_http_requests_total counter\nptrainer_http_requests_total ${telemetry.requests}\n# TYPE ptrainer_http_errors_total counter\nptrainer_http_errors_total ${telemetry.errors}\n# TYPE ptrainer_http_request_duration_average_ms gauge\nptrainer_http_request_duration_average_ms ${average.toFixed(3)}\n${statusLines}\n`}
function parseCookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return[v.slice(0,i),decodeURIComponent(v.slice(i+1))]}))}
function setSessionCookie(res,sid,maxAge=3600){res.setHeader('Set-Cookie',`${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${IS_PRODUCTION?'; Secure':''}`)}
// Signed-in sessions are written to the database so a deploy stops signing
// everyone out, and are cached here so the common case stays a memory read.
// Anonymous sessions carry nothing but a CSRF token and are never persisted:
// one row per unauthenticated request would trade a memory leak for a table
// that grows just as fast.
const SESSION_PERSIST_INTERVAL_MS = 60 * 1000;
function cacheSession(session){sessions.set(session.sid,session);return session}
function newSessionRecord(userId){return{sid:randomBytes(32).toString('base64url'),userId,csrf:randomBytes(32).toString('base64url'),lastSeen:Date.now(),persistedAt:userId?Date.now():0}}
async function persistSession(session){
  if(!session.userId)return;
  await query('INSERT INTO sessions(sid,user_id,csrf,last_seen) VALUES($1,$2,$3,now()) ON CONFLICT(sid) DO UPDATE SET last_seen=now()',[session.sid,session.userId,session.csrf]);
  session.persistedAt=Date.now();
}
async function destroySession(sid){sessions.delete(sid);await query('DELETE FROM sessions WHERE sid=$1',[sid])}
async function destroyUserSessions(userId,exceptSid=null){
  for(const [sid,item] of sessions)if(item.userId===userId&&sid!==exceptSid)sessions.delete(sid);
  const removed=await query('DELETE FROM sessions WHERE user_id=$1 AND ($2::text IS NULL OR sid<>$2) RETURNING sid',[userId,exceptSid]);
  return removed.rowCount;
}
async function getSession(req,res){
  const sid=parseCookies(req)[COOKIE];
  let session=sid?sessions.get(sid):null;
  if(!session&&sid){
    // A cache miss is normal after a restart, so the row is the fallback rather
    // than a reason to sign somebody out.
    const stored=await query('SELECT sid,user_id,csrf,last_seen FROM sessions WHERE sid=$1',[sid]);
    if(stored.rowCount){
      const row=stored.rows[0];
      session=cacheSession({sid:row.sid,userId:row.user_id,csrf:row.csrf,lastSeen:new Date(row.last_seen).getTime(),persistedAt:new Date(row.last_seen).getTime()});
    }
  }
  if(session&&Date.now()-session.lastSeen>SESSION_TTL){await destroySession(session.sid);session=null}
  if(session&&session.userId&&!await findUserById(session.userId)){await destroySession(session.sid);session=null}
  if(!session){session=cacheSession(newSessionRecord(null));setSessionCookie(res,session.sid)}
  session.lastSeen=Date.now();
  // Writing last_seen on every request would make each one a database write for
  // no benefit, so the row is refreshed at most once a minute.
  if(session.userId&&Date.now()-session.persistedAt>SESSION_PERSIST_INTERVAL_MS)await persistSession(session);
  return session;
}
async function rotateSession(res,oldSession,userId=null){
  await destroySession(oldSession.sid);
  const session=cacheSession(newSessionRecord(userId));
  await persistSession(session);
  setSessionCookie(res,session.sid);
  return session;
}
async function sessionUser(session){return session.userId?await findUserById(session.userId):null}
async function authenticated(res,session){const user=await sessionUser(session);if(!user){json(res,401,{error:{code:'AUTH_REQUIRED',message:'Please sign in.'}});return null}return user}
function requireRole(res,user,role){if(user.role!==role){json(res,403,{error:{code:'FORBIDDEN',message:`${role.toLowerCase()} access required.`}});return false}return true}
function sameToken(a='',b=''){const left=Buffer.from(String(a));const right=Buffer.from(String(b));return left.length===right.length&&timingSafeEqual(left,right)}
// Operational metrics are readable without a token only for a request that
// reached this process directly, which on a tunnelled deployment means from
// the host itself. Anything arriving through a proxy - and anything at all in
// production - has to present METRICS_TOKEN.
function metricsAllowed(req){
  const token=String(process.env.METRICS_TOKEN||'');
  if(token&&sameToken(req.headers.authorization,`Bearer ${token}`))return true;
  if(IS_PRODUCTION)return false;
  return !(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']);
}
function clientIp(req){
  if(TRUST_PROXY){
    const forwarded=String(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||'').split(',')[0].trim();
    if(forwarded)return forwarded;
  }
  return req.socket.remoteAddress;
}
function mutationAllowed(req,res,session){const origin=req.headers.origin;if(origin&&!ALLOWED_ORIGINS.has(origin)){json(res,403,{error:{code:'ORIGIN_REJECTED',message:'Request origin is not allowed.'}});return false}if(!sameToken(req.headers['x-csrf-token'],session.csrf)){json(res,403,{error:{code:'CSRF_INVALID',message:'Security token is missing or invalid.'}});return false}if(!(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:{code:'CONTENT_TYPE_INVALID',message:'Use application/json.'}});return false}return true}
async function readJson(req,res,maxBytes=32768){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>maxBytes){json(res,413,{error:{code:'PAYLOAD_TOO_LARGE',message:'Request is too large.'}});return null}chunks.push(chunk)}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{json(res,400,{error:{code:'JSON_INVALID',message:'Malformed JSON.'}});return null}}
function rateLimit(key,limit,windowMs){const now=Date.now();const active=(rateBuckets.get(key)||[]).filter(t=>now-t<windowMs);if(active.length>=limit)return false;active.push(now);rateBuckets.set(key,active);return true}
async function audit(actorId,action,entityType,entityId=null,metadata={}){try{await query('INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[id('audit'),actorId,action,entityType,entityId,JSON.stringify(metadata)])}catch(error){console.error('audit_write_failed',{action,entityType,message:error.message})}}
async function trainerDashboard(user,timezone){
  const traineeIds=await activeTraineeIds(user.id),trainerAssignments=[...assignments.values()].filter(a=>a.trainerId===user.id&&a.status!=='ARCHIVED'),completed=trainerAssignments.filter(a=>a.status==='COMPLETED').length;
  const progress=traineeIds.length?await query("SELECT count(*)::int AS count FROM progress_entries WHERE trainee_id = ANY($1) AND measured_at >= now() - interval '7 days'",[traineeIds]):{rows:[{count:0}]};
  const clientRecords=await usersByIds(traineeIds);
  const clients=traineeIds.map(userId=>{const client=publicUser(clientRecords.get(userId)),clientAssignments=trainerAssignments.filter(a=>a.traineeId===userId),clientCompleted=clientAssignments.filter(a=>a.status==='COMPLETED').length;return{...client,assignedCount:clientAssignments.length,completedCount:clientCompleted,completionRate:clientAssignments.length?Math.round(clientCompleted/clientAssignments.length*100):0,lastWorkout:clientAssignments.sort((a,b)=>String(b.dueDate).localeCompare(String(a.dueDate)))[0]?.templateSnapshot?.name||'No program assigned'}});
  // Dates are compared as calendar strings in the viewer's zone rather than as
  // instants, so nothing is overdue until it is actually yesterday for them.
  const today=todayIn(timezone);
  const overdue=trainerAssignments.filter(a=>a.status==='ASSIGNED'&&a.dueDate&&String(a.dueDate).slice(0,10)<today);
  return{kind:'TRAINER',activeClients:traineeIds.length,clients,workoutsCompleted:completed,assignedCount:trainerAssignments.length,completionRate:trainerAssignments.length?Math.round(completed/trainerAssignments.length*100):0,progressUpdates:Number(progress.rows[0]?.count||0),attentionCount:overdue.length,attentionItems:overdue.slice(0,5).map(a=>({id:a.id,trainee:publicUser(clientRecords.get(a.traineeId)),name:a.templateSnapshot.name,dueDate:a.dueDate})),upcoming:trainerAssignments.filter(a=>!['COMPLETED','SKIPPED'].includes(a.status)).sort((a,b)=>String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))).slice(0,6).map(a=>({id:a.id,trainee:publicUser(clientRecords.get(a.traineeId)),name:a.templateSnapshot.name,dueDate:a.dueDate,status:a.status}))};
}
async function traineeDashboard(user,timezone){const active=[...assignments.values()].filter(a=>a.traineeId===user.id&&a.status!=='ARCHIVED').sort((a,b)=>String(a.dueDate).localeCompare(String(b.dueDate))),completed=active.filter(a=>a.status==='COMPLETED').length,relationship=(await relationshipsFor(user,'ACTIVE'))[0],trainerUser=relationship&&await findUserById(relationship.trainerId);return{kind:'TRAINEE',todayWorkout:active[0]?{id:active[0].id,name:active[0].templateSnapshot.name,exerciseCount:active[0].templateSnapshot.exercises.length,status:active[0].status}:null,currentStreak:completed,weeklyCompletion:active.length?Math.round(completed/active.length*100):0,completedCount:completed,assignedCount:active.length,trainerName:trainerUser?.name||null}}
// A trainee always reaches their own records. A trainer reaches them through an
// active relationship AND the specific permission the action needs; passing no
// capability means the relationship alone is enough, which is the case for a
// trainer's own coaching material rather than the trainee's health data.
async function accessibleTrainee(user,requestedId,capability=null){
  const traineeId=user.role==='TRAINEE'?user.id:requestedId;
  if(!traineeId)return null;
  if(user.role==='TRAINEE')return traineeId;
  const relationship=await findRelationship(user.id,traineeId);
  if(relationship?.status!=='ACTIVE')return null;
  if(capability&&!relationshipPermissions(relationship)[capability])return null;
  return traineeId;
}
async function activeRelationship(user,requestedTraineeId){
  const active=await relationshipsFor(user,'ACTIVE');
  return user.role==='TRAINER'?active.find(item=>!requestedTraineeId||item.traineeId===requestedTraineeId):active[0]||undefined;
}

async function authApi(req,res,url,session){
  if(req.method==='POST'&&url.pathname==='/api/auth/register'){
    if(!mutationAllowed(req,res,session))return true;if(!rateLimit(`register:${clientIp(req)}`,REGISTRATION_LIMIT,3600000)){json(res,429,{error:{code:'RATE_LIMITED',message:'Too many registration attempts.'}});return true}
    const body=await readJson(req,res);if(!body)return true;const email=cleanEmail(body.email),role=body.role;
    if(!validName(body.name)){json(res,422,{error:{code:'NAME_INVALID',message:'Name must be 2–80 characters.'}});return true}if(!validEmail(email)){json(res,422,{error:{code:'EMAIL_INVALID',message:'Enter a valid email address.'}});return true}if(!validPassword(body.password)){json(res,422,{error:{code:'PASSWORD_WEAK',message:'Use 10+ characters with upper/lowercase, number, and symbol.'}});return true}if(!['TRAINER','TRAINEE'].includes(role)){json(res,422,{error:{code:'ROLE_INVALID',message:'Choose trainer or trainee.'}});return true}if(body.privacyAccepted!==true||body.privacyNoticeVersion!==PRIVACY_NOTICE_VERSION){json(res,422,{error:{code:'PRIVACY_CONSENT_REQUIRED',message:'Review and accept the current Privacy Notice to create an account.'}});return true}if(await findUserByEmail(email)){json(res,409,{error:{code:'EMAIL_EXISTS',message:'An account already exists for this email.'}});return true}
    const user=await createUser({name:body.name,email,password:body.password,role,privacyNoticeVersion:PRIVACY_NOTICE_VERSION});const next=await rotateSession(res,session,user.id);const verification=await issueEmailVerification(user);json(res,201,{user:publicUser(user),csrfToken:next.csrf,privacyNoticeVersion:PRIVACY_NOTICE_VERSION,emailVerification:verification});return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/login'){
    if(!mutationAllowed(req,res,session))return true;const body=await readJson(req,res);if(!body)return true;const email=cleanEmail(body.email);const bucket=`login:${clientIp(req)}:${email}`;
    if(!rateLimit(bucket,LOGIN_LIMIT,15*60*1000)){json(res,429,{error:{code:'RATE_LIMITED',message:'Too many sign-in attempts. Try again later.'}});return true}const user=await findUserByEmail(email);const correct=user&&await verifyPassword(String(body.password||''),user.passwordHash);
    if(!correct||user.status!=='ACTIVE'){await new Promise(resolve=>setTimeout(resolve,180));json(res,401,{error:{code:'CREDENTIALS_INVALID',message:'Email or password is incorrect.'}});return true}const next=await rotateSession(res,session,user.id);json(res,200,{user:publicUser(user),csrfToken:next.csrf});return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/forgot-password'){
    if(!mutationAllowed(req,res,session))return true;const body=await readJson(req,res);if(!body)return true;const email=cleanEmail(body.email);
    if(!rateLimit(`password-reset:${clientIp(req)}:${email}`,5,3600000)){json(res,429,{error:{code:'RATE_LIMITED',message:'Too many reset requests. Try again later.'}});return true}
    const foundUser=await findUserByEmail(email),userId=foundUser?.id;let demoResetToken=null;
    if(userId){const rawToken=randomBytes(32).toString('base64url');const tokenHash=Buffer.from(await scrypt(rawToken,'ptrainer-reset-v1',32)).toString('base64url');const reset={userId,expiresAt:Date.now()+15*60*1000,used:false};passwordResets.set(tokenHash,reset);await query('INSERT INTO password_reset_tokens(token_hash,user_id,expires_at) VALUES($1,$2,$3) ON CONFLICT(token_hash) DO NOTHING',[tokenHash,userId,new Date(reset.expiresAt).toISOString()]);await sendEmail({to:email,...resetEmail(foundUser?.name||'there',`${APP_ORIGIN}/?reset=${rawToken}`)},log);demoResetToken=rawToken}
    json(res,202,{message:'If the account exists, reset instructions have been created.',...(!IS_PRODUCTION&&demoResetToken?{demoResetToken}:{})});return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/reset-password'){
    if(!mutationAllowed(req,res,session))return true;const body=await readJson(req,res);if(!body)return true;if(!validPassword(body.password)){json(res,422,{error:{code:'PASSWORD_WEAK',message:'Use 10+ characters with upper/lowercase, number, and symbol.'}});return true}
    const rawToken=typeof body.token==='string'?body.token:'';const tokenHash=Buffer.from(await scrypt(rawToken,'ptrainer-reset-v1',32)).toString('base64url');let reset=passwordResets.get(tokenHash);if(!reset){const stored=await query('SELECT user_id,expires_at,used_at FROM password_reset_tokens WHERE token_hash=$1',[tokenHash]);if(stored.rowCount)reset={userId:stored.rows[0].user_id,expiresAt:new Date(stored.rows[0].expires_at).getTime(),used:Boolean(stored.rows[0].used_at)}}
    if(!reset||reset.used||reset.expiresAt<Date.now()){json(res,400,{error:{code:'RESET_TOKEN_INVALID',message:'Reset link is invalid or expired.'}});return true}
    const user=await findUserById(reset.userId);if(!user){json(res,400,{error:{code:'RESET_TOKEN_INVALID',message:'Reset link is invalid or expired.'}});return true}reset.used=true;user.passwordHash=await hashPassword(body.password);forgetUser(user);await query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[user.passwordHash,user.id]);await query('UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1',[tokenHash]);await destroyUserSessions(user.id);const next=await rotateSession(res,session,null);json(res,200,{message:'Password updated. Sign in with your new password.',csrfToken:next.csrf});return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/verify-email'){
    if(!mutationAllowed(req,res,session))return true;
    const body=await readJson(req,res);if(!body)return true;
    const rawToken=typeof body.token==='string'?body.token:'';
    if(!rawToken){json(res,422,{error:{code:'VERIFICATION_TOKEN_REQUIRED',message:'Verification link is missing its token.'}});return true}
    const stored=await query('SELECT token_hash,user_id,email,expires_at,used_at FROM email_verification_tokens WHERE token_hash=$1',[tokenDigest(rawToken)]);
    const record=stored.rows[0],target=record&&await findUserById(record.user_id);
    // A token issued for one address must not verify a different one, so a later
    // address change invalidates the links already in somebody's inbox.
    if(!record||record.used_at||new Date(record.expires_at).getTime()<Date.now()||!target||target.email!==record.email){
      json(res,400,{error:{code:'VERIFICATION_TOKEN_INVALID',message:'Verification link is invalid or expired.'}});return true;
    }
    const verifiedAt=new Date().toISOString();
    await transaction(async tx=>{
      await tx('UPDATE users SET email_verified_at=COALESCE(email_verified_at,$1),updated_at=now() WHERE id=$2',[verifiedAt,target.id]);
      await tx('UPDATE email_verification_tokens SET used_at=now() WHERE token_hash=$1',[record.token_hash]);
    });
    target.emailVerifiedAt=target.emailVerifiedAt||verifiedAt;forgetUser(target);
    await audit(target.id,'EMAIL_VERIFIED','user',target.id);
    json(res,200,{user:publicUser(target)});return true;
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){if(!mutationAllowed(req,res,session))return true;await destroySession(session.sid);setSessionCookie(res,'',0);json(res,200,{ok:true});return true}
  return false;
}

async function api(req,res,url){
  let session=await getSession(req,res);
  if(req.method==='GET'&&url.pathname==='/api/session'){const user=await sessionUser(session);return json(res,200,{authenticated:Boolean(user),user:user?publicUser(user):null,csrfToken:session.csrf,demoMode:!IS_PRODUCTION})}
  if(req.method==='GET'&&url.pathname==='/api/privacy')return json(res,200,{noticeVersion:PRIVACY_NOTICE_VERSION,effectiveDate:'2026-08-21',organization:PRIVACY_ORGANIZATION,contactEmail:PRIVACY_CONTACT_EMAIL,storageRegion:DATA_STORAGE_REGION,pilot:!IS_PRODUCTION});
  if(await authApi(req,res,url,session))return;
  const user=await authenticated(res,session);if(!user)return;
  if(req.method==='GET'&&url.pathname==='/api/food-products'){
    const searchQuery=normalizeFoodQuery(url.searchParams.get('q'));if(!searchQuery)return json(res,422,{error:{code:'FOOD_QUERY_INVALID',message:'Type at least 2 characters of a food name.'}});if(!rateLimit(`food-search:${user.id}`,60,60000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many food searches. Try again in a minute.'}});
    // The query is a food name a trainee typed, so it never reaches the logs.
    const cacheKey=searchQuery.toLowerCase(),cached=foodSearchCache.get(cacheKey);if(cached&&cached.expiresAt>Date.now())return json(res,200,{...cached.payload,cached:true});
    const found=await searchFoodsByName(searchQuery,{userAgent:FOOD_API_USER_AGENT});
    const payload={query:found.query,results:found.results,remoteAvailable:found.remoteAvailable};
    if(found.remoteAvailable){if(foodSearchCache.size>500)foodSearchCache.clear();foodSearchCache.set(cacheKey,{payload,expiresAt:Date.now()+30*60*1000})}
    return json(res,200,{...payload,cached:false});
  }
  const foodProductMatch=url.pathname.match(/^\/api\/food-products\/([^/]{1,32})$/);
  if(req.method==='GET'&&foodProductMatch){
    const barcode=normalizeBarcode(decodeURIComponent(foodProductMatch[1]));if(!barcode)return json(res,422,{error:{code:'BARCODE_INVALID',message:'Enter an 8–14 digit UPC, EAN, or GTIN barcode.'}});if(!rateLimit(`food-lookup:${user.id}`,30,60000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many barcode lookups. Try again in a minute.'}});const cached=foodProductCache.get(barcode);if(cached&&cached.expiresAt>Date.now())return json(res,200,{product:cached.product,cached:true});try{const product=await lookupFoodProduct(barcode,{userAgent:FOOD_API_USER_AGENT});if(!product)return json(res,404,{error:{code:'FOOD_NOT_FOUND',message:'This barcode is not in Open Food Facts. You can still enter the label manually.'}});foodProductCache.set(barcode,{product,expiresAt:Date.now()+6*60*60*1000});return json(res,200,{product,cached:false})}catch(error){if(error.name==='AbortError')return json(res,504,{error:{code:'FOOD_LOOKUP_TIMEOUT',message:'The food lookup timed out. Enter the label manually or try again.'}});log('warn','food_lookup_failed',{barcode,errorCode:error.code||'UNKNOWN'});return json(res,502,{error:{code:'FOOD_LOOKUP_UNAVAILABLE',message:'The food database is temporarily unavailable. Enter the label manually or try again.'}})}
  }
  if(req.method==='POST'&&url.pathname==='/api/auth/logout-others'){
    if(!mutationAllowed(req,res,session))return;
    const endedCount=await destroyUserSessions(user.id,session.sid);
    await audit(user.id,'OTHER_SESSIONS_ENDED','user',user.id,{endedCount});
    return json(res,200,{endedCount});
  }
  if(req.method==='GET'&&url.pathname==='/api/me/sessions'){
    const rows=await query('SELECT sid,created_at,last_seen FROM sessions WHERE user_id=$1 ORDER BY last_seen DESC LIMIT 50',[user.id]);
    // The identifier is the credential, so only a short fingerprint is returned.
    return json(res,200,{sessions:rows.rows.map(row=>({id:tokenDigest(row.sid).slice(0,12),current:row.sid===session.sid,createdAt:row.created_at,lastSeen:row.last_seen}))});
  }
  if(req.method==='POST'&&url.pathname==='/api/me/resend-verification'){
    if(!mutationAllowed(req,res,session))return;
    if(user.emailVerifiedAt)return json(res,409,{error:{code:'EMAIL_ALREADY_VERIFIED',message:'This address is already confirmed.'}});
    if(!rateLimit(`verify:${user.id}`,5,3600000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many verification emails. Try again later.'}});
    return json(res,202,{emailVerification:await issueEmailVerification(user)});
  }
  if(req.method==='GET'&&url.pathname==='/api/me/privacy'){const result=await query('SELECT notice_version,source,accepted_at,withdrawn_at FROM privacy_consents WHERE user_id=$1 ORDER BY accepted_at DESC LIMIT 1',[user.id]);return json(res,200,{consent:result.rows[0]||null,noticeVersion:PRIVACY_NOTICE_VERSION,storageRegion:DATA_STORAGE_REGION});}
  if(req.method==='GET'&&url.pathname==='/api/me'){
    const profileResult=await query('SELECT bio,goals,specialties,preferred_units,timezone,updated_at FROM user_profiles WHERE user_id=$1',[user.id]);
    return json(res,200,{user:publicUser(user),profile:profileResult.rows[0]||{bio:'',goals:'',specialties:'',preferred_units:'METRIC',timezone:'America/Toronto'}});
  }
  if(req.method==='PATCH'&&url.pathname==='/api/me/profile'){
    if(!mutationAllowed(req,res,session))return;const body=await readJson(req,res);if(!body)return;const name=String(body.name||'').trim(),bio=String(body.bio||'').trim(),goals=String(body.goals||'').trim(),specialties=String(body.specialties||'').trim(),preferredUnits=String(body.preferredUnits||'METRIC').toUpperCase(),timezone=String(body.timezone||'America/Toronto').trim();
    if(!validName(name)||bio.length>1000||goals.length>1000||specialties.length>500||!['METRIC','IMPERIAL'].includes(preferredUnits)||timezone.length<3||timezone.length>80)return json(res,422,{error:{code:'PROFILE_INVALID',message:'Profile fields are invalid or too long.'}});
    user.name=name;await query('UPDATE users SET name=$1,updated_at=now() WHERE id=$2',[name,user.id]);forgetUser(user);await query('INSERT INTO user_profiles(user_id,bio,goals,specialties,preferred_units,timezone) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET bio=$2,goals=$3,specialties=$4,preferred_units=$5,timezone=$6,updated_at=now()',[user.id,bio,goals,specialties,preferredUnits,timezone]);await audit(user.id,'PROFILE_UPDATED','user',user.id);return json(res,200,{user:publicUser(user),profile:{bio,goals,specialties,preferred_units:preferredUnits,timezone}});
  }
  if(req.method==='GET'&&url.pathname==='/api/me/export'){
    const [profile,connections,workouts,logs,setRows,progress,nutrition,nutritionTarget,messages,privacyConsents]=await Promise.all([query('SELECT bio,goals,specialties,preferred_units,timezone,updated_at FROM user_profiles WHERE user_id=$1',[user.id]),query('SELECT trainer_id,trainee_id,status,created_at,updated_at FROM trainer_trainee_relationships WHERE trainer_id=$1 OR trainee_id=$1',[user.id]),query('SELECT id,template_snapshot,due_date,status,created_at FROM assigned_workouts WHERE trainer_id=$1 OR trainee_id=$1',[user.id]),query('SELECT id,assigned_workout_id,exercises,completed_count,status,created_at FROM workout_logs WHERE author_id=$1',[user.id]),query('SELECT s.workout_log_id,s.exercise_index,s.set_index,s.completed,s.reps,s.load_value::float,s.load_unit,s.duration_seconds,s.distance_value::float,s.distance_unit,s.rest_seconds,s.exertion::float,s.pain_flag,s.note FROM set_logs s JOIN workout_logs l ON l.id=s.workout_log_id WHERE l.author_id=$1 ORDER BY s.exercise_index,s.set_index',[user.id]),query('SELECT id,metric_type,value,unit,measured_at,note,created_at FROM progress_entries WHERE trainee_id=$1',[user.id]),query('SELECT id,entry_date,entry_type,description,calories,protein_g,carbs_g,fat_g,water_ml,food_barcode,food_name,food_brand,food_quantity_g,data_source,created_at,updated_at FROM nutrition_entries WHERE trainee_id=$1',[user.id]),query('SELECT calories,protein_g,carbs_g,fat_g,water_ml,author_id,updated_at FROM nutrition_targets WHERE trainee_id=$1',[user.id]),query('SELECT id,sender_id,body,created_at FROM messages WHERE sender_id=$1',[user.id]),query('SELECT notice_version,source,accepted_at,withdrawn_at FROM privacy_consents WHERE user_id=$1 ORDER BY accepted_at',[user.id])]);
    await audit(user.id,'PERSONAL_DATA_EXPORTED','user',user.id);return json(res,200,{exportedAt:new Date().toISOString(),user:publicUser(user),profile:profile.rows[0]||null,relationships:connections.rows,assignedWorkouts:workouts.rows,authoredWorkoutLogs:logs.rows,authoredSetLogs:setRows.rows,progressEntries:progress.rows,nutritionEntries:nutrition.rows,nutritionTarget:nutritionTarget.rows[0]||null,authoredMessages:messages.rows,privacyConsents:privacyConsents.rows});
  }
  if(req.method==='GET'&&url.pathname==='/api/me/audit-events'){const result=await query('SELECT action,entity_type,entity_id,metadata,created_at FROM audit_events WHERE actor_id=$1 ORDER BY created_at DESC LIMIT 50',[user.id]);return json(res,200,{events:result.rows})}
  if(req.method==='DELETE'&&url.pathname==='/api/me/account'){
    if(!mutationAllowed(req,res,session))return;const body=await readJson(req,res);if(!body)return;if(body.confirmation!=='DELETE PTRAINER ACCOUNT')return json(res,422,{error:{code:'DELETION_CONFIRMATION_INVALID',message:'Enter the exact account deletion confirmation.'}});const correct=await verifyPassword(String(body.password||''),user.passwordHash);if(!correct)return json(res,401,{error:{code:'CREDENTIALS_INVALID',message:'Password is incorrect.'}});const anonymousEmail=`deleted+${tokenDigest(user.id).slice(0,20).toLowerCase()}@ptrainer.invalid`,randomPassword=await hashPassword(randomBytes(32).toString('base64url'));const purged={setLogs:0,workoutLogs:0,progressEntries:0,nutritionEntries:0,nutritionTargets:0,trainerNotes:0,messages:0,notifications:0,tokens:0};
    await transaction(async tx=>{
      // Anonymising the identity row left every measurement, meal note, set and
      // message body behind, which is the gap the privacy checklist calls out.
      // Order matters: child rows before the parents they hang off.
      purged.setLogs=(await tx('DELETE FROM set_logs WHERE workout_log_id IN (SELECT id FROM workout_logs WHERE author_id=$1) RETURNING id',[user.id])).rowCount;
      purged.workoutLogs=(await tx('DELETE FROM workout_logs WHERE author_id=$1 RETURNING id',[user.id])).rowCount;
      purged.progressEntries=(await tx('DELETE FROM progress_entries WHERE trainee_id=$1 OR author_id=$1 RETURNING id',[user.id])).rowCount;
      purged.nutritionEntries=(await tx('DELETE FROM nutrition_entries WHERE trainee_id=$1 OR author_id=$1 RETURNING id',[user.id])).rowCount;
      purged.nutritionTargets=(await tx('DELETE FROM nutrition_targets WHERE trainee_id=$1 OR author_id=$1 RETURNING trainee_id',[user.id])).rowCount;
      purged.trainerNotes=(await tx('DELETE FROM trainer_notes WHERE trainer_id=$1 OR trainee_id=$1 RETURNING id',[user.id])).rowCount;
      // A conversation has two sides; the other person's copy stays, but nothing
      // this account wrote survives in it.
      purged.messages=(await tx("UPDATE messages SET body='[deleted]' WHERE sender_id=$1 AND body<>'[deleted]' RETURNING id",[user.id])).rowCount;
      purged.notifications=(await tx('DELETE FROM notifications WHERE recipient_id=$1 RETURNING id',[user.id])).rowCount;
      const resets=await tx('DELETE FROM password_reset_tokens WHERE user_id=$1 RETURNING token_hash',[user.id]);
      const verifications=await tx('DELETE FROM email_verification_tokens WHERE user_id=$1 RETURNING token_hash',[user.id]);
      purged.tokens=resets.rowCount+verifications.rowCount;
      // Counts only. What was deleted is exactly what must not be copied into
      // the audit trail on the way out.
      await tx('INSERT INTO audit_events(id,actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',[id('audit'),user.id,'ACCOUNT_DELETED','user',user.id,JSON.stringify(purged)]);
      await tx("UPDATE users SET email=$1,password_hash=$2,name='Deleted user',status='DELETED',updated_at=now() WHERE id=$3",[anonymousEmail,randomPassword,user.id]);
      await tx('UPDATE privacy_consents SET withdrawn_at=COALESCE(withdrawn_at,now()) WHERE user_id=$1',[user.id]);
      await tx('DELETE FROM user_profiles WHERE user_id=$1',[user.id]);
      await tx("UPDATE trainer_trainee_relationships SET status='REVOKED',updated_at=now() WHERE (trainer_id=$1 OR trainee_id=$1) AND status<>'REVOKED'",[user.id]);
    });
    forgetUser(user);user.email=anonymousEmail;user.name='Deleted user';user.status='DELETED';await destroyUserSessions(user.id);setSessionCookie(res,'',0);return json(res,200,{deleted:true,purged});
  }
  if(req.method==='GET'&&url.pathname==='/api/dashboard'){
    const zone=await query('SELECT timezone FROM user_profiles WHERE user_id=$1',[user.id]);
    const timezone=zone.rows[0]?.timezone||'UTC';
    return json(res,200,{...(await (user.role==='TRAINER'?trainerDashboard(user,timezone):traineeDashboard(user,timezone))),today:todayIn(timezone),timezone});
  }
  if(url.pathname==='/api/exercises'&&['GET','POST'].includes(req.method)){
    if(req.method==='POST'&&!mutationAllowed(req,res,session))return;
    if(!requireRole(res,user,'TRAINER'))return;
    if(req.method==='GET'){
      const search=String(url.searchParams.get('q')||'').trim().toLocaleLowerCase().slice(0,100);
      const limit=Math.min(250,Math.max(1,Number(url.searchParams.get('limit'))||60));
      // A trainer reaches the platform library plus their own movements, never
      // another trainer's. Retired rows stay for the history that names them but
      // drop out of every list.
      const conditions=["(visibility='PLATFORM' OR created_by=$1)","deleted_at IS NULL"],params=[user.id];
      if(search){params.push(`%${search}%`);const slot=`$`+params.length;conditions.push(`(lower(name) LIKE ${slot} OR lower(muscle_group) LIKE ${slot} OR lower(equipment) LIKE ${slot})`)}
      const where=conditions.join(' AND '),listParams=[...params,limit];
      const [rows,total,catalogTotal]=await Promise.all([
        query(`SELECT id,name,muscle_group,equipment,instructions,difficulty,media_url,visibility,created_by,version FROM exercises WHERE ${where} ORDER BY name LIMIT ${`$`+listParams.length}`,listParams),
        query(`SELECT count(*)::int AS count FROM exercises WHERE ${where}`,params),
        query("SELECT count(*)::int AS count FROM exercises WHERE (visibility='PLATFORM' OR created_by=$1) AND deleted_at IS NULL",[user.id])
      ]);
      return json(res,200,{exercises:rows.rows.map(row=>({id:row.id,name:row.name,muscleGroup:row.muscle_group,equipment:row.equipment,instructions:row.instructions,difficulty:row.difficulty,mediaUrl:row.media_url,visibility:row.visibility,version:row.version,canManage:row.created_by===user.id})),total:Number(total.rows[0].count),catalogTotal:Number(catalogTotal.rows[0].count),customNamesAllowed:true});
    }
    const body=await readJson(req,res);if(!body)return;
    const definition=normalizeExerciseInput(body);
    if(!definition)return json(res,422,{error:{code:'EXERCISE_INVALID',message:'Add a name of 2-100 characters and valid movement details.'}});
    const exerciseId=id('ex');
    try{
      await query('INSERT INTO exercises(id,name,name_key,muscle_group,equipment,instructions,difficulty,media_url,visibility,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[exerciseId,definition.name,exerciseNameKey(definition.name),definition.muscleGroup,definition.equipment,definition.instructions,definition.difficulty,definition.mediaUrl,'TRAINER',user.id]);
    }catch(error){
      // The partial unique index is what actually enforces this, so a duplicate
      // is reported from the constraint rather than a racy pre-check.
      if(String(error.message||'').includes('exercises_trainer_name'))return json(res,409,{error:{code:'EXERCISE_EXISTS',message:'You already have a movement with this name.'}});
      throw error;
    }
    await audit(user.id,'EXERCISE_CREATED','exercise',exerciseId);
    return json(res,201,{exercise:{id:exerciseId,...definition,visibility:'TRAINER',version:1,canManage:true}});
  }
  const exerciseMatch=url.pathname.match(/^\/api\/exercises\/([A-Za-z0-9_-]{1,64})$/);
  if(exerciseMatch&&['PATCH','DELETE'].includes(req.method)){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;
    // Only the movements a trainer created are theirs to change; the platform
    // library is shared and a 404 keeps its ids from being probed for existence.
    const existing=await query("SELECT id,version FROM exercises WHERE id=$1 AND created_by=$2 AND visibility='TRAINER' AND deleted_at IS NULL",[exerciseMatch[1],user.id]);
    if(!existing.rowCount)return json(res,404,{error:{code:'EXERCISE_NOT_FOUND',message:'Movement not found in your library.'}});
    if(req.method==='DELETE'){
      await query('UPDATE exercises SET deleted_at=now(),updated_at=now() WHERE id=$1',[exerciseMatch[1]]);
      await audit(user.id,'EXERCISE_RETIRED','exercise',exerciseMatch[1]);
      return json(res,200,{retired:true});
    }
    const body=await readJson(req,res);if(!body)return;
    const definition=normalizeExerciseInput(body);
    if(!definition)return json(res,422,{error:{code:'EXERCISE_INVALID',message:'Add a name of 2-100 characters and valid movement details.'}});
    const updated=await query('UPDATE exercises SET name=$1,name_key=$2,muscle_group=$3,equipment=$4,instructions=$5,difficulty=$6,media_url=$7,version=version+1,updated_at=now() WHERE id=$8 RETURNING id,name,muscle_group,equipment,instructions,difficulty,media_url,visibility,version',[definition.name,exerciseNameKey(definition.name),definition.muscleGroup,definition.equipment,definition.instructions,definition.difficulty,definition.mediaUrl,exerciseMatch[1]]);
    await audit(user.id,'EXERCISE_UPDATED','exercise',exerciseMatch[1]);
    const row=updated.rows[0];
    return json(res,200,{exercise:{id:row.id,name:row.name,muscleGroup:row.muscle_group,equipment:row.equipment,instructions:row.instructions,difficulty:row.difficulty,mediaUrl:row.media_url,visibility:row.visibility,version:row.version,canManage:true}});
  }
  if(req.method==='GET'&&url.pathname==='/api/workout-templates'){if(!requireRole(res,user,'TRAINER'))return;return json(res,200,{templates:[...workoutTemplates.values()].filter(t=>t.trainerId===user.id)})}
  if(req.method==='POST'&&url.pathname==='/api/workout-templates'){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;const body=await readJson(req,res);if(!body)return;const name=typeof body.name==='string'?body.name.trim():'';
    if(name.length<3||name.length>100||!Array.isArray(body.exercises)||body.exercises.length<1||body.exercises.length>30)return json(res,422,{error:{code:'TEMPLATE_INVALID',message:'Add a name and 1-30 valid exercises.'}});
    const exercises=body.exercises.map(x=>({name:String(x.name||'').trim().slice(0,100),sets:Math.min(20,Math.max(1,Number(x.sets)||1)),reps:Math.min(1000,Math.max(1,Number(x.reps)||1)),restSeconds:Math.min(900,Math.max(0,Number(x.restSeconds)||0)),exerciseId:typeof x.exerciseId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x.exerciseId)?x.exerciseId:null}));if(exercises.some(x=>x.name.length<2))return json(res,422,{error:{code:'EXERCISE_INVALID',message:'Every exercise needs a valid name.'}});
    const template={id:id('tpl'),trainerId:user.id,name,description:String(body.description||'').trim().slice(0,500),exercises,version:1,createdAt:new Date().toISOString()};await query('INSERT INTO workout_templates(id,trainer_id,name,description,version,exercises,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[template.id,template.trainerId,template.name,template.description,template.version,JSON.stringify(template.exercises),template.createdAt]);workoutTemplates.set(template.id,template);await audit(user.id,'WORKOUT_TEMPLATE_CREATED','workout_template',template.id);return json(res,201,{template});
  }
  const templateMatch=url.pathname.match(/^\/api\/workout-templates\/([A-Za-z0-9_-]{1,64})$/);
  const templateDuplicate=url.pathname.match(/^\/api\/workout-templates\/([A-Za-z0-9_-]{1,64})\/duplicate$/);
  if((templateMatch&&['PATCH','DELETE'].includes(req.method))||(templateDuplicate&&req.method==='POST')){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;
    const templateId=(templateMatch||templateDuplicate)[1],template=workoutTemplates.get(templateId);
    if(!template||template.trainerId!==user.id)return json(res,404,{error:{code:'TEMPLATE_NOT_FOUND',message:'Workout template not found.'}});
    if(templateDuplicate){
      // Duplicating is how a trainer builds a variant without re-typing a whole
      // session, which plan section 15 names as the fix for slow setup.
      const copy={id:id('tpl'),trainerId:user.id,name:`${template.name} copy`.slice(0,100),description:template.description,exercises:structuredClone(template.exercises),version:1,createdAt:new Date().toISOString()};
      await query('INSERT INTO workout_templates(id,trainer_id,name,description,version,exercises,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[copy.id,copy.trainerId,copy.name,copy.description,copy.version,JSON.stringify(copy.exercises),copy.createdAt]);
      workoutTemplates.set(copy.id,copy);
      await audit(user.id,'WORKOUT_TEMPLATE_DUPLICATED','workout_template',copy.id,{sourceId:template.id});
      return json(res,201,{template:copy});
    }
    if(req.method==='DELETE'){
      // Soft delete only: assignments already made carry their own snapshot, and
      // the template row stays readable for the history that points at it.
      await query('UPDATE workout_templates SET deleted_at=now(),updated_at=now() WHERE id=$1 AND trainer_id=$2',[templateId,user.id]);
      workoutTemplates.delete(templateId);
      await audit(user.id,'WORKOUT_TEMPLATE_DELETED','workout_template',templateId);
      return json(res,200,{deleted:true});
    }
    const body=await readJson(req,res);if(!body)return;
    const name=typeof body.name==='string'?body.name.trim():'';
    if(name.length<3||name.length>100||!Array.isArray(body.exercises)||body.exercises.length<1||body.exercises.length>30)return json(res,422,{error:{code:'TEMPLATE_INVALID',message:'Add a name and 1-30 valid exercises.'}});
    const exercises=body.exercises.map(x=>({name:String(x.name||'').trim().slice(0,100),sets:Math.min(20,Math.max(1,Number(x.sets)||1)),reps:Math.min(1000,Math.max(1,Number(x.reps)||1)),restSeconds:Math.min(900,Math.max(0,Number(x.restSeconds)||0)),exerciseId:typeof x.exerciseId==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(x.exerciseId)?x.exerciseId:null}));
    if(exercises.some(x=>x.name.length<2))return json(res,422,{error:{code:'EXERCISE_INVALID',message:'Every exercise needs a valid name.'}});
    const nextVersion=Number(template.version||1)+1;
    await query('UPDATE workout_templates SET name=$1,description=$2,exercises=$3,version=$4,updated_at=now() WHERE id=$5 AND trainer_id=$6',[name,String(body.description||'').trim().slice(0,500),JSON.stringify(exercises),nextVersion,templateId,user.id]);
    Object.assign(template,{name,description:String(body.description||'').trim().slice(0,500),exercises,version:nextVersion});
    await audit(user.id,'WORKOUT_TEMPLATE_UPDATED','workout_template',templateId,{version:nextVersion});
    return json(res,200,{template});
  }
  if(req.method==='POST'&&url.pathname==='/api/assigned-workouts'){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;
    const body=await readJson(req,res);if(!body)return;
    const template=workoutTemplates.get(body.templateId);
    if(!template||template.trainerId!==user.id)return json(res,403,{error:{code:'ASSIGNMENT_FORBIDDEN',message:'Template or trainee access is invalid.'}});
    // One trainee or several: the same program often goes to a whole group, and
    // doing it one request at a time is the setup cost plan section 15 warns about.
    const requested=Array.isArray(body.traineeIds)&&body.traineeIds.length?body.traineeIds:[body.traineeId];
    const traineeIds=[...new Set(requested.filter(value=>typeof value==='string'&&value))];
    if(!traineeIds.length||traineeIds.length>50)return json(res,422,{error:{code:'ASSIGNMENT_TRAINEES_INVALID',message:'Choose between 1 and 50 connected trainees.'}});
    const connected=new Set(await activeTraineeIds(user.id));
    if(traineeIds.some(traineeId=>!connected.has(traineeId)))return json(res,403,{error:{code:'ASSIGNMENT_FORBIDDEN',message:'Template or trainee access is invalid.'}});
    const schedule=normalizeSchedule(body);
    if(!schedule){
      const singleDate=String(body.startDate||body.dueDate||'').slice(0,10),repeating=String(body.frequency||'ONCE').toUpperCase()!=='ONCE';
      if(!repeating&&singleDate&&!validDateOnly(singleDate))return json(res,422,{error:{code:'DUE_DATE_INVALID',message:'Enter a valid due date.'}});
      return json(res,422,{error:{code:'SCHEDULE_INVALID',message:'Check the start date, frequency, and end date. A repeating program needs an end date.'}});
    }
    const createdAt=new Date().toISOString(),created=[];
    await transaction(async tx=>{
      for(const traineeId of traineeIds){
        // Each occurrence carries its own snapshot, so editing or retiring the
        // template later never reaches back into a session already scheduled.
        const seriesId=schedule.dates.length>1?id('series'):null;
        for(const dueDate of schedule.dates){
          const assignment={id:id('assigned'),templateId:template.id,templateSnapshot:structuredClone(template),trainerId:user.id,traineeId,dueDate,startDate:schedule.startDate,endDate:schedule.endDate,frequency:schedule.frequency,seriesId,status:'ASSIGNED',createdAt};
          await tx('INSERT INTO assigned_workouts(id,template_id,trainer_id,trainee_id,template_snapshot,due_date,start_date,end_date,frequency,series_id,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)',[assignment.id,assignment.templateId,assignment.trainerId,assignment.traineeId,JSON.stringify(assignment.templateSnapshot),assignment.dueDate||null,assignment.startDate||null,assignment.endDate||null,assignment.frequency,assignment.seriesId,assignment.status,assignment.createdAt]);
          created.push(assignment);
        }
        await tx("INSERT INTO notifications(id,recipient_id,event_type,title,body) VALUES($1,$2,'WORKOUT_ASSIGNED',$3,$4)",[id('notification'),traineeId,'New workout assigned',`${template.name}${schedule.dates.length>1?` · ${schedule.dates.length} sessions`:schedule.dates[0]?` · ${schedule.dates[0]}`:''}`]);
      }
    });
    for(const assignment of created)assignments.set(assignment.id,assignment);
    await audit(user.id,'WORKOUT_ASSIGNED','assigned_workout',created[0].id,{traineeCount:traineeIds.length,occurrences:created.length,frequency:schedule.frequency});
    return json(res,201,{assignment:created[0],assignments:created});
  }
  if(req.method==='POST'&&url.pathname==='/api/assigned-workouts/custom'){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;const body=await readJson(req,res);if(!body)return;const workout=normalizeWorkoutInput(body),relationship=await findRelationship(user.id,body.traineeId);if(!workout)return json(res,422,{error:{code:'WORKOUT_INVALID',message:'Add a valid name, date, and 1–30 exercises.'}});if(!relationship||relationship.status!=='ACTIVE')return json(res,403,{error:{code:'ASSIGNMENT_FORBIDDEN',message:'An active coaching relationship is required.'}});const createdAt=new Date().toISOString(),template={id:id('tpl'),trainerId:user.id,name:workout.name,description:workout.description,exercises:workout.exercises,version:1,createdAt},assignment={id:id('assigned'),templateId:null,templateSnapshot:null,trainerId:user.id,traineeId:body.traineeId,dueDate:workout.dueDate,status:'ASSIGNED',createdAt};assignment.templateId=template.id;assignment.templateSnapshot=structuredClone(template);await transaction(async tx=>{await tx('INSERT INTO workout_templates(id,trainer_id,name,description,version,exercises,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[template.id,template.trainerId,template.name,template.description,template.version,JSON.stringify(template.exercises),template.createdAt]);await tx('INSERT INTO assigned_workouts(id,template_id,trainer_id,trainee_id,template_snapshot,due_date,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[assignment.id,assignment.templateId,assignment.trainerId,assignment.traineeId,JSON.stringify(assignment.templateSnapshot),assignment.dueDate||null,assignment.status,assignment.createdAt]);await tx("INSERT INTO notifications(id,recipient_id,event_type,title,body) VALUES($1,$2,'WORKOUT_ASSIGNED',$3,$4)",[id('notification'),assignment.traineeId,'New workout assigned',`${assignment.templateSnapshot.name}${assignment.dueDate?` · ${assignment.dueDate}`:''}`])});workoutTemplates.set(template.id,template);assignments.set(assignment.id,assignment);await audit(user.id,'WORKOUT_ASSIGNED','assigned_workout',assignment.id,{traineeId:assignment.traineeId,custom:true});return json(res,201,{assignment});
  }
  if(req.method==='GET'&&url.pathname==='/api/assigned-workouts'){
    const limit=pageLimit(url,50,200),cursor=decodeCursor(url.searchParams.get('cursor'),2);
    // Column name comes from the role, never from the request.
    const ownerColumn=user.role==='TRAINER'?'trainer_id':'trainee_id';
    const requestedTrainee=user.role==='TRAINER'?(url.searchParams.get('traineeId')||null):null;
    const result=await query(`SELECT id,template_id,trainer_id,trainee_id,template_snapshot,due_date,start_date,end_date,frequency,series_id,status,created_at FROM assigned_workouts WHERE deleted_at IS NULL AND ${ownerColumn}=$1 AND ($2::text IS NULL OR trainee_id=$2) AND ($3::timestamptz IS NULL OR (created_at, id) < ($3, $4)) ORDER BY created_at DESC, id DESC LIMIT $5`,[user.id,requestedTrainee,cursor?cursor[0]:null,cursor?cursor[1]:null,limit]);
    const visible=result.rows.map(row=>({id:row.id,templateId:row.template_id,trainerId:row.trainer_id,traineeId:row.trainee_id,templateSnapshot:row.template_snapshot,dueDate:row.due_date,startDate:row.start_date,endDate:row.end_date,frequency:row.frequency,seriesId:row.series_id,status:row.status,createdAt:row.created_at}));
    return json(res,200,{assignments:visible,nextCursor:nextCursorFor(result.rows,limit,row=>[row.created_at,row.id])});
  }
  const assignmentEdit=url.pathname.match(/^\/api\/assigned-workouts\/([A-Za-z0-9_-]{1,64})$/);
  if(req.method==='PATCH'&&assignmentEdit){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;const assignment=assignments.get(assignmentEdit[1]);if(!assignment||assignment.trainerId!==user.id)return json(res,404,{error:{code:'WORKOUT_NOT_FOUND',message:'Assigned workout not found.'}});const relationship=await findRelationship(user.id,assignment.traineeId);if(!relationship||relationship.status!=='ACTIVE')return json(res,403,{error:{code:'WORKOUT_EDIT_FORBIDDEN',message:'An active coaching relationship is required.'}});if(assignment.status!=='ASSIGNED')return json(res,409,{error:{code:'WORKOUT_LOCKED',message:'A workout cannot be edited after logging has started.'}});const body=await readJson(req,res);if(!body)return;const workout=normalizeWorkoutInput(body);if(!workout)return json(res,422,{error:{code:'WORKOUT_INVALID',message:'Add a valid name, date, and 1–30 exercises.'}});assignment.templateSnapshot={...assignment.templateSnapshot,name:workout.name,description:workout.description,exercises:workout.exercises,version:Number(assignment.templateSnapshot.version||1)+1};assignment.dueDate=workout.dueDate;await transaction(async tx=>{await tx('UPDATE assigned_workouts SET template_snapshot=$1,due_date=$2 WHERE id=$3 AND trainer_id=$4 AND status=\'ASSIGNED\'',[JSON.stringify(assignment.templateSnapshot),assignment.dueDate||null,assignment.id,user.id]);await tx("INSERT INTO notifications(id,recipient_id,event_type,title,body) VALUES($1,$2,'WORKOUT_UPDATED',$3,$4)",[id('notification'),assignment.traineeId,'Workout updated',assignment.templateSnapshot.name])});await audit(user.id,'ASSIGNED_WORKOUT_UPDATED','assigned_workout',assignment.id,{traineeId:assignment.traineeId,version:assignment.templateSnapshot.version});return json(res,200,{assignment});
  }
  if(req.method==='GET'&&url.pathname==='/api/invitations'){
    if(!requireRole(res,user,'TRAINER'))return;
    // A trainer needs to see what is outstanding to know whether to chase it or
    // cancel it. The token is never returned: it is a credential, and the one
    // copy that matters went to the invited address.
    const limit=pageLimit(url,50,200),cursor=decodeCursor(url.searchParams.get('cursor'),2);
    const result=await query('SELECT id,email,note,status,expires_at,created_at FROM invitations WHERE trainer_id=$1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3)) ORDER BY created_at DESC, id DESC LIMIT $4',[user.id,cursor?cursor[0]:null,cursor?cursor[1]:null,limit]);
    const now=Date.now();
    return json(res,200,{invitations:result.rows.map(row=>({id:row.id,email:row.email,note:row.note,status:row.status,expiresAt:row.expires_at,createdAt:row.created_at,live:row.status==='PENDING'&&new Date(row.expires_at).getTime()>now})),nextCursor:nextCursorFor(result.rows,limit,row=>[row.created_at,row.id])});
  }
  const invitationMatch=url.pathname.match(/^\/api\/invitations\/([A-Za-z0-9_-]{1,64})$/);
  if(req.method==='DELETE'&&invitationMatch){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;
    // Only a pending one can be withdrawn: revoking an already-accepted
    // invitation would imply ending a coaching relationship, which is a
    // different action with its own audit trail.
    const revoked=await query("UPDATE invitations SET status='REVOKED',updated_at=now() WHERE id=$1 AND trainer_id=$2 AND status='PENDING' RETURNING id,email",[invitationMatch[1],user.id]);
    if(!revoked.rowCount)return json(res,404,{error:{code:'INVITATION_NOT_FOUND',message:'No pending invitation with that id.'}});
    await audit(user.id,'INVITATION_REVOKED','invitation',invitationMatch[1]);
    return json(res,200,{revoked:true});
  }
  if(req.method==='POST'&&url.pathname==='/api/invitations'){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;if(!rateLimit(`invite:${user.id}`,10,3600000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many invitations. Try again later.'}});const body=await readJson(req,res);if(!body)return;const email=cleanEmail(body.email),note=typeof body.note==='string'?body.note.trim():'';
    if(!validEmail(email))return json(res,422,{error:{code:'EMAIL_INVALID',message:'Enter a valid email address.'}});if(note.length>500)return json(res,422,{error:{code:'NOTE_TOO_LONG',message:'Note must be 500 characters or fewer.'}});// Only a still-acceptable invitation blocks a new one. Without the expiry
    // check a lapsed invite locked that address out of this trainer for good.
    await query("UPDATE invitations SET status='EXPIRED' WHERE trainer_id=$1 AND email=$2 AND status='PENDING' AND expires_at < now()",[user.id,email]);
    const pendingInvite=await query("SELECT 1 FROM invitations WHERE trainer_id=$1 AND email=$2 AND status='PENDING' AND expires_at > now()",[user.id,email]);if([...invitations.values()].some(i=>i.email===email&&i.trainerId===user.id&&i.status==='PENDING'&&i.expiresAt>Date.now())||pendingInvite.rowCount)return json(res,409,{error:{code:'INVITE_EXISTS',message:'A pending invitation already exists.'}});
    const token=randomBytes(24).toString('base64url'),invite={id:id('inv'),token,email,note,status:'PENDING',trainerId:user.id,expiresAt:Date.now()+7*86400000,createdAt:new Date().toISOString()};await query('INSERT INTO invitations(id,trainer_id,email,token_hash,note,status,expires_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[invite.id,invite.trainerId,invite.email,tokenDigest(token),invite.note,invite.status,new Date(invite.expiresAt).toISOString(),invite.createdAt]);invitations.set(token,invite);const invitationDelivery=await sendEmail({to:email,...invitationEmail(user.name,`${APP_ORIGIN}/?invite=${token}`,note)},log);await audit(user.id,'INVITATION_CREATED','invitation',invite.id,{delivered:invitationDelivery.delivered});return json(res,201,{invitation:{id:invite.id,email,status:invite.status,inviteCode:token,expiresAt:new Date(invite.expiresAt).toISOString(),delivered:invitationDelivery.delivered}});
  }
  const accept=url.pathname.match(/^\/api\/invitations\/([A-Za-z0-9_-]{20,60})\/accept$/);
  if(req.method==='POST'&&accept){if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINEE'))return;let invite=invitations.get(accept[1]);if(!invite){const found=await query('SELECT id,trainer_id,email,status,expires_at FROM invitations WHERE token_hash=$1',[tokenDigest(accept[1])]);if(found.rowCount)invite={id:found.rows[0].id,trainerId:found.rows[0].trainer_id,email:found.rows[0].email,status:found.rows[0].status,expiresAt:new Date(found.rows[0].expires_at).getTime()}}if(!invite||invite.status!=='PENDING'||invite.expiresAt<Date.now()||invite.email!==user.email)return json(res,403,{error:{code:'INVITE_INVALID',message:'Invitation is invalid, expired, or belongs to another email.'}});const priorTrainer=(await relationshipsFor(user,'ACTIVE')).find(item=>item.trainerId!==invite.trainerId);if(priorTrainer)return json(res,409,{error:{code:'RELATIONSHIP_EXISTS',message:'You already have an active trainer. End that coaching relationship before accepting a new invitation.'}});const relationship={trainerId:invite.trainerId,traineeId:user.id,status:'ACTIVE',createdAt:new Date().toISOString()};await transaction(async tx=>{await tx("UPDATE invitations SET status='ACCEPTED' WHERE id=$1 AND status='PENDING'",[invite.id]);await tx("INSERT INTO trainer_trainee_relationships(trainer_id,trainee_id,status,created_at,updated_at) VALUES($1,$2,'ACTIVE',$3,$3) ON CONFLICT(trainer_id,trainee_id) DO UPDATE SET status='ACTIVE',updated_at=$3",[relationship.trainerId,relationship.traineeId,relationship.createdAt])});invite.status='ACCEPTED';await audit(user.id,'INVITATION_ACCEPTED','relationship',`${relationship.trainerId}:${relationship.traineeId}`);return json(res,200,{relationship:{status:'ACTIVE'}})}
  if(req.method==='GET'&&url.pathname==='/api/relationships'){
    const rows=await relationshipsFor(user);
    const people=await usersByIds(rows.flatMap(item=>[item.trainerId,item.traineeId]));
    const visible=rows.map(item=>({...item,trainer:publicUser(people.get(item.trainerId)),trainee:publicUser(people.get(item.traineeId))}));
    return json(res,200,{relationships:visible});
  }
  const relationshipStatus=url.pathname.match(/^\/api\/relationships\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9_-]{1,64})$/);
  if(req.method==='PATCH'&&relationshipStatus){
    if(!mutationAllowed(req,res,session))return;const [trainerId,traineeId]=relationshipStatus.slice(1),relationship=await findRelationship(trainerId,traineeId);if(!relationship||(user.id!==trainerId&&user.id!==traineeId))return json(res,404,{error:{code:'RELATIONSHIP_NOT_FOUND',message:'Coaching relationship not found.'}});const body=await readJson(req,res);if(!body)return;// Status and permissions are independent edits. Changing what a trainer may
    // see should not require restating the status, and restating the status it
    // already has is a no-op rather than an error.
    const nextStatus=body.status===undefined?relationship.status:String(body.status||'').toUpperCase();
    if(body.status!==undefined){
      if(!['ACTIVE','PAUSED','ARCHIVED','REVOKED'].includes(nextStatus))return json(res,422,{error:{code:'RELATIONSHIP_STATUS_INVALID',message:'Choose a valid relationship status.'}});
      if(nextStatus==='ACTIVE'&&!['PAUSED','ACTIVE'].includes(relationship.status))return json(res,409,{error:{code:'RELATIONSHIP_REACTIVATION_INVALID',message:'Only a paused relationship can be reactivated.'}});
    }const previousStatus=relationship.status;
    // Permissions are the trainee's to set: they describe access to the
    // trainee's own health data, so the trainer cannot widen their own reach.
    let nextPermissions=relationshipPermissions(relationship);
    if(body.permissions!==undefined){
      if(user.id!==traineeId)return json(res,403,{error:{code:'PERMISSIONS_TRAINEE_ONLY',message:'Only the trainee can change what a trainer may see or record.'}});
      const requested=normalizeRelationshipPermissions(body.permissions);
      if(!requested)return json(res,422,{error:{code:'PERMISSIONS_INVALID',message:'Permissions must be an object of true or false flags.'}});
      nextPermissions=requested;
    }
    relationship.status=nextStatus;relationship.permissions=nextPermissions;
    await query('UPDATE trainer_trainee_relationships SET status=$1,permissions=$2,updated_at=now() WHERE trainer_id=$3 AND trainee_id=$4',[nextStatus,JSON.stringify(nextPermissions),trainerId,traineeId]);
    await audit(user.id,'RELATIONSHIP_UPDATED','relationship',`${trainerId}:${traineeId}`,{previousStatus,status:nextStatus,permissions:nextPermissions});
    return json(res,200,{relationship});
  }
  const logMatch=url.pathname.match(/^\/api\/assigned-workouts\/([A-Za-z0-9_-]{1,64})\/logs$/);
  if(logMatch&&['GET','POST','PATCH'].includes(req.method)){
    if(req.method!=='GET'&&!mutationAllowed(req,res,session))return;
    const assignment=assignments.get(logMatch[1]);
    if(!await logAccess(user,assignment,req.method!=='GET'))return json(res,403,{error:{code:'WORKOUT_FORBIDDEN',message:'You cannot log this workout.'}});
    const exerciseCount=assignment.templateSnapshot.exercises.length;
    if(req.method==='GET'){
      // An unfinished draft is self-reported work in progress, so it stays with
      // its author until it is submitted. Finished logs are visible to both
      // parties, which is what lets a trainer review what was actually lifted.
      const stored=await query("SELECT id,author_id,status,completed_count,exercises,created_at,updated_at FROM workout_logs WHERE assigned_workout_id=$1 AND deleted_at IS NULL AND (status='FINAL' OR author_id=$2) ORDER BY created_at DESC LIMIT 50",[assignment.id,user.id]);
      const sets=await readSetRows(stored.rows.map(row=>row.id));
      return json(res,200,{assignment:{id:assignment.id,name:assignment.templateSnapshot.name,status:assignment.status,dueDate:assignment.dueDate,exercises:assignment.templateSnapshot.exercises},logs:stored.rows.map(row=>({id:row.id,authorId:row.author_id,status:row.status,completedCount:row.completed_count,exercises:row.exercises,sets:sets.get(row.id)||[],savedAt:row.created_at,updatedAt:row.updated_at}))});
    }
    const key=req.headers['idempotency-key'];
    if(req.method==='POST'){
      if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(key))return json(res,400,{error:{code:'IDEMPOTENCY_KEY_REQUIRED',message:'A valid idempotency key is required.'}});
      const cached=workoutSaves.get(`${user.id}:${key}`);if(cached)return json(res,200,cached);
      const storedLog=await query('SELECT id,assigned_workout_id,completed_count,created_at FROM workout_logs WHERE author_id=$1 AND idempotency_key=$2',[user.id,key]);
      if(storedLog.rowCount){const row=storedLog.rows[0];return json(res,200,{log:{id:row.id,assignedWorkoutId:row.assigned_workout_id,completedCount:row.completed_count,savedAt:row.created_at}})}
    }
    if(!rateLimit(`workout-log:${user.id}`,120,60000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many workout saves. Slow down.'}});
    const body=await readJson(req,res);if(!body)return;
    const sets=normalizeSetRows(body.sets,exerciseCount);
    if(sets===null)return json(res,422,{error:{code:'SET_LOG_INVALID',message:'A set is missing its unit or falls outside the allowed range.'}});
    if(req.method==='POST'&&!Array.isArray(body.exercises)&&!sets.length)return json(res,422,{error:{code:'WORKOUT_INVALID',message:'Workout exercise data is invalid.'}});
    const completion=exerciseCompletion(body,sets,exerciseCount);
    if(completion===null)return json(res,422,{error:{code:'WORKOUT_INVALID',message:'Workout exercise data is invalid.'}});
    const completedCount=completion.filter(Boolean).length,completionJson=JSON.stringify(completion.map(completed=>({completed}))),savedAt=new Date().toISOString();
    if(req.method==='PATCH'){
      // Resumable save: one draft per author per assignment, rewritten in place
      // so a phone that loses signal mid-workout picks up where it stopped.
      const draft=draftKey(assignment.id);
      const logId=await transaction(async tx=>{
        const existing=await tx('SELECT id FROM workout_logs WHERE author_id=$1 AND idempotency_key=$2',[user.id,draft]);
        const target=existing.rowCount?existing.rows[0].id:id('log');
        if(existing.rowCount)await tx('UPDATE workout_logs SET exercises=$1,completed_count=$2,updated_at=now() WHERE id=$3',[completionJson,completedCount,target]);
        else await tx("INSERT INTO workout_logs(id,assigned_workout_id,author_id,idempotency_key,exercises,completed_count,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$7)",[target,assignment.id,user.id,draft,completionJson,completedCount,savedAt]);
        await writeSetRows(tx,target,sets);
        if(assignment.status==='ASSIGNED')await tx("UPDATE assigned_workouts SET status='IN_PROGRESS',updated_at=now() WHERE id=$1",[assignment.id]);
        return target;
      });
      if(assignment.status==='ASSIGNED')assignment.status='IN_PROGRESS';
      return json(res,200,{draft:{id:logId,assignedWorkoutId:assignment.id,status:'DRAFT',completedCount,setCount:sets.length,savedAt}});
    }
    const logId=id('log'),nextStatus=completedCount===exerciseCount?'COMPLETED':'IN_PROGRESS';
    await transaction(async tx=>{
      // The draft and the submission are the same session, so finishing replaces
      // the draft instead of leaving a second copy of the workout behind.
      await tx('DELETE FROM workout_logs WHERE author_id=$1 AND idempotency_key=$2',[user.id,draftKey(assignment.id)]);
      await tx("INSERT INTO workout_logs(id,assigned_workout_id,author_id,idempotency_key,exercises,completed_count,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'FINAL',$7,$7)",[logId,assignment.id,user.id,key,completionJson,completedCount,savedAt]);
      await writeSetRows(tx,logId,sets);
      await tx('UPDATE assigned_workouts SET status=$1,updated_at=now() WHERE id=$2',[nextStatus,assignment.id]);
    });
    assignment.status=nextStatus;
    const result={log:{id:logId,assignedWorkoutId:assignment.id,completedCount,setCount:sets.length,savedAt}};
    await audit(user.id,'WORKOUT_LOGGED','workout_log',logId,{assignmentId:assignment.id,completedCount,setCount:sets.length});
    workoutSaves.set(`${user.id}:${key}`,result);
    return json(res,201,result);
  }
  if(req.method==='GET'&&url.pathname==='/api/progress-metrics')return json(res,200,{metrics:[...progressMetrics.values()]});
  if(req.method==='GET'&&url.pathname==='/api/progress-entries'){
    const traineeId=await accessibleTrainee(user,url.searchParams.get('traineeId'),'view_progress');
    if(!traineeId)return json(res,403,{error:{code:'PROGRESS_FORBIDDEN',message:'Progress access is not allowed.'}});
    const metric=(url.searchParams.get('metric')||'weight').slice(0,50);
    const limit=pageLimit(url,100,500),cursor=decodeCursor(url.searchParams.get('cursor'),2);
    const result=await query('SELECT id,metric_type,value::float,unit,value_normalized::float,normalized_unit,measured_at,note,author_id FROM progress_entries WHERE trainee_id=$1 AND metric_type=$2 AND deleted_at IS NULL AND ($3::timestamptz IS NULL OR (measured_at, id) > ($3, $4)) ORDER BY measured_at ASC, id ASC LIMIT $5',[traineeId,metric,cursor?cursor[0]:null,cursor?cursor[1]:null,limit]);
    // Charts read one comparable series while each row keeps the value and unit
    // the person actually entered.
    const preference=await query('SELECT preferred_units FROM user_profiles WHERE user_id=$1',[user.id]);
    const definition=progressMetrics.get(metric)||null;
    const displayUnit=definition?DISPLAY_UNIT[preference.rows[0]?.preferred_units||'METRIC'][definition.dimension]:null;
    const entries=result.rows.map(row=>({...row,can_manage:row.author_id===user.id,display_value:displayUnit?convertUnit(row.value_normalized,row.normalized_unit,displayUnit):row.value,display_unit:displayUnit||row.unit}));
    return json(res,200,{entries,metric:definition,displayUnit,nextCursor:nextCursorFor(result.rows,limit,row=>[row.measured_at,row.id])});
  }
  if(req.method==='POST'&&url.pathname==='/api/progress-entries'){
    if(!mutationAllowed(req,res,session))return;
    const body=await readJson(req,res);if(!body)return;
    const traineeId=await accessibleTrainee(user,body.traineeId,'log_on_behalf');
    if(!traineeId)return json(res,403,{error:{code:'PROGRESS_FORBIDDEN',message:'Progress access is not allowed.'}});
    if(!rateLimit(`progress:${user.id}`,60,60000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many progress entries. Slow down.'}});
    const entry=normalizeProgressEntry(body,progressMetrics);
    if(!entry)return json(res,422,{error:{code:'PROGRESS_INVALID',message:'Progress value, metric, date, or unit is invalid.'}});
    const entryId=id('progress');
    await query('INSERT INTO progress_entries(id,trainee_id,author_id,metric_type,value,unit,value_normalized,normalized_unit,measured_at,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[entryId,traineeId,user.id,entry.metricType,entry.value,entry.unit,entry.normalizedValue,entry.normalizedUnit,entry.measuredAt,entry.note]);
    await audit(user.id,'PROGRESS_ENTRY_CREATED','progress_entry',entryId,{traineeId,metricType:entry.metricType});
    return json(res,201,{entry:{id:entryId,metric_type:entry.metricType,value:entry.value,unit:entry.unit,value_normalized:entry.normalizedValue,normalized_unit:entry.normalizedUnit,measured_at:entry.measuredAt,note:entry.note,author_id:user.id,can_manage:true}});
  }
  const progressEntryMatch=url.pathname.match(/^\/api\/progress-entries\/([A-Za-z0-9_-]{1,64})$/);
  if(progressEntryMatch&&['PATCH','DELETE'].includes(req.method)){
    if(!mutationAllowed(req,res,session))return;
    const body=await readJson(req,res);if(!body)return;
    const traineeId=await accessibleTrainee(user,body.traineeId,'view_progress');
    if(!traineeId)return json(res,403,{error:{code:'PROGRESS_FORBIDDEN',message:'Progress access is not allowed.'}});
    const existing=await query('SELECT id,author_id FROM progress_entries WHERE id=$1 AND trainee_id=$2 AND deleted_at IS NULL',[progressEntryMatch[1],traineeId]);
    if(!existing.rowCount)return json(res,404,{error:{code:'PROGRESS_NOT_FOUND',message:'Progress entry not found.'}});
    // Whoever recorded a measurement is the one who can correct or withdraw it,
    // the same rule the nutrition journal follows.
    if(existing.rows[0].author_id!==user.id)return json(res,403,{error:{code:'PROGRESS_AUTHOR_REQUIRED',message:'Only the entry author can change or delete it.'}});
    if(req.method==='DELETE'){
      await query('UPDATE progress_entries SET deleted_at=now(),updated_at=now() WHERE id=$1',[progressEntryMatch[1]]);
      await audit(user.id,'PROGRESS_ENTRY_DELETED','progress_entry',progressEntryMatch[1],{traineeId});
      return json(res,200,{deleted:true});
    }
    const entry=normalizeProgressEntry(body,progressMetrics);
    if(!entry)return json(res,422,{error:{code:'PROGRESS_INVALID',message:'Progress value, metric, date, or unit is invalid.'}});
    const updated=await query('UPDATE progress_entries SET metric_type=$1,value=$2,unit=$3,value_normalized=$4,normalized_unit=$5,measured_at=$6,note=$7,updated_at=now() WHERE id=$8 RETURNING id,metric_type,value::float,unit,value_normalized::float,normalized_unit,measured_at,note,author_id',[entry.metricType,entry.value,entry.unit,entry.normalizedValue,entry.normalizedUnit,entry.measuredAt,entry.note,progressEntryMatch[1]]);
    await audit(user.id,'PROGRESS_ENTRY_UPDATED','progress_entry',progressEntryMatch[1],{traineeId});
    return json(res,200,{entry:{...updated.rows[0],can_manage:true}});
  }
  if(req.method==='GET'&&url.pathname==='/api/nutrition-entries'){
    const traineeId=await accessibleTrainee(user,url.searchParams.get('traineeId'),'view_nutrition');if(!traineeId)return json(res,403,{error:{code:'NUTRITION_FORBIDDEN',message:'Nutrition access is not allowed.'}});const selectedDate=url.searchParams.get('date');if(selectedDate&&!validDateOnly(selectedDate))return json(res,422,{error:{code:'NUTRITION_DATE_INVALID',message:'Choose a valid journal date.'}});const limit=pageLimit(url,120,500),cursor=decodeCursor(url.searchParams.get('cursor'),3);const params=[traineeId,selectedDate||null,cursor?cursor[0]:null,cursor?cursor[1]:null,cursor?cursor[2]:null,limit];const [result,target]=await Promise.all([query(`SELECT n.id,n.author_id,u.name AS author_name,n.entry_date,n.entry_type,n.description,n.calories,n.protein_g::float,n.carbs_g::float,n.fat_g::float,n.water_ml,n.food_barcode,n.food_name,n.food_brand,n.food_quantity_g::float,n.data_source,n.created_at,n.updated_at FROM nutrition_entries n JOIN users u ON u.id=n.author_id WHERE n.trainee_id=$1 AND ($2::date IS NULL OR n.entry_date=$2) AND ($3::date IS NULL OR (n.entry_date, n.created_at, n.id) < ($3, $4, $5)) ORDER BY n.entry_date DESC,n.created_at DESC,n.id DESC LIMIT $6`,params),query('SELECT calories,protein_g::float,carbs_g::float,fat_g::float,water_ml,author_id,updated_at FROM nutrition_targets WHERE trainee_id=$1',[traineeId])]);const entries=result.rows.map(entry=>({...entry,can_manage:entry.author_id===user.id}));return json(res,200,{entries,target:target.rows[0]||null,nextCursor:nextCursorFor(result.rows,limit,row=>[row.entry_date,row.created_at,row.id])})
  }
  if(req.method==='POST'&&url.pathname==='/api/nutrition-entries'){
    if(!mutationAllowed(req,res,session))return;const body=await readJson(req,res);if(!body)return;const traineeId=await accessibleTrainee(user,body.traineeId,'log_on_behalf');if(!traineeId)return json(res,403,{error:{code:'NUTRITION_FORBIDDEN',message:'Nutrition access is not allowed.'}});if(!rateLimit(`nutrition:${user.id}`,120,60000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many nutrition entries. Slow down.'}});const normalized=normalizeNutritionEntry(body);if(!normalized)return json(res,422,{error:{code:'NUTRITION_INVALID',message:'Add a valid date, meal type, description, or nutrition value.'}});const entryId=id('nutrition');await query('INSERT INTO nutrition_entries(id,trainee_id,author_id,entry_date,entry_type,description,calories,protein_g,carbs_g,fat_g,water_ml,food_barcode,food_name,food_brand,food_quantity_g,data_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',[entryId,traineeId,user.id,normalized.entryDate,normalized.entryType,normalized.description,normalized.calories,normalized.proteinG,normalized.carbsG,normalized.fatG,normalized.waterMl,normalized.foodBarcode,normalized.foodName,normalized.foodBrand,normalized.foodQuantityG,normalized.dataSource]);await audit(user.id,'NUTRITION_ENTRY_CREATED','nutrition_entry',entryId,{traineeId,foodBarcode:normalized.foodBarcode});return json(res,201,{entry:{id:entryId,...normalized,authorId:user.id,canManage:true}})
  }
  const nutritionEntryMatch=url.pathname.match(/^\/api\/nutrition-entries\/([A-Za-z0-9_-]{1,64})$/);
  if(['PATCH','DELETE'].includes(req.method)&&nutritionEntryMatch){
    if(!mutationAllowed(req,res,session))return;const body=await readJson(req,res);if(!body)return;const traineeId=await accessibleTrainee(user,body.traineeId,'view_nutrition');if(!traineeId)return json(res,403,{error:{code:'NUTRITION_FORBIDDEN',message:'Nutrition access is not allowed.'}});const existing=await query('SELECT id,author_id FROM nutrition_entries WHERE id=$1 AND trainee_id=$2',[nutritionEntryMatch[1],traineeId]);if(!existing.rowCount)return json(res,404,{error:{code:'NUTRITION_NOT_FOUND',message:'Nutrition entry not found.'}});if(existing.rows[0].author_id!==user.id)return json(res,403,{error:{code:'NUTRITION_AUTHOR_REQUIRED',message:'Only the entry author can change or delete it.'}});if(req.method==='DELETE'){await query('DELETE FROM nutrition_entries WHERE id=$1',[nutritionEntryMatch[1]]);await audit(user.id,'NUTRITION_ENTRY_DELETED','nutrition_entry',nutritionEntryMatch[1],{traineeId});return json(res,200,{deleted:true})}const normalized=normalizeNutritionEntry(body);if(!normalized)return json(res,422,{error:{code:'NUTRITION_INVALID',message:'Add a valid date, meal type, description, or nutrition value.'}});const updated=await query('UPDATE nutrition_entries SET entry_date=$1,entry_type=$2,description=$3,calories=$4,protein_g=$5,carbs_g=$6,fat_g=$7,water_ml=$8,food_barcode=$9,food_name=$10,food_brand=$11,food_quantity_g=$12,data_source=$13,updated_at=now() WHERE id=$14 RETURNING id,entry_date,entry_type,description,calories,protein_g::float,carbs_g::float,fat_g::float,water_ml,food_barcode,food_name,food_brand,food_quantity_g::float,data_source,updated_at',[normalized.entryDate,normalized.entryType,normalized.description,normalized.calories,normalized.proteinG,normalized.carbsG,normalized.fatG,normalized.waterMl,normalized.foodBarcode,normalized.foodName,normalized.foodBrand,normalized.foodQuantityG,normalized.dataSource,nutritionEntryMatch[1]]);await audit(user.id,'NUTRITION_ENTRY_UPDATED','nutrition_entry',nutritionEntryMatch[1],{traineeId,foodBarcode:normalized.foodBarcode});return json(res,200,{entry:updated.rows[0]})
  }
  if(req.method==='PATCH'&&url.pathname==='/api/nutrition-target'){
    if(!mutationAllowed(req,res,session))return;const body=await readJson(req,res);if(!body)return;const traineeId=await accessibleTrainee(user,body.traineeId);if(!traineeId)return json(res,403,{error:{code:'NUTRITION_FORBIDDEN',message:'Nutrition access is not allowed.'}});const values=nutritionValues(body);if(!values||Object.values(values).every(value=>value===null))return json(res,422,{error:{code:'NUTRITION_TARGET_INVALID',message:'Add at least one valid daily target.'}});const targetId=traineeId;const result=await query('INSERT INTO nutrition_targets(trainee_id,author_id,calories,protein_g,carbs_g,fat_g,water_ml) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(trainee_id) DO UPDATE SET author_id=$2,calories=$3,protein_g=$4,carbs_g=$5,fat_g=$6,water_ml=$7,updated_at=now() RETURNING calories,protein_g::float,carbs_g::float,fat_g::float,water_ml,author_id,updated_at',[targetId,user.id,values.calories,values.proteinG,values.carbsG,values.fatG,values.waterMl]);await audit(user.id,'NUTRITION_TARGET_UPDATED','nutrition_target',traineeId);return json(res,200,{target:result.rows[0]})
  }
  if(req.method==='GET'&&url.pathname==='/api/notifications'){const limit=pageLimit(url,50,200),cursor=decodeCursor(url.searchParams.get('cursor'),2);const [result,unread]=await Promise.all([query('SELECT id,event_type,title,body,read_at,created_at FROM notifications WHERE recipient_id=$1 AND ($2::timestamptz IS NULL OR (created_at, id) < ($2, $3)) ORDER BY created_at DESC, id DESC LIMIT $4',[user.id,cursor?cursor[0]:null,cursor?cursor[1]:null,limit]),query('SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1 AND read_at IS NULL',[user.id])]);return json(res,200,{notifications:result.rows,unreadCount:Number(unread.rows[0].count),nextCursor:nextCursorFor(result.rows,limit,row=>[row.created_at,row.id])})}
  const notificationRead=url.pathname.match(/^\/api\/notifications\/([A-Za-z0-9_-]{1,64})\/read$/);if(req.method==='POST'&&notificationRead){if(!mutationAllowed(req,res,session))return;const updated=await query('UPDATE notifications SET read_at=now() WHERE id=$1 AND recipient_id=$2 RETURNING id,read_at',[notificationRead[1],user.id]);if(!updated.rowCount)return json(res,404,{error:{code:'NOT_FOUND',message:'Notification not found.'}});return json(res,200,{notification:updated.rows[0]})}
  if(req.method==='GET'&&url.pathname==='/api/messages'){const relationship=await activeRelationship(user,url.searchParams.get('traineeId'));if(!relationship)return json(res,200,{messages:[],relationship:null});const limit=pageLimit(url,200,500),cursor=decodeCursor(url.searchParams.get('cursor'),2);const result=await query('SELECT m.id,m.sender_id,u.name AS sender_name,m.body,m.read_at,m.created_at FROM messages m JOIN users u ON u.id=m.sender_id WHERE m.relationship_trainer_id=$1 AND m.relationship_trainee_id=$2 AND ($3::timestamptz IS NULL OR (m.created_at, m.id) > ($3, $4)) ORDER BY m.created_at ASC, m.id ASC LIMIT $5',[relationship.trainerId,relationship.traineeId,cursor?cursor[0]:null,cursor?cursor[1]:null,limit]);return json(res,200,{messages:result.rows,relationship,nextCursor:nextCursorFor(result.rows,limit,row=>[row.created_at,row.id])})}
  if(req.method==='POST'&&url.pathname==='/api/messages'){if(!mutationAllowed(req,res,session))return;const body=await readJson(req,res);if(!body)return;const relationship=await activeRelationship(user,body.traineeId);if(!relationship)return json(res,403,{error:{code:'MESSAGE_FORBIDDEN',message:'An active coaching relationship is required.'}});const messageBody=String(body.body||'').trim();if(messageBody.length<1||messageBody.length>2000)return json(res,422,{error:{code:'MESSAGE_INVALID',message:'Message must be 1–2000 characters.'}});if(!rateLimit(`message:${user.id}`,30,60000))return json(res,429,{error:{code:'RATE_LIMITED',message:'Too many messages. Slow down.'}});const message={id:id('message'),sender_id:user.id,sender_name:user.name,body:messageBody,created_at:new Date().toISOString(),read_at:null};await query('INSERT INTO messages(id,relationship_trainer_id,relationship_trainee_id,sender_id,body,created_at) VALUES($1,$2,$3,$4,$5,$6)',[message.id,relationship.trainerId,relationship.traineeId,user.id,message.body,message.created_at]);const recipientId=user.id===relationship.trainerId?relationship.traineeId:relationship.trainerId;await query("INSERT INTO notifications(id,recipient_id,event_type,title,body) VALUES($1,$2,'NEW_MESSAGE',$3,$4)",[id('notification'),recipientId,`New message from ${user.name}`,message.body.slice(0,140)]);return json(res,201,{message})}
  if(req.method==='GET'&&url.pathname==='/api/subscription'){const result=await query('SELECT id,plan_code,status,provider,current_period_end FROM subscriptions WHERE user_id=$1',[user.id]);return json(res,200,{subscription:result.rows[0]||{plan_code:'STARTER',status:'TRIALING',provider:'TEST'}})}
  if(req.method==='POST'&&url.pathname==='/api/billing/test-checkout'){if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;const body=await readJson(req,res);if(!body)return;const plan=String(body.planCode||'');if(!['PRO','TEAM'].includes(plan))return json(res,422,{error:{code:'PLAN_INVALID',message:'Choose a valid paid plan.'}});const subscription={id:id('subscription'),plan_code:plan,status:'ACTIVE',provider:'TEST',current_period_end:new Date(Date.now()+30*86400000).toISOString()};await query("INSERT INTO subscriptions(id,user_id,plan_code,status,provider,current_period_end) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET plan_code=$3,status=$4,provider=$5,current_period_end=$6,updated_at=now()",[subscription.id,user.id,subscription.plan_code,subscription.status,subscription.provider,subscription.current_period_end]);return json(res,201,{subscription,mode:'TEST',message:'No payment was charged.'})}
  if(url.pathname==='/api/trainer-notes'&&['GET','POST'].includes(req.method)){
    if(req.method==='POST'&&!mutationAllowed(req,res,session))return;
    if(req.method==='GET'){
      // A trainer reads their own notes about a connected trainee. A trainee
      // reads only what was deliberately shared with them - a private coaching
      // note is not theirs to see just because it is about them.
      if(user.role==='TRAINEE'){
        const shared=await query("SELECT id,trainer_id,body,visibility,created_at,updated_at FROM trainer_notes WHERE trainee_id=$1 AND visibility='SHARED' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",[user.id]);
        const authors=await usersByIds(shared.rows.map(row=>row.trainer_id));
        return json(res,200,{notes:shared.rows.map(row=>({...row,author:publicUser(authors.get(row.trainer_id)),can_manage:false}))});
      }
      const traineeId=await accessibleTrainee(user,url.searchParams.get('traineeId'));
      if(!traineeId)return json(res,403,{error:{code:'NOTE_FORBIDDEN',message:'Coaching note access is not allowed.'}});
      const owned=await query('SELECT id,trainer_id,body,visibility,created_at,updated_at FROM trainer_notes WHERE trainer_id=$1 AND trainee_id=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',[user.id,traineeId]);
      return json(res,200,{notes:owned.rows.map(row=>({...row,author:publicUser(user),can_manage:true}))});
    }
    if(!requireRole(res,user,'TRAINER'))return;
    const body=await readJson(req,res);if(!body)return;
    const traineeId=await accessibleTrainee(user,body.traineeId);
    if(!traineeId)return json(res,403,{error:{code:'NOTE_FORBIDDEN',message:'Coaching note access is not allowed.'}});
    const note=normalizeTrainerNote(body);
    if(!note)return json(res,422,{error:{code:'NOTE_INVALID',message:'A note needs 1-2000 characters and a valid visibility.'}});
    const noteId=id('note');
    await query('INSERT INTO trainer_notes(id,trainer_id,trainee_id,body,visibility) VALUES($1,$2,$3,$4,$5)',[noteId,user.id,traineeId,note.body,note.visibility]);
    if(note.visibility==='SHARED')await query("INSERT INTO notifications(id,recipient_id,event_type,title,body) VALUES($1,$2,'NOTE_SHARED',$3,$4)",[id('notification'),traineeId,`New note from ${user.name}`,note.body.slice(0,140)]);
    await audit(user.id,'TRAINER_NOTE_CREATED','trainer_note',noteId,{traineeId,visibility:note.visibility});
    return json(res,201,{note:{id:noteId,trainer_id:user.id,body:note.body,visibility:note.visibility,author:publicUser(user),can_manage:true}});
  }
  const noteMatch=url.pathname.match(/^\/api\/trainer-notes\/([A-Za-z0-9_-]{1,64})$/);
  if(noteMatch&&['PATCH','DELETE'].includes(req.method)){
    if(!mutationAllowed(req,res,session)||!requireRole(res,user,'TRAINER'))return;
    const existing=await query('SELECT id,trainee_id,visibility FROM trainer_notes WHERE id=$1 AND trainer_id=$2 AND deleted_at IS NULL',[noteMatch[1],user.id]);
    if(!existing.rowCount)return json(res,404,{error:{code:'NOTE_NOT_FOUND',message:'Coaching note not found.'}});
    if(req.method==='DELETE'){
      await query('UPDATE trainer_notes SET deleted_at=now(),updated_at=now() WHERE id=$1',[noteMatch[1]]);
      await audit(user.id,'TRAINER_NOTE_DELETED','trainer_note',noteMatch[1],{traineeId:existing.rows[0].trainee_id});
      return json(res,200,{deleted:true});
    }
    const body=await readJson(req,res);if(!body)return;
    const note=normalizeTrainerNote(body);
    if(!note)return json(res,422,{error:{code:'NOTE_INVALID',message:'A note needs 1-2000 characters and a valid visibility.'}});
    const updated=await query('UPDATE trainer_notes SET body=$1,visibility=$2,updated_at=now() WHERE id=$3 RETURNING id,trainer_id,body,visibility,created_at,updated_at',[note.body,note.visibility,noteMatch[1]]);
    await audit(user.id,'TRAINER_NOTE_UPDATED','trainer_note',noteMatch[1],{traineeId:existing.rows[0].trainee_id,visibility:note.visibility});
    return json(res,200,{note:{...updated.rows[0],author:publicUser(user),can_manage:true}});
  }
  // Test-only hooks. Expiry and retention are time-based, and a test cannot wait
  // seven days or six hours to watch them work. They are unreachable in
  // production - the whole block is skipped, so the paths 404 exactly as if they
  // had never been written - and they still require a signed-in session, so the
  // unauthenticated exposure probe covers them like any other route.
  if(!IS_PRODUCTION&&url.pathname.startsWith('/api/test/')){
    if(req.method==='POST'&&url.pathname==='/api/test/expire-invitation'){
      if(!mutationAllowed(req,res,session))return;
      const body=await readJson(req,res);if(!body)return;
      const updated=await query("UPDATE invitations SET expires_at=now() - interval '1 day' WHERE id=$1 AND trainer_id=$2 RETURNING id",[String(body.invitationId||''),user.id]);
      if(!updated.rowCount)return json(res,404,{error:{code:'NOT_FOUND',message:'Invitation not found.'}});
      const cached=[...invitations.values()].find(item=>item.id===updated.rows[0].id);
      if(cached)cached.expiresAt=Date.now()-86400000;
      return json(res,200,{expired:true});
    }
    if(req.method==='POST'&&url.pathname==='/api/test/retention-sweep'){
      if(!mutationAllowed(req,res,session))return;
      return json(res,200,{summary:await runRetentionSweep(query,log)});
    }
    if(req.method==='GET'&&url.pathname==='/api/test/health-data-count'){
      const targetEmail=cleanEmail(url.searchParams.get('email'));
      const targetId=(await findUserByEmail(targetEmail))?.id||String(url.searchParams.get('userId')||'');
      const [progress,nutrition,logs,sets,notes]=await Promise.all([
        query('SELECT count(*)::int AS count FROM progress_entries WHERE trainee_id=$1 OR author_id=$1',[targetId]),
        query('SELECT count(*)::int AS count FROM nutrition_entries WHERE trainee_id=$1 OR author_id=$1',[targetId]),
        query('SELECT count(*)::int AS count FROM workout_logs WHERE author_id=$1',[targetId]),
        query('SELECT count(*)::int AS count FROM set_logs s JOIN workout_logs l ON l.id=s.workout_log_id WHERE l.author_id=$1',[targetId]),
        query('SELECT count(*)::int AS count FROM trainer_notes WHERE trainer_id=$1 OR trainee_id=$1',[targetId])
      ]);
      return json(res,200,{progressEntries:progress.rows[0].count,nutritionEntries:nutrition.rows[0].count,workoutLogs:logs.rows[0].count,setLogs:sets.rows[0].count,trainerNotes:notes.rows[0].count});
    }
    return json(res,404,{error:{code:'NOT_FOUND',message:'Resource not found.'}});
  }
  return json(res,404,{error:{code:'NOT_FOUND',message:'Resource not found.'}});
}

async function serveStatic(req,res,url){const requested=url.pathname==='/'?'index.html':decodeURIComponent(url.pathname.slice(1));const safe=normalize(requested).replace(/^(\.\.(\/|\\|$))+/,'');const path=join(ROOT,safe);if(!path.startsWith(ROOT))return json(res,403,{error:{code:'FORBIDDEN',message:'Invalid path.'}});try{const info=await stat(path);if(!info.isFile())throw new Error('not file');const body=await readFile(path),etag=`"${createHash('sha256').update(body).digest('base64url').slice(0,20)}"`,cacheControl=extname(path)==='.html'?'no-store':'public, max-age=300, must-revalidate';securityHeaders(res,{cacheControl});res.setHeader('ETag',etag);res.setHeader('Content-Type',types[extname(path)]||'application/octet-stream');if(req.headers['if-none-match']===etag){res.statusCode=304;return res.end()}res.statusCode=200;res.setHeader('Content-Length',body.length);if(req.method==='HEAD')return res.end();res.end(body)}catch{return json(res,404,{error:{code:'NOT_FOUND',message:'Page not found.'}})}}
const server=http.createServer(async(req,res)=>{const started=performance.now(),requestId=typeof req.headers['x-request-id']==='string'&&/^[A-Za-z0-9_-]{1,64}$/.test(req.headers['x-request-id'])?req.headers['x-request-id']:id('req');res.setHeader('X-Request-ID',requestId);res.once('finish',()=>{const durationMs=performance.now()-started;telemetry.requests+=1;telemetry.totalDurationMs+=durationMs;telemetry.byStatus.set(res.statusCode,(telemetry.byStatus.get(res.statusCode)||0)+1);if(res.statusCode>=500)telemetry.errors+=1;if(!['/healthz','/readyz','/metrics'].includes(req.url?.split('?')[0]))log(res.statusCode>=500?'error':'info','http_request',{requestId,method:req.method,route:routeLabel(req.url?.split('?')[0]),status:res.statusCode,durationMs:Number(durationMs.toFixed(2))})});try{if(!['GET','HEAD','POST','PATCH','DELETE'].includes(req.method)){res.setHeader('Allow','GET, HEAD, POST, PATCH, DELETE');return json(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Method not allowed.'}})}const url=new URL(req.url,APP_ORIGIN);if(req.method==='GET'&&url.pathname==='/healthz')return json(res,200,{status:'ok',uptimeSeconds:Math.round((Date.now()-telemetry.startedAt)/1000)});if(req.method==='GET'&&url.pathname==='/readyz'){const result=await query('SELECT 1 AS healthy');return json(res,200,{status:'ready',database:databaseMode(),healthy:result.rows[0]?.healthy===1})}if(req.method==='GET'&&url.pathname==='/metrics'){if(!metricsAllowed(req))return json(res,404,{error:{code:'NOT_FOUND',message:'Resource not found.'}});return textResponse(res,200,metricsPayload(),'text/plain; version=0.0.4; charset=utf-8')}if(url.pathname.startsWith('/api/'))return await api(req,res,url);if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:{code:'METHOD_NOT_ALLOWED',message:'Method not allowed.'}});return await serveStatic(req,res,url)}catch(error){log('error','request_error',{requestId,message:error.message,method:req.method,route:routeLabel(req.url?.split('?')[0])});if(!res.headersSent)json(res,500,{error:{code:'INTERNAL_ERROR',message:'Something went wrong.',requestId}});else res.end()}});
server.listen(PORT,HOST,()=>log('info','server_started',{url:`http://${HOST}:${PORT}`,database:databaseMode(),errorReporting:errorReportingEnabled()?'enabled':'stdout only'}));
const stopRetentionSweeps=startRetentionSweeps(query,log);
// The bounded caches evict on access and when they hit their cap. This keeps a
// quiet process from holding entries nobody will ask for again.
const boundedCaches=[sessions,workoutSaves,rateBuckets,passwordResets,foodProductCache,foodSearchCache];
const cachePruneTimer=setInterval(()=>{for(const cache of boundedCaches)cache.prune()},15*60*1000);
cachePruneTimer.unref();
let shuttingDown=false;async function shutdown(signal){if(shuttingDown)return;shuttingDown=true;log('info','server_shutdown_started',{signal});stopRetentionSweeps();clearInterval(cachePruneTimer);server.close(async()=>{await closeDatabase();log('info','server_shutdown_complete');process.exit(0)});setTimeout(()=>process.exit(1),10000).unref()}
process.on('SIGINT',()=>shutdown('SIGINT'));process.on('SIGTERM',()=>shutdown('SIGTERM'));
// Anything that escapes the request handler and the shutdown path lands here.
// Reported, then allowed to take the process down: a server in an unknown state
// should be restarted by the supervisor, not kept limping.
process.on('uncaughtException',error=>{log('error','uncaught_exception',{errorName:error.name,message:error.message});setTimeout(()=>process.exit(1),250).unref()});
process.on('unhandledRejection',reason=>{log('error','unhandled_rejection',{errorName:reason?.name||'UnknownError',message:String(reason?.message||reason).slice(0,200)})});
