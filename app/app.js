const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

/* CSP (style-src 'self') blocks inline style attributes, so data-driven bar
   sizes ride on data-w / data-h and are applied through CSSOM instead. */
function applyBarSizes(root = document) {
  for (const el of root.querySelectorAll('[data-w]')) el.style.width = el.dataset.w + '%';
  for (const el of root.querySelectorAll('[data-h]')) el.style.height = el.dataset.h + '%';
}
new MutationObserver(records => {
  for (const r of records) {
    for (const n of r.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.dataset && (n.dataset.w !== undefined || n.dataset.h !== undefined)) applyBarSizes(n.parentNode || document);
      else if (n.querySelector && n.querySelector('[data-w],[data-h]')) applyBarSizes(n);
    }
  }
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => applyBarSizes());

const state = { csrfToken:'', user:null, trainerClients:[], selectedTraineeId:null, activeAssignmentId:'assigned_demo_1', currentAssignment:null, exercises:[], workoutTemplates:[], exerciseCatalog:null, nutritionEntries:[], selectedFood:null, autoFilled:null, calendarMonth:null, calendarSelectedDate:null, calendarDays:new Map(), workoutFocusDate:null };
const views=$$('.page'), navItems=$$('.nav-item[data-view]'), sidebar=$('.sidebar'), toast=$('#toast');

const THEME_KEY='ptrainer-theme';
function storedTheme(){try{return localStorage.getItem(THEME_KEY)==='light'?'light':'dark'}catch{return'dark'}}
function applyTheme(theme,announce=false){const next=theme==='light'?'light':'dark',dark=next==='dark';document.documentElement.dataset.theme=next;document.querySelector('meta[name="theme-color"]').content=dark?'#000607':'#eef7f8';const toggle=$('#themeToggle');if(toggle){toggle.setAttribute('aria-checked',String(dark));toggle.setAttribute('aria-label',`Switch to ${dark?'light':'dark'} theme`);$('#themeLabel').textContent=dark?'Dark theme':'Light theme';$('#themeDescription').textContent=dark?'Cool blue-green on near-black':'Bright and clean';$('.theme-switch-icon').textContent=dark?'☾':'☀'}if(announce)showToast(`${dark?'Dark':'Light'} theme enabled`)}
applyTheme(storedTheme());

function showToast(message,duration=3200){toast.textContent=message;toast.classList.add('show');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>toast.classList.remove('show'),duration)}
function setBusy(button,busy,label='Working…'){if(!button)return;button.disabled=busy;if(busy){button.dataset.label=button.textContent;button.textContent=label}else button.textContent=button.dataset.label||button.textContent}
function switchView(name){
// A trainer's Workouts is the library they build and assign from; reviewing a
// client's sessions happens on that client's own page.
if(name==='workouts'&&state.user?.role==='TRAINER')name='builder';
const navName=name==='client'?'clients':name;
views.forEach(view=>view.classList.toggle('active-view',view.id===`${name}-view`));navItems.forEach(item=>item.classList.toggle('active',item.dataset.view===navName));sidebar.classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});if(name==='clients')loadInvitations();if(name==='client'){loadClientPage();loadNotes()}if(name==='builder'&&state.user?.role==='TRAINER'){loadTemplates();loadOwnExercises()}if(name==='workouts')loadAssignments();if(name==='calendar')loadCalendar();if(name==='progress')loadProgress();if(name==='nutrition')loadNutrition();if(name==='messages')loadMessages();if(name==='billing')loadSubscription();if(name==='settings')loadSettings()}
async function api(path,options={}){const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.method&&options.method!=='GET'?{'X-CSRF-Token':state.csrfToken}:{}),...options.headers}});const data=await response.json().catch(()=>({error:{message:'Unexpected server response.'}}));if(!response.ok){const error=new Error(data.error?.message||'Request failed.');error.code=data.error?.code;throw error}return data}
function initials(name){return name.split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase()}
// A bare YYYY-MM-DD is a calendar day, not an instant: read as one (like the
// calendar does) so it never shows a day early west of Greenwich.
function formatDate(value){if(!value)return 'Unscheduled';const date=/^\d{4}-\d{2}-\d{2}$/.test(String(value))?calendarDate(value):new Date(value);return Number.isNaN(date.getTime())?'Unscheduled':date.toLocaleDateString(undefined,{month:'short',day:'numeric'})}

function showAuth(){state.user=null;$('#appShell').hidden=true;$('#authScreen').hidden=false;document.body.classList.remove('role-trainer','role-trainee')}
async function showApp(user){state.user=user;$('#authScreen').hidden=true;$('#appShell').hidden=false;document.body.classList.toggle('role-trainer',user.role==='TRAINER');document.body.classList.toggle('role-trainee',user.role==='TRAINEE');$('#profileName').textContent=user.name;$('#profileRole').textContent=user.role==='TRAINER'?'Trainer':'Trainee';$('.profile-mini .avatar').textContent=initials(user.name);switchView('dashboard');renderVerificationBanner();await Promise.all([loadDashboard(),loadAssignments(),loadNotifications(),loadOwnExercises()]);await loadNotes()}

// Account mail now links back into the app, so the app has to answer those
// links. Without this the verification, reset, and invitation emails all land
// on a page that quietly ignores the token they carry.
async function handleLinkTokens(){
  const params=new URLSearchParams(location.search);
  const verify=params.get('verify'),reset=params.get('reset'),invite=params.get('invite');
  if(!verify&&!reset&&!invite)return;
  // The token is spent or stored the moment it is read; leaving it in the address
  // bar would put it into history and every future Referer.
  history.replaceState(null,'',location.pathname);
  if(verify){
    try{const result=await api('/api/auth/verify-email',{method:'POST',body:JSON.stringify({token:verify})});if(state.user&&result.user?.id===state.user.id)state.user=result.user;showToast('Email address confirmed.')}
    catch(error){showToast(error.message)}
    renderVerificationBanner();
  }
  if(reset){showAuthPanel('forgot');$('#forgotPasswordForm input[name="token"]').value=reset;$('#resetError').textContent='Enter a new password to finish resetting.'}
  if(invite){
    const field=$('#acceptInviteForm input[name="code"]');
    if(field)field.value=invite;
    if(state.user?.role==='TRAINEE')$('#acceptInviteForm').requestSubmit();
    else showToast('Sign in as the invited trainee to accept.');
  }
}
// Mail is non-critical, so the server answers even when the provider refused
// the message. Saying "sent" in that case would leave someone waiting on an
// email that is never coming.
function verificationMessage(outcome,sent){
  if(!outcome)return sent;
  if(outcome.delivered===false)return 'The confirmation email could not be sent right now. Try again in a few minutes.';
  if(outcome.transport==='log')return 'Email is not set up on this server yet, so the confirmation link was printed to the server log instead of sent.';
  return sent;
}
function renderVerificationBanner(){
  const banner=$('#verifyBanner');
  banner.hidden=!state.user||state.user.emailVerified!==false;
}
$('#resendVerification').addEventListener('click',async event=>{
  const button=event.currentTarget;setBusy(button,true,'Sending…');
  try{const result=await api('/api/me/resend-verification',{method:'POST',body:'{}'});showToast(verificationMessage(result.emailVerification,`Confirmation link sent to ${state.user.email}.`),5000)}
  catch(error){showToast(error.message)}
  finally{setBusy(button,false)}
});

// A trainer who mistypes an address had no way to take the invitation back, and
// the duplicate guard then blocked the corrected one until the first expired.
async function loadInvitations(){
  if(state.user?.role!=='TRAINER')return;
  try{
    const result=await api('/api/invitations');
    const live=result.invitations.filter(item=>item.live);
    $('#invitationList').innerHTML=live.map(item=>`<article class="note-row"><div><p>${escapeText(item.email)}</p><small>Sent ${new Date(item.createdAt).toLocaleDateString()} · expires ${new Date(item.expiresAt).toLocaleDateString()}</small></div><div class="note-actions"><button class="secondary-button" data-withdraw="${escapeText(item.id)}">Withdraw</button></div></article>`).join('')||'<div class="template-item"><span>No invitations waiting to be accepted.</span></div>';
    $$('[data-withdraw]').forEach(button=>button.addEventListener('click',async()=>{
      try{await api(`/api/invitations/${encodeURIComponent(button.dataset.withdraw)}`,{method:'DELETE',body:'{}'});await loadInvitations();showToast('Invitation withdrawn')}
      catch(error){showToast(error.message)}
    }));
  }catch(error){$('#invitationList').innerHTML=`<div class="template-item"><span>${escapeText(error.message)}</span></div>`}
}

// --- coaching notes --------------------------------------------------------
async function loadNotes(){
  const trainer=state.user?.role==='TRAINER',client=selectedClient();
  if(trainer&&!client){$('#noteList').innerHTML='<div class="template-item"><span>Connect a client to keep coaching notes.</span></div>';return}
  try{
    const result=await api(`/api/trainer-notes${trainer?`?traineeId=${encodeURIComponent(client.id)}`:''}`);
    if(!trainer){
      // The trainee sees only what was shared, newest first.
      const latest=result.notes[0];
      $('#coachMessage').hidden=!latest;
      if(latest){$('#coachInitials').textContent=initials(latest.author?.name||'Coach');$('#coachMessageLabel').textContent=`NOTE FROM ${escapeText((latest.author?.name||'your trainer').toUpperCase())}`;$('#coachMessageBody').textContent=latest.body}
      return;
    }
    $('#noteList').innerHTML=result.notes.map(note=>`<article class="note-row"><div><span class="note-visibility">${note.visibility==='SHARED'?'SHARED':'PRIVATE'}</span><p>${escapeText(note.body)}</p><small>${new Date(note.created_at).toLocaleString()}</small></div><div class="note-actions"><button class="secondary-button" data-note-share="${escapeText(note.id)}" data-visibility="${note.visibility}">${note.visibility==='SHARED'?'Make private':'Share'}</button><button class="secondary-button" data-note-delete="${escapeText(note.id)}">Delete</button></div></article>`).join('')||'<div class="template-item"><span>No coaching notes yet.</span></div>';
    $$('[data-note-share]').forEach(button=>button.addEventListener('click',async()=>{
      const note=result.notes.find(item=>item.id===button.dataset.noteShare);
      try{await api(`/api/trainer-notes/${encodeURIComponent(button.dataset.noteShare)}`,{method:'PATCH',body:JSON.stringify({body:note.body,visibility:button.dataset.visibility==='SHARED'?'PRIVATE':'SHARED'})});await loadNotes()}
      catch(error){showToast(error.message)}
    }));
    $$('[data-note-delete]').forEach(button=>button.addEventListener('click',async()=>{
      try{await api(`/api/trainer-notes/${encodeURIComponent(button.dataset.noteDelete)}`,{method:'DELETE',body:'{}'});await loadNotes()}
      catch(error){showToast(error.message)}
    }));
  }catch(error){if(state.user?.role==='TRAINER')$('#noteList').innerHTML=`<div class="template-item"><span>${escapeText(error.message)}</span></div>`}
}
$('#noteForm').addEventListener('submit',async event=>{
  event.preventDefault();
  const client=selectedClient();
  if(!client)return showToast('Connect a client before writing a note');
  $('#noteError').textContent='';
  try{
    await api('/api/trainer-notes',{method:'POST',body:JSON.stringify({traineeId:client.id,body:$('#noteBody').value,visibility:$('#noteShared').checked?'SHARED':'PRIVATE'})});
    event.target.reset();await loadNotes();showToast('Coaching note saved');
  }catch(error){$('#noteError').textContent=error.message}
});

// --- progress corrections and display units --------------------------------
const trimNumber=value=>String(Math.round(Number(value)*100)/100);
function renderProgressEntries(entries,displayUnit){
  $('#progressEntries').innerHTML=entries.slice().reverse().map(entry=>`<article class="note-row"><div><p>${escapeText(trimNumber(entry.display_value??entry.value))} ${escapeText(entry.display_unit||entry.unit)}${entry.unit!==(entry.display_unit||entry.unit)?` <small>(entered as ${escapeText(trimNumber(entry.value))} ${escapeText(entry.unit)})</small>`:''}</p><small>${new Date(entry.measured_at).toLocaleDateString()}${entry.note?` · ${escapeText(entry.note)}`:''}</small></div><div class="note-actions">${entry.can_manage?`<button class="secondary-button" data-progress-delete="${escapeText(entry.id)}">Delete</button>`:''}</div></article>`).join('')||'<div class="template-item"><span>No entries yet.</span></div>';
  $$('[data-progress-delete]').forEach(button=>button.addEventListener('click',async()=>{
    try{await api(`/api/progress-entries/${encodeURIComponent(button.dataset.progressDelete)}`,{method:'DELETE',body:JSON.stringify({traineeId:selectedClient()?.id})});await loadProgress();showToast('Entry removed')}
    catch(error){showToast(error.message)}
  }));
}

// --- what the trainer may see ---------------------------------------------
// These flags describe access to the trainee's own health data, so the trainee
// is the only one who can set them. Ticking a box is the whole interaction:
// there is no separate save step to forget.
async function loadSharingPreferences(){
  const panel=$('#sharingPanel'),inputs=[$('#shareProgress'),$('#shareNutrition'),$('#shareLogging')];
  if(state.user?.role!=='TRAINEE'){panel.hidden=true;return}
  panel.hidden=false;
  $('#sharingError').textContent='';
  try{
    const result=await api('/api/relationships');
    const active=result.relationships.find(item=>item.status==='ACTIVE');
    state.sharingRelationship=active||null;
    if(!active){
      $('#sharingTrainer').textContent='You have no active trainer, so none of this is shared with anyone.';
      inputs.forEach(input=>{input.checked=false;input.disabled=true});
      return;
    }
    const permissions={view_progress:true,view_nutrition:true,log_on_behalf:false,...(active.permissions||{})};
    $('#sharingTrainer').textContent=`${active.trainer?.name||'Your trainer'} can see what is ticked below. Untick any of it whenever you want; the coaching relationship stays as it is.`;
    $('#shareProgress').checked=permissions.view_progress;
    $('#shareNutrition').checked=permissions.view_nutrition;
    $('#shareLogging').checked=permissions.log_on_behalf;
    inputs.forEach(input=>{input.disabled=false});
  }catch(error){$('#sharingError').textContent=error.message}
}
async function saveSharingPreferences(){
  const active=state.sharingRelationship;
  if(!active)return;
  $('#sharingError').textContent='';
  try{
    const result=await api(`/api/relationships/${encodeURIComponent(active.trainerId)}/${encodeURIComponent(active.traineeId)}`,{method:'PATCH',body:JSON.stringify({permissions:{view_progress:$('#shareProgress').checked,view_nutrition:$('#shareNutrition').checked,log_on_behalf:$('#shareLogging').checked}})});
    state.sharingRelationship={...active,permissions:result.relationship.permissions};
    showToast('Sharing updated');
  }catch(error){
    $('#sharingError').textContent=error.message;
    // The checkbox must not keep showing a state the server rejected.
    await loadSharingPreferences();
  }
}
for(const selector of ['#shareProgress','#shareNutrition','#shareLogging'])$(selector).addEventListener('change',saveSharingPreferences);

async function initialize(){try{const session=await api('/api/session');state.csrfToken=session.csrfToken;$('.demo-divider').hidden=session.demoMode===false;{/* The device preview is a development aid, and pointless inside itself. */const previewable=session.demoMode!==false&&window.top===window;$('#devicePreviewLink').hidden=!previewable;$('#authPreviewLink').hidden=!previewable};$('.demo-actions').hidden=session.demoMode===false;if(session.authenticated)await showApp(session.user);else showAuth();await handleLinkTokens()}catch{showAuth();showToast('Unable to connect to Ptrainer') }}
let polling=false;async function pollLiveData(){if(polling||document.hidden||!state.user)return;polling=true;try{await loadNotifications();if($('.page.active-view')?.id==='messages-view')await loadMessages()}finally{polling=false}}
setInterval(pollLiveData,20000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollLiveData()});

function showAuthPanel(panel){$('#loginForm').hidden=panel!=='login';$('#registerForm').hidden=panel!=='register';$('#forgotPasswordForm').hidden=panel!=='forgot';$$('[data-auth-tab]').forEach(item=>item.classList.toggle('active',item.dataset.authTab===panel));$('.auth-tabs').hidden=panel==='forgot'}
$$('[data-auth-tab]').forEach(button=>button.addEventListener('click',()=>showAuthPanel(button.dataset.authTab)));
$('#forgotPasswordButton').addEventListener('click',()=>{const email=new FormData($('#loginForm')).get('email');showAuthPanel('forgot');if(email)$('#forgotPasswordForm [name="email"]').value=email});
$('#backToLoginButton').addEventListener('click',()=>showAuthPanel('login'));
$('#requestResetButton').addEventListener('click',async event=>{const button=event.currentTarget,form=$('#forgotPasswordForm'),email=new FormData(form).get('email');$('#resetError').textContent='';setBusy(button,true,'Creating…');try{const result=await api('/api/auth/forgot-password',{method:'POST',body:JSON.stringify({email})});if(result.demoResetToken){const tokenInput=form.querySelector('[name="token"]');tokenInput.value=result.demoResetToken;tokenInput.classList.add('reset-code-ready');$('#resetError').textContent='Local demo code created and filled in below.'}else $('#resetError').textContent=result.message}catch(error){$('#resetError').textContent=error.message}finally{setBusy(button,false)}});
$('#forgotPasswordForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),fields=new FormData(form);$('#resetError').textContent='';setBusy(button,true,'Updating…');try{const result=await api('/api/auth/reset-password',{method:'POST',body:JSON.stringify({token:fields.get('token'),password:fields.get('password')})});state.csrfToken=result.csrfToken;form.reset();showAuthPanel('login');showToast('Password updated. Sign in with your new password.')}catch(error){$('#resetError').textContent=error.message}finally{setBusy(button,false)}});
$('#loginForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),fields=new FormData(form);$('#loginError').textContent='';setBusy(button,true,'Signing in…');try{const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:fields.get('email'),password:fields.get('password')})});state.csrfToken=result.csrfToken;await showApp(result.user);form.reset();showToast(`Welcome back, ${result.user.name}`)}catch(error){$('#loginError').textContent=error.message}finally{setBusy(button,false)}});
$('#registerForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('[type="submit"]'),fields=new FormData(form);$('#registerError').textContent='';setBusy(button,true,'Creating account…');try{const result=await api('/api/auth/register',{method:'POST',body:JSON.stringify({name:fields.get('name'),email:fields.get('email'),password:fields.get('password'),role:fields.get('role'),privacyAccepted:fields.get('privacyAccepted')==='on',privacyNoticeVersion:fields.get('privacyNoticeVersion')})});state.csrfToken=result.csrfToken;await showApp(result.user);form.reset();showToast(verificationMessage(result.emailVerification,`Your account is ready. Check ${result.user.email} for a confirmation link.`),6000)}catch(error){$('#registerError').textContent=error.message}finally{setBusy(button,false)}});
$$('[data-demo]').forEach(button=>button.addEventListener('click',async()=>{const role=button.dataset.demo;const payload=role==='trainer'?{email:'trainer@ptrainer.local',password:'DemoTrainer1!'}:{email:'trainee@ptrainer.local',password:'DemoTrainee1!'};setBusy(button,true,'Opening…');try{const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify(payload)});state.csrfToken=result.csrfToken;await showApp(result.user);showToast(`${role==='trainer'?'Trainer':'Trainee'} demo opened`)}catch(error){$('#loginError').textContent=error.message}finally{setBusy(button,false)}}));
$('#logoutButton').addEventListener('click',async()=>{try{await api('/api/auth/logout',{method:'POST',body:'{}'})}finally{state.csrfToken='';const session=await api('/api/session');state.csrfToken=session.csrfToken;showAuth();showToast('Signed out safely')}});

navItems.forEach(item=>item.addEventListener('click',()=>switchView(item.dataset.view)));$$('[data-go]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.go)));$('.mobile-menu').addEventListener('click',()=>sidebar.classList.toggle('open'));$('#quickNoteButton').addEventListener('click',()=>{const id=$('#focusOpenClient').dataset.clientLink;if(!id)return switchView('clients');openClientPage(id);setTimeout(()=>$('#noteBody')?.focus(),350)});$('#helpButton').addEventListener('click',openSupportDialog);
$('.search input').addEventListener('input',event=>{const term=event.target.value.trim().toLowerCase();$$('#dashboardClientRows tr,#clientGrid .client-profile').forEach(item=>item.hidden=Boolean(term)&&!item.textContent.toLowerCase().includes(term))});
$('#themeToggle').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem(THEME_KEY,next)}catch{}applyTheme(next,true)});

async function loadDashboard(){const data=await api('/api/dashboard'),trainerMode=data.kind==='TRAINER';$('#trainerDashboard').hidden=!trainerMode;$('#traineeDashboard').hidden=trainerMode;if(trainerMode){state.trainerClients=data.clients||[];if(!state.trainerClients.some(item=>item.id===state.selectedTraineeId))state.selectedTraineeId=state.trainerClients[0]?.id||null;$('#activeClients').textContent=data.activeClients;$('#workoutsCompleted').textContent=data.workoutsCompleted;$('#completionRate').textContent=`${data.completionRate}%`;$('#progressUpdates').textContent=data.progressUpdates;$('#navClientCount').textContent=data.activeClients;$('#trainerDashboard .stat-grid article:nth-child(1) small').textContent='Active coaching relationships';$('#trainerDashboard .stat-grid article:nth-child(2) small').textContent=`${data.workoutsCompleted} completed total`;$('#trainerDashboard .stat-grid article:nth-child(3) small').textContent=`${data.workoutsCompleted} of ${data.assignedCount} assigned`;$('#trainerDashboard .stat-grid article:nth-child(4) small').textContent='Logged in the last 7 days';$('#trainerDashboard .welcome-row h1').innerHTML=`Good morning, ${escapeText(state.user.name.split(' ')[0])}`;$('#trainerDashboard .welcome-row .eyebrow').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}).toUpperCase();const picker=$('#clientPicker');picker.innerHTML=state.trainerClients.length?state.trainerClients.map(client=>`<option value="${client.id}" ${client.id===state.selectedTraineeId?'selected':''}>${escapeText(client.name)}</option>`).join(''):'<option value="">No active clients</option>';picker.disabled=!state.trainerClients.length;$('#dashboardClientRows').innerHTML=state.trainerClients.length?state.trainerClients.map(client=>`<tr><td><div class="client-cell"><span class="client-avatar lavender">${initials(client.name)}</span><span><strong>${escapeText(client.name)}</strong><small>${escapeText(client.email)}</small></span></div></td><td>${escapeText(client.lastWorkout)}</td><td><div class="mini-progress"><span><i data-w="${client.completionRate}"></i></span><b>${client.completedCount}/${client.assignedCount}</b></div></td><td>${client.assignedCount?'Program active':'No activity'}</td><td><span class="status ${client.completionRate<50?'attention':'active'}">${client.completionRate<50?'Needs check-in':'On track'}</span></td><td><button class="more" data-select-client="${client.id}" aria-label="Select ${escapeText(client.name)}">•••</button></td></tr>`).join(''):'<tr><td colspan="6">No active clients yet. Send an invitation to begin.</td></tr>';$('#clientGrid').innerHTML=state.trainerClients.length?state.trainerClients.map(client=>`<article class="client-profile"><div class="client-avatar lavender">${initials(client.name)}</div><div><h3>${escapeText(client.name)}</h3><p>${escapeText(client.lastWorkout)}</p></div><span class="status ${client.completionRate<50?'attention':'active'}">${client.completionRate<50?'Check-in due':'On track'}</span><div class="client-stats"><span><b>${client.completionRate}%</b>completion</span><span><b>${client.assignedCount}</b>assigned workouts</span></div><button class="secondary-button" data-open-client="${client.id}">Open client</button></article>`).join(''):'<article class="panel empty-state"><h2>No clients connected</h2><p>Invite your first client to begin coaching in Ptrainer.</p><button class="primary-button" data-open-invite>Invite client</button></article>';$$('[data-select-client],[data-open-client]').forEach(button=>button.addEventListener('click',()=>openClientPage(button.dataset.selectClient||button.dataset.openClient)));const schedule=$('.schedule-list');schedule.innerHTML=data.upcoming?.length?data.upcoming.map(item=>`<div class="schedule-item"><div class="time"><strong>${formatDate(item.dueDate)}</strong></div><div class="color-line purple"></div><div class="client-avatar lavender">${initials(item.trainee.name)}</div><div class="schedule-info"><strong>${escapeText(item.trainee.name)}</strong><span>${escapeText(item.name)}</span></div><span class="status upcoming">${escapeText(item.status.toLowerCase())}</span></div>`).join(''):'<div class="template-item"><span>No upcoming workouts.</span></div>';$('.schedule-panel .panel-header p').textContent=`${data.upcoming?.length||0} upcoming workouts`;const next=data.upcoming?.[0],focus=$('.focus-card');$('#focusOpenClient').dataset.clientLink=next?.trainee?.id||'';$('#focusOpenClient').hidden=!next;focus.querySelector('h2').textContent=next?`${next.name} is next for ${next.trainee.name}`:'Your coaching queue is clear';focus.querySelector('p').textContent=next?`Due ${formatDate(next.dueDate)} · ${next.status.toLowerCase()}. Open the plan or add context while it is relevant.`:'Invite a client or assign a workout to create the next coaching action.';focus.querySelector('.session-readout span').textContent=`${data.completionRate}%`;focus.querySelector('.focus-metric small').textContent=`${data.workoutsCompleted} of ${data.assignedCount} completed`;const attention=$('.attention-list');attention.innerHTML=data.attentionItems?.length?data.attentionItems.map(item=>`<button class="attention-item" data-client-link="${escapeText(item.trainee?.id||'')}"><span class="attention-icon warning">!</span><span><strong>Overdue workout</strong><small>${escapeText(item.trainee.name)} · ${escapeText(item.name)} · ${formatDate(item.dueDate)}</small></span><span>›</span></button>`).join(''):'<div class="template-item"><span>No overdue workouts.</span></div>';$('.attention-panel .panel-header p').textContent=`${data.attentionCount} items to review`}else{
$('#traineeStreak').textContent=data.completedCount;
$('#traineeCompletion').textContent=data.weeklyScheduled?`${data.weeklyCompletion}%`:'—';
$('#traineeWeekDetail').textContent=data.weeklyScheduled?`${data.weeklyCompleted} of ${data.weeklyScheduled} workouts done`:'Nothing scheduled this week';
$('.coach-chip').textContent=data.trainerName?`Coach: ${data.trainerName}`:'No trainer connected';
// Once connected, the invitation box is only in the way.
$('#inviteAcceptPanel').hidden=Boolean(data.trainerName);
const next=data.todayWorkout;
if(next){
  const when=!next.dueDate?'NEXT WORKOUT':next.dueDate===data.today?'TODAY\'S WORKOUT':next.dueDate<data.today?'MISSED WORKOUT':'NEXT WORKOUT';
  $('#traineeWorkoutKicker').textContent=when;
  $('#traineeWorkoutName').textContent=next.name;
  $('#traineeWorkoutMeta').textContent=`${next.exerciseCount} exercise${next.exerciseCount===1?'':'s'}${next.dueDate&&next.dueDate!==data.today?` · ${formatDate(next.dueDate)}`:''}${next.status==='IN_PROGRESS'?' · in progress':''}`;
  state.activeAssignmentId=next.id;
}else{$('#traineeWorkoutKicker').textContent='YOUR WORKOUTS';$('#traineeWorkoutName').textContent='Nothing scheduled';$('#traineeWorkoutMeta').textContent='Your trainer’s next workout will appear here.'}
}}

$('#clientPicker').addEventListener('change',event=>{state.selectedTraineeId=event.target.value||null;const current=$('.page.active-view')?.id?.replace('-view','');if(['progress','nutrition','messages','builder','workouts','calendar','client'].includes(current))switchView(current);loadNotes();showToast('Active client updated')});

const dialog=$('#inviteDialog'),inviteForm=$('#inviteForm'),inviteError=$('#inviteError');const openInvite=()=>{inviteError.textContent='';inviteForm.reset();dialog.showModal()};$('#inviteButton').addEventListener('click',openInvite);$$('[data-open-invite]').forEach(button=>button.addEventListener('click',openInvite));[...dialog.querySelectorAll('[data-close-dialog], .modal-close')].forEach(button=>button.addEventListener('click',()=>dialog.close()));
$('#clientGrid').addEventListener('click',event=>{if(event.target.closest('[data-open-invite]'))openInvite()});
inviteForm.addEventListener('submit',async event=>{event.preventDefault();const fields=new FormData(inviteForm),submit=inviteForm.querySelector('[type="submit"]');inviteError.textContent='';setBusy(submit,true,'Sending…');try{const result=await api('/api/invitations',{method:'POST',body:JSON.stringify({email:fields.get('email'),note:fields.get('note')})});dialog.close();showToast(`Invite created · Code: ${result.invitation.inviteCode}`,9000)}catch(error){inviteError.textContent=error.message}finally{setBusy(submit,false)}});
$('#acceptInviteForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button'),code=new FormData(form).get('code').trim();$('#acceptInviteError').textContent='';setBusy(button,true,'Connecting…');try{await api(`/api/invitations/${encodeURIComponent(code)}/accept`,{method:'POST',body:'{}'});form.reset();showToast('Trainer connected successfully');await loadDashboard()}catch(error){$('#acceptInviteError').textContent=error.message}finally{setBusy(button,false)}});

function selectedClient(){return state.trainerClients.find(item=>item.id===state.selectedTraineeId)||state.trainerClients[0]}
function traineeQuery(){const client=selectedClient();return state.user?.role==='TRAINER'&&client?`?traineeId=${encodeURIComponent(client.id)}`:''}
async function loadProgress(){try{const result=await api(`/api/progress-entries${traineeQuery()}`);const entries=result.entries||[],displayUnit=result.displayUnit;
// Every point is plotted in one unit. Mixing a kilogram and a pound on one axis
// as bare numbers drew a trend that was simply wrong.
const chartValue=item=>Number(item.display_value??item.value),values=entries.map(chartValue);renderProgressEntries(entries,displayUnit);if(!values.length){$('#progressChart').innerHTML='<div class="template-item"><span>No progress entries yet.</span></div>';$('#progressLatest').textContent='—';return}const min=Math.min(...values),max=Math.max(...values),range=Math.max(1,max-min),unitLabel=displayUnit||entries.at(-1).unit;$('#progressLatest').textContent=`${values.at(-1).toFixed(1)} ${unitLabel}`;/* The list under the chart shows every entry; the chart shows as many recent ones as fit the width. */const chartSlots=matchMedia('(max-width: 480px)').matches?8:matchMedia('(max-width: 900px)').matches?12:20;$('#progressChart').innerHTML=entries.slice(-chartSlots).map(item=>{const height=20+((chartValue(item)-min)/range)*75;return `<div class="chart-point" title="${chartValue(item).toFixed(1)} ${escapeText(unitLabel)}"><i data-h="${height}"></i><small>${new Date(item.measured_at).toLocaleDateString(undefined,{month:'short',day:'numeric'})}</small></div>`}).join('')}catch(error){$('#progressError').textContent=error.message}}
$('#progressForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),button=form.querySelector('button');$('#progressError').textContent='';setBusy(button,true,'Saving…');try{await api('/api/progress-entries',{method:'POST',body:JSON.stringify({traineeId:state.user.role==='TRAINER'?selectedClient()?.id:undefined,metricType:fields.get('metricType'),value:fields.get('value'),unit:fields.get('unit'),measuredAt:new Date().toISOString()})});form.reset();showToast('Progress entry saved');await loadProgress()}catch(error){$('#progressError').textContent=error.message}finally{setBusy(button,false)}});

const localDate=()=>{const now=new Date(),offset=now.getTimezoneOffset()*60000;return new Date(now-offset).toISOString().slice(0,10)};
/* Food-name lookup. Typing a food is the primary way to get nutrition facts:
   the server answers from a bundled reference table plus Open Food Facts, and
   the best match is applied on its own so nothing has to be typed by hand. */
const foodSearchInput=$('#foodNameInput'),foodSuggestionList=$('#foodSuggestions'),foodSearchStatus=$('#foodSearchStatus');
let foodSearchTimer=null,foodSearchRequest=0,foodMatches=[],foodMatchIndex=-1;
const foodKey=value=>String(value||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const foodSourceLabel=food=>food.source==='OPEN_FOOD_FACTS'?'Open Food Facts':'the Ptrainer food reference';
function closeFoodSuggestions(){foodMatches=[];foodMatchIndex=-1;foodSuggestionList.hidden=true;foodSuggestionList.innerHTML='';foodSearchInput.setAttribute('aria-expanded','false');foodSearchInput.removeAttribute('aria-activedescendant')}
function renderFoodSuggestions(){if(!foodMatches.length)return closeFoodSuggestions();const macro=(label,value)=>`${label} ${value==null?'—':value}`;foodSuggestionList.innerHTML=foodMatches.map((food,index)=>`<li class="food-suggestion${index===foodMatchIndex?' active':''}" id="foodOption${index}" role="option" aria-selected="${index===foodMatchIndex}" data-food-index="${index}"><strong>${escapeText(food.name)}</strong><small>${escapeText(food.brand||'Generic')} · per 100 g: ${macro('',food.nutritionPer100g.calories).trim()} kcal · ${macro('P',food.nutritionPer100g.proteinG)} · ${macro('C',food.nutritionPer100g.carbsG)} · ${macro('F',food.nutritionPer100g.fatG)}</small></li>`).join('');foodSuggestionList.hidden=false;foodSearchInput.setAttribute('aria-expanded','true');foodSearchInput.setAttribute('aria-activedescendant',`foodOption${Math.max(foodMatchIndex,0)}`)}
function moveFoodSuggestion(step){if(!foodMatches.length)return;foodMatchIndex=(foodMatchIndex+step+foodMatches.length)%foodMatches.length;renderFoodSuggestions();foodSuggestionList.children[foodMatchIndex]?.scrollIntoView({block:'nearest'})}
function chooseFoodSuggestion(index){const food=foodMatches[index];if(!food)return;applySelectedFood(food,{announce:false});closeFoodSuggestions();foodSearchStatus.textContent=`Nutrition facts from ${foodSourceLabel(food)}. Set the amount you ate — every number stays editable.`}
// The typed name only auto-fills when the match clearly covers it, so a partial
// word never quietly writes an unrelated food's macros into the form.
const confidentFoodMatch=(food,queryKey)=>{const nameKey=foodKey(food.name);return nameKey===queryKey||nameKey.startsWith(queryKey)||queryKey.split(' ').every(token=>nameKey.includes(token))};
async function searchFoods(term){
  const request=++foodSearchRequest;
  try{
    const result=await api(`/api/food-products?q=${encodeURIComponent(term)}`);
    if(request!==foodSearchRequest||foodSearchInput.value.trim()!==term)return;
    foodMatches=result.results||[];foodMatchIndex=foodMatches.length?0:-1;
    const unavailable=result.remoteAvailable===false?' Packaged-food search is offline, so only generic foods are listed.':'';
    if(!foodMatches.length){closeFoodSuggestions();foodSearchStatus.textContent=`No match for “${term}”. Enter the numbers from the label.${unavailable}`;return}
    if(document.activeElement===foodSearchInput)renderFoodSuggestions();else{foodSuggestionList.hidden=true;foodMatchIndex=-1}
    const queryKey=foodKey(term),best=foodMatches[0];
    if(confidentFoodMatch(best,queryKey)&&macroFieldsUntouched()){applySelectedFood(best,{replaceInput:false,announce:false});foodSearchStatus.textContent=`Auto-filled from ${best.name} (${foodSourceLabel(best)}). Pick another match or edit any number.${unavailable}`}
    else foodSearchStatus.textContent=`${foodMatches.length} match${foodMatches.length===1?'':'es'} found — choose one to fill the nutrition facts.${unavailable}`;
  }catch(error){if(request===foodSearchRequest)foodSearchStatus.textContent=`Food lookup failed: ${error.message} You can still enter the numbers by hand.`}
}
function detachSelectedFood(){const form=$('#nutritionForm');state.selectedFood=null;form.elements.foodBarcode.value='';form.elements.foodBrand.value='';form.elements.dataSource.value='';$('#selectedFood').hidden=true}
foodSearchInput.addEventListener('input',()=>{
  const term=foodSearchInput.value.trim();
  clearTimeout(foodSearchTimer);
  // Retyping means this is no longer the food that was looked up; the numbers
  // stay so an edited entry is never emptied out mid-keystroke.
  if(state.selectedFood&&foodKey(term)!==foodKey(state.selectedFood.name))detachSelectedFood();
  if(term.length<2){closeFoodSuggestions();foodSearchStatus.textContent='';return}
  foodSearchStatus.textContent='Looking up nutrition facts…';
  foodSearchTimer=setTimeout(()=>searchFoods(term),250);
});
foodSearchInput.addEventListener('keydown',event=>{
  if(event.key==='ArrowDown'||event.key==='ArrowUp'){if(!foodSuggestionList.hidden){event.preventDefault();moveFoodSuggestion(event.key==='ArrowDown'?1:-1)}return}
  if(event.key==='Escape'&&!foodSuggestionList.hidden){event.preventDefault();closeFoodSuggestions();return}
  if(event.key==='Enter'&&!foodSuggestionList.hidden&&foodMatchIndex>=0){event.preventDefault();chooseFoodSuggestion(foodMatchIndex)}
});
// An auto-filled entry is stored under the food that was actually matched, so
// the journal never records a half-typed name against another food's macros.
function snapFoodNameToSelection(){if(state.selectedFood&&foodSearchInput.value.trim()!==state.selectedFood.name){foodSearchInput.value=state.selectedFood.name;if(state.autoFilled)state.autoFilled.name=state.selectedFood.name}}
foodSearchInput.addEventListener('blur',()=>{snapFoodNameToSelection();setTimeout(closeFoodSuggestions,150)});
foodSuggestionList.addEventListener('mousedown',event=>event.preventDefault());
foodSuggestionList.addEventListener('click',event=>{const option=event.target.closest('[data-food-index]');if(option)chooseFoodSuggestion(Number(option.dataset.foodIndex))});
const nutritionFields=form=>{const fields=new FormData(form);return{traineeId:state.user.role==='TRAINER'?selectedClient()?.id:undefined,entryDate:fields.get('entryDate'),entryType:fields.get('entryType'),description:fields.get('description'),calories:fields.get('calories'),proteinG:fields.get('proteinG'),carbsG:fields.get('carbsG'),fatG:fields.get('fatG'),waterMl:fields.get('waterMl'),foodBarcode:fields.get('foodBarcode'),foodName:fields.get('foodName'),foodBrand:fields.get('foodBrand'),foodQuantityG:fields.get('foodQuantityG'),dataSource:fields.get('dataSource')}};
function nutritionQuery(){const params=new URLSearchParams(),client=selectedClient(),date=$('#nutritionDateFilter').value;if(state.user?.role==='TRAINER'&&client)params.set('traineeId',client.id);if(date)params.set('date',date);return`?${params}`}
function clearSelectedFood({clearMacros=true,clearName=true}={}){const form=$('#nutritionForm');if(state.autoFilled&&form.elements.description.value===state.autoFilled.description)form.elements.description.value='';state.selectedFood=null;state.autoFilled=null;for(const name of ['foodBarcode','foodBrand','foodQuantityG','dataSource'])form.elements[name].value='';if(clearName)form.elements.foodName.value='';if(clearMacros)for(const name of ['calories','proteinG','carbsG','fatG'])form.elements[name].value='';$('#selectedFood').hidden=true;closeFoodSuggestions();$('#foodSearchStatus').textContent=''}
function resetNutritionForm(){const form=$('#nutritionForm');form.reset();clearSelectedFood();form.elements.entryDate.value=$('#nutritionDateFilter').value||localDate();form.elements.entryId.value='';$('#nutritionFormTitle').textContent='Add nutrition entry';$('#cancelNutritionEdit').hidden=true;form.querySelector('[type="submit"]').textContent='Save entry'}
function macroSummary(key,label,unit,entries,target){const total=entries.reduce((sum,item)=>sum+Number(item[key]||0),0),goal=target?.[key],progress=goal?Math.min(100,Math.round(total/Number(goal)*100)):0;return`<article class="nutrition-summary-card"><span>${label}</span><strong>${Math.round(total*10)/10}<small>${unit}</small></strong><div class="nutrition-goal"><i data-w="${progress}"></i></div><small>${goal?`${progress}% of ${Number(goal)} ${unit}`:'No target set'}</small></article>`}
async function loadNutrition(){try{const result=await api(`/api/nutrition-entries${nutritionQuery()}`),entries=result.entries||[],target=result.target;state.nutritionEntries=entries;$('#nutritionListCaption').textContent=new Date(`${$('#nutritionDateFilter').value}T12:00:00`).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});$('#nutritionSummary').innerHTML=[macroSummary('calories','Calories','kcal',entries,target),macroSummary('protein_g','Protein','g',entries,target),macroSummary('carbs_g','Carbs','g',entries,target),macroSummary('fat_g','Fat','g',entries,target),macroSummary('water_ml','Water','ml',entries,target)].join('');$('#nutritionList').innerHTML=entries.length?entries.map(item=>`<article class="nutrition-row"><div class="nutrition-entry-copy"><span class="nutrition-meal-type">${escapeText(item.entry_type.replaceAll('_',' '))}${item.food_barcode?' · SCANNED FOOD':''}</span><strong>${escapeText(item.description||'Nutrition entry')}</strong><small>${item.food_barcode?`${escapeText(item.food_brand||'Packaged food')} · ${Number(item.food_quantity_g||0)} g/ml · `:''}Added by ${escapeText(item.author_name)}</small></div><span>${item.calories??'—'}<small>kcal</small></span><span>${item.protein_g??'—'}<small>protein g</small></span><span>${item.carbs_g??'—'}<small>carbs g</small></span><span>${item.fat_g??'—'}<small>fat g</small></span><span>${item.water_ml??'—'}<small>water ml</small></span>${item.can_manage?`<div class="nutrition-row-actions"><button class="icon-button" type="button" data-edit-nutrition="${item.id}" aria-label="Edit nutrition entry">✎</button><button class="icon-button danger-icon" type="button" data-delete-nutrition="${item.id}" aria-label="Delete nutrition entry">×</button></div>`:''}</article>`).join(''):'<div class="empty-state compact"><h2>No entries for this day</h2><p>Add a meal, daily summary, or water entry.</p></div>';const targetForm=$('#nutritionTargetForm');for(const [name,key]of [['calories','calories'],['proteinG','protein_g'],['carbsG','carbs_g'],['fatG','fat_g'],['waterMl','water_ml']])targetForm.elements[name].value=target?.[key]??''}catch(error){$('#nutritionError').textContent=error.message}}
$('#nutritionDateFilter').value=localDate();resetNutritionForm();
$('#nutritionDateFilter').addEventListener('change',async()=>{resetNutritionForm();await loadNutrition()});
$('#cancelNutritionEdit').addEventListener('click',resetNutritionForm);
$('#nutritionForm').addEventListener('submit',async event=>{event.preventDefault();snapFoodNameToSelection();const form=event.currentTarget,entryId=form.elements.entryId.value,button=form.querySelector('[type="submit"]');$('#nutritionError').textContent='';setBusy(button,true,'Saving…');try{await api(entryId?`/api/nutrition-entries/${encodeURIComponent(entryId)}`:'/api/nutrition-entries',{method:entryId?'PATCH':'POST',body:JSON.stringify(nutritionFields(form))});resetNutritionForm();showToast(entryId?'Nutrition entry updated':'Nutrition entry saved');await loadNutrition()}catch(error){$('#nutritionError').textContent=error.message}finally{setBusy(button,false)}});
$('#nutritionList').addEventListener('click',async event=>{const editButton=event.target.closest('[data-edit-nutrition]'),deleteButton=event.target.closest('[data-delete-nutrition]');if(editButton){const entry=state.nutritionEntries.find(item=>item.id===editButton.dataset.editNutrition),form=$('#nutritionForm');if(!entry)return;resetNutritionForm();form.elements.entryId.value=entry.id;form.elements.entryDate.value=String(entry.entry_date).slice(0,10);form.elements.entryType.value=entry.entry_type;form.elements.description.value=entry.description;for(const [name,key]of [['calories','calories'],['proteinG','protein_g'],['carbsG','carbs_g'],['fatG','fat_g'],['waterMl','water_ml'],['foodBarcode','food_barcode'],['foodName','food_name'],['foodBrand','food_brand'],['foodQuantityG','food_quantity_g'],['dataSource','data_source']])form.elements[name].value=entry[key]??'';if(entry.food_name||entry.food_barcode){$('#selectedFood').hidden=false;$('#selectedFoodSource').textContent=entry.food_barcode?'PACKAGED FOOD':'LOOKED-UP FOOD';$('#selectedFoodName').textContent=entry.food_name||'Packaged food';$('#selectedFoodDetails').textContent=[entry.food_brand||'',entry.food_barcode?`barcode ${entry.food_barcode}`:''].filter(Boolean).join(' · ')||'Nutrition per 100 g/ml';}$('#nutritionFormTitle').textContent='Edit nutrition entry';$('#cancelNutritionEdit').hidden=false;form.querySelector('[type="submit"]').textContent='Update entry';form.scrollIntoView({behavior:'smooth',block:'start'})}if(deleteButton){const entry=state.nutritionEntries.find(item=>item.id===deleteButton.dataset.deleteNutrition);if(!entry||!confirm('Delete this nutrition entry? This cannot be undone.'))return;try{await api(`/api/nutrition-entries/${encodeURIComponent(entry.id)}`,{method:'DELETE',body:JSON.stringify({traineeId:state.user.role==='TRAINER'?selectedClient()?.id:undefined})});showToast('Nutrition entry deleted');await loadNutrition()}catch(error){$('#nutritionError').textContent=error.message}}});
$('#nutritionTargetForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),button=form.querySelector('button');$('#nutritionTargetError').textContent='';setBusy(button,true,'Saving…');try{await api('/api/nutrition-target',{method:'PATCH',body:JSON.stringify({traineeId:state.user.role==='TRAINER'?selectedClient()?.id:undefined,calories:fields.get('calories'),proteinG:fields.get('proteinG'),carbsG:fields.get('carbsG'),fatG:fields.get('fatG'),waterMl:fields.get('waterMl')})});showToast('Daily nutrition targets saved');await loadNutrition()}catch(error){$('#nutritionTargetError').textContent=error.message}finally{setBusy(button,false)}});

const barcodeDialog=$('#barcodeDialog'),barcodeVideo=$('#barcodeVideo');let barcodeStream=null,barcodeFrame=null,barcodeDetecting=false;
function stopBarcodeCamera(){if(barcodeFrame)cancelAnimationFrame(barcodeFrame);barcodeFrame=null;barcodeDetecting=false;if(barcodeStream)barcodeStream.getTracks().forEach(track=>track.stop());barcodeStream=null;barcodeVideo.srcObject=null;$('#barcodeCamera').hidden=true;$('#startBarcodeCamera').textContent='Start camera scanner'}
// Macro fields are only ever rewritten while they still hold what a previous
// lookup wrote, so a trainee who corrected a number against the package label
// never has that correction overwritten by the next keystroke.
function macroFieldsUntouched(){const form=$('#nutritionForm'),macroNames=['calories','proteinG','carbsG','fatG'],snapshot=state.autoFilled;return snapshot?macroNames.every(name=>form.elements[name].value===snapshot.macros[name]):macroNames.every(name=>!form.elements[name].value)}
function applyFoodNutrition(){const product=state.selectedFood;if(!product)return;const form=$('#nutritionForm'),quantity=Number(form.elements.foodQuantityG.value),factor=Number.isFinite(quantity)&&quantity>0?quantity/100:0,nutrients=product.nutritionPer100g;form.elements.calories.value=nutrients.calories==null?'':String(Math.round(nutrients.calories*factor));for(const name of ['proteinG','carbsG','fatG'])form.elements[name].value=nutrients[name]==null?'':String(Math.round(nutrients[name]*factor*10)/10);if(state.autoFilled)state.autoFilled.macros=Object.fromEntries(['calories','proteinG','carbsG','fatG'].map(name=>[name,form.elements[name].value]))}
function descriptionUntouched(){const value=$('#nutritionForm').elements.description.value;return !value.trim()||Boolean(state.autoFilled)&&value===state.autoFilled.description}
function foodDetailLine(product){return [product.brand||'Unknown brand',product.barcode?`barcode ${product.barcode}`:product.servingSize||'nutrition per 100 g/ml',`${product.nutritionPer100g.calories??'—'} kcal per 100 g`].filter(Boolean).join(' · ')}
function applySelectedFood(product,{replaceInput=true,announce=true}={}){const form=$('#nutritionForm');state.selectedFood=product;form.elements.foodBarcode.value=product.barcode||'';form.elements.foodBrand.value=product.brand;form.elements.dataSource.value=product.source;form.elements.foodQuantityG.value=product.suggestedQuantity;if(replaceInput)form.elements.foodName.value=product.name;if(descriptionUntouched())form.elements.description.value=[product.name,product.brand].filter(Boolean).join(' · ');state.autoFilled={macros:{},description:form.elements.description.value};$('#selectedFoodSource').textContent=product.source==='OPEN_FOOD_FACTS'?'PACKAGED FOOD':'FOOD REFERENCE';$('#selectedFoodName').textContent=product.name;$('#selectedFoodDetails').textContent=foodDetailLine(product);$('#selectedFood').hidden=false;applyFoodNutrition();if(announce)showToast(`${product.name} added to the nutrition form`)}
async function lookupBarcode(value,button=null){const barcode=String(value||'').replace(/[\s-]/g,'');if(!/^\d{8,14}$/.test(barcode)){$('#barcodeStatus').textContent='Enter an 8–14 digit UPC, EAN, or GTIN barcode.';return}if(button)setBusy(button,true,'Looking up…');$('#barcodeStatus').textContent='Looking up nutrition facts…';stopBarcodeCamera();try{const result=await api(`/api/food-products/${encodeURIComponent(barcode)}`);applySelectedFood(result.product);barcodeDialog.close()}catch(error){$('#barcodeStatus').textContent=error.message}finally{if(button)setBusy(button,false)}}
async function scanBarcodeFrame(detector){if(!barcodeStream||barcodeDetecting)return;barcodeDetecting=true;try{if(barcodeVideo.readyState>=2){const results=await detector.detect(barcodeVideo);if(results[0]?.rawValue){await lookupBarcode(results[0].rawValue);return}}}catch{}finally{barcodeDetecting=false}if(barcodeStream)barcodeFrame=requestAnimationFrame(()=>scanBarcodeFrame(detector))}
async function startBarcodeCamera(){const button=$('#startBarcodeCamera');if(!('BarcodeDetector'in window)||!navigator.mediaDevices?.getUserMedia){$('#barcodeStatus').textContent='Camera scanning is not supported in this browser. Enter the barcode number below.';return}setBusy(button,true,'Opening camera…');try{const supported=BarcodeDetector.getSupportedFormats?await BarcodeDetector.getSupportedFormats():[],preferred=['ean_13','ean_8','upc_a','upc_e','itf'],formats=supported.length?preferred.filter(format=>supported.includes(format)):preferred,detector=new BarcodeDetector(formats.length?{formats}:undefined);barcodeStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}});barcodeVideo.srcObject=barcodeStream;await barcodeVideo.play();$('#barcodeCamera').hidden=false;button.textContent='Stop camera';button.disabled=false;$('#barcodeStatus').textContent='Hold the barcode inside the guide. Scanning happens automatically.';barcodeFrame=requestAnimationFrame(()=>scanBarcodeFrame(detector))}catch(error){stopBarcodeCamera();$('#barcodeStatus').textContent=error.name==='NotAllowedError'?'Camera permission was denied. Enter the barcode number below.':'The camera could not start. Enter the barcode number below.'}finally{if(!barcodeStream)setBusy(button,false)}}
$('#openBarcodeScanner').addEventListener('click',()=>{stopBarcodeCamera();$('#barcodeLookupForm').reset();$('#barcodeStatus').textContent='Barcode lookups use Open Food Facts. Ptrainer sends the barcode only—never your account or client ID. Always verify the package label.';barcodeDialog.showModal()});
$('#closeBarcodeScanner').addEventListener('click',()=>barcodeDialog.close());barcodeDialog.addEventListener('close',stopBarcodeCamera);
$('#startBarcodeCamera').addEventListener('click',()=>barcodeStream?stopBarcodeCamera():startBarcodeCamera());
$('#barcodeLookupForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;await lookupBarcode(new FormData(form).get('barcode'),form.querySelector('button'))});
$('#nutritionForm [name="foodQuantityG"]').addEventListener('input',applyFoodNutrition);$('#clearSelectedFood').addEventListener('click',()=>clearSelectedFood());

// Messages live in messages.js.

const notificationsDialog=$('#notificationsDialog');$('#notificationsButton').addEventListener('click',async()=>{await loadNotifications();notificationsDialog.showModal()});$('[data-close-notifications]').addEventListener('click',()=>notificationsDialog.close());
async function loadNotifications(){if(!state.user)return;try{const result=await api('/api/notifications');$('#notificationDot').hidden=result.unreadCount===0;$('#notificationList').innerHTML=result.notifications.length?result.notifications.map(item=>`<article class="notification-item ${item.read_at?'read':''}" data-notification="${item.id}"><i></i><div><strong>${escapeText(item.title)}</strong><span>${escapeText(item.body)}</span><small>${new Date(item.created_at).toLocaleString()}</small></div></article>`).join(''):'<div class="template-item"><span>You are all caught up.</span></div>';$$('[data-notification]').forEach(item=>item.addEventListener('click',async()=>{await api(`/api/notifications/${item.dataset.notification}/read`,{method:'POST',body:'{}'});item.classList.add('read');await loadNotifications()}))}catch{$('#notificationDot').hidden=true}}

async function loadSubscription(){try{const result=await api('/api/subscription');$('#currentPlan').textContent=`${result.subscription.plan_code} · ${result.subscription.status}`}catch(error){showToast(error.message)}}
$$('[data-plan]').forEach(button=>button.addEventListener('click',async()=>{setBusy(button,true,'Activating…');try{const result=await api('/api/billing/test-checkout',{method:'POST',body:JSON.stringify({planCode:button.dataset.plan})});$('#currentPlan').textContent=`${result.subscription.plan_code} · ${result.subscription.status}`;showToast(`${button.dataset.plan} activated in test mode — no charge`)}catch(error){showToast(error.message)}finally{setBusy(button,false)}}));

async function loadSettings(){loadSharingPreferences();loadCalendarFeed();try{const [{user,profile},activity,privacy,accountPrivacy]=await Promise.all([api('/api/me'),api('/api/me/audit-events'),api('/api/privacy'),api('/api/me/privacy')]),form=$('#profileForm');form.elements.name.value=user.name;form.elements.bio.value=profile.bio||'';form.elements.goals.value=profile.goals||'';form.elements.specialties.value=profile.specialties||'';form.elements.preferredUnits.value=profile.preferred_units||'METRIC';form.elements.timezone.value=profile.timezone||'America/Toronto';$('#storageRegion').textContent=`${privacy.storageRegion}${privacy.pilot?' · controlled pilot':''}`;$('#privacyNoticeStatus').textContent=accountPrivacy.consent?accountPrivacy.consent.notice_version===privacy.noticeVersion?`Accepted ${accountPrivacy.consent.notice_version} · ${new Date(accountPrivacy.consent.accepted_at).toLocaleDateString()}`:`Accepted ${accountPrivacy.consent.notice_version} · current notice ${privacy.noticeVersion}`:`Current version ${privacy.noticeVersion} · no recorded acceptance for this pre-existing/demo account`;$('#auditList').innerHTML=activity.events.length?activity.events.slice(0,8).map(item=>`<div class="audit-item"><strong>${escapeText(item.action.replaceAll('_',' ').toLowerCase())}</strong><span>${new Date(item.created_at).toLocaleString()}</span></div>`).join(''):'<div class="template-item"><span>No security activity yet.</span></div>'}catch(error){$('#profileError').textContent=error.message}}
$('#profileForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),button=form.querySelector('[type="submit"]');$('#profileError').textContent='';setBusy(button,true,'Saving…');try{const result=await api('/api/me/profile',{method:'PATCH',body:JSON.stringify({name:fields.get('name'),bio:fields.get('bio'),goals:fields.get('goals'),specialties:fields.get('specialties'),preferredUnits:fields.get('preferredUnits'),timezone:fields.get('timezone')})});state.user=result.user;$('#profileName').textContent=result.user.name;$('.profile-mini .avatar').textContent=initials(result.user.name);showToast('Profile saved');await loadSettings()}catch(error){$('#profileError').textContent=error.message}finally{setBusy(button,false)}});
$('#exportDataButton').addEventListener('click',async event=>{const button=event.currentTarget;setBusy(button,true,'Preparing…');try{const data=await api('/api/me/export'),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`ptrainer-data-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);showToast('Your data export is ready');await loadSettings()}catch(error){showToast(error.message)}finally{setBusy(button,false)}});
// The calendar link is a credential the server will not show twice, so this
// panel has to be honest about that rather than implying the URL can be looked
// up later. After it is created everything works from the fingerprint, and the
// only way back to a lost link is a replacement that retires the old one.
function renderCalendarFeed(feed){
  const active=Boolean(feed&&feed.enabled);
  $('#calendarFeedStatus').textContent=active
    ?`Link ${feed.fingerprint}… · created ${new Date(feed.createdAt).toLocaleDateString()} · ${feed.lastUsedAt?`last read ${new Date(feed.lastUsedAt).toLocaleString()}`:'not read by a calendar yet'}`
    :'No calendar link yet. Create one to subscribe from Google or Apple Calendar.';
  $('#calendarFeedCreate').textContent=active?'Replace link':'Create calendar link';
  $('#calendarFeedRevoke').hidden=!active;
}
async function loadCalendarFeed(){$('#calendarFeedError').textContent='';try{const{feed}=await api('/api/me/calendar-feed');renderCalendarFeed(feed)}catch(error){$('#calendarFeedError').textContent=error.message}}
$('#calendarFeedCreate').addEventListener('click',async event=>{const button=event.currentTarget;
  // Replacing is destructive to a subscription somebody may have set up months
  // ago on a device they are not holding, so it asks first.
  if(!$('#calendarFeedRevoke').hidden&&!confirm('Replacing the link stops the current one working on any device already subscribed. Continue?'))return;
  $('#calendarFeedError').textContent='';setBusy(button,true,'Creating…');
  try{const result=await api('/api/me/calendar-feed',{method:'POST',body:'{}'});$('#calendarFeedUrl').value=result.url;$('#calendarFeedSubscribe').href=result.webcalUrl;$('#calendarFeedReveal').hidden=false;$('#calendarFeedCopy').hidden=false;$('#calendarFeedSubscribe').hidden=false;renderCalendarFeed(result.feed);showToast('Calendar link created — copy it now, it is not shown again')}catch(error){$('#calendarFeedError').textContent=error.message}finally{setBusy(button,false)}});
$('#calendarFeedCopy').addEventListener('click',async()=>{const field=$('#calendarFeedUrl');field.select();try{await navigator.clipboard.writeText(field.value);showToast('Calendar link copied')}catch{document.execCommand('copy');showToast('Calendar link selected — press Ctrl/Cmd + C')}});
$('#calendarFeedRevoke').addEventListener('click',async event=>{const button=event.currentTarget;if(!confirm('Turn off the calendar link? Any device subscribed to it stops receiving your workouts.'))return;$('#calendarFeedError').textContent='';setBusy(button,true,'Turning off…');try{const{feed}=await api('/api/me/calendar-feed',{method:'DELETE',body:'{}'});$('#calendarFeedReveal').hidden=true;$('#calendarFeedUrl').value='';$('#calendarFeedCopy').hidden=true;$('#calendarFeedSubscribe').hidden=true;renderCalendarFeed(feed);showToast('Calendar link turned off')}catch(error){$('#calendarFeedError').textContent=error.message}finally{setBusy(button,false)}});
// The file download needs no link and no token: the session already proves who
// is asking, so it goes through the authenticated endpoint directly.
$('#calendarFeedDownload').addEventListener('click',async event=>{const button=event.currentTarget;$('#calendarFeedError').textContent='';setBusy(button,true,'Preparing…');try{const response=await fetch('/api/me/calendar.ics',{credentials:'same-origin'});if(!response.ok)throw new Error('Calendar file could not be prepared.');const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='ptrainer-workouts.ics';link.click();URL.revokeObjectURL(url);showToast('Calendar file downloaded')}catch(error){$('#calendarFeedError').textContent=error.message}finally{setBusy(button,false)}});

const deleteDialog=$('#deleteAccountDialog');$('#openDeleteAccount').addEventListener('click',()=>{deleteDialog.showModal();$('#deleteAccountForm').reset();$('#deleteAccountError').textContent=''});$$('[data-close-delete]').forEach(button=>button.addEventListener('click',()=>deleteDialog.close()));$('#deleteAccountForm').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,fields=new FormData(form),button=form.querySelector('[type="submit"]');$('#deleteAccountError').textContent='';setBusy(button,true,'Deleting…');try{await api('/api/me/account',{method:'DELETE',body:JSON.stringify({password:fields.get('password'),confirmation:fields.get('confirmation')})});deleteDialog.close();state.csrfToken='';const session=await api('/api/session');state.csrfToken=session.csrfToken;showAuth();showToast('Your account has been deleted and anonymized')}catch(error){$('#deleteAccountError').textContent=error.message}finally{setBusy(button,false)}});

const legalDialog=$('#legalDialog'),legalCopy={terms:{title:'Pilot terms',kicker:'RESPONSIBLE USE',content:'Ptrainer is a fitness coaching and tracking tool, not a medical diagnosis or emergency service. Users should stop exercise and seek qualified care when symptoms, injury, or pain require it. Trainers remain responsible for their professional advice and clients remain responsible for choosing whether to follow it.'}};
async function openLegal(kind){const content=$('#legalContent');legalDialog.showModal();if(kind==='privacy'){$('#legalTitle').textContent='Privacy Notice';$('#legalKicker').textContent='YOUR DATA & RIGHTS';content.innerHTML=$('#privacyPolicyTemplate').innerHTML;try{const privacy=await api('/api/privacy');content.querySelectorAll('[data-privacy-organization]').forEach(node=>node.textContent=privacy.organization);content.querySelectorAll('[data-privacy-email]').forEach(node=>{node.textContent=privacy.contactEmail;node.href=`mailto:${privacy.contactEmail}`});content.querySelectorAll('[data-storage-region]').forEach(node=>node.textContent=privacy.storageRegion);content.querySelectorAll('[data-privacy-version]').forEach(node=>node.textContent=privacy.noticeVersion)}catch{showToast('Privacy configuration could not be loaded')}}else{const copy=legalCopy[kind];$('#legalTitle').textContent=copy.title;$('#legalKicker').textContent=copy.kicker;content.innerHTML=`<p>${escapeText(copy.content)}</p><p><strong>Last updated:</strong> August 20, 2026</p>`}}
$$('[data-open-privacy]').forEach(button=>button.addEventListener('click',()=>openLegal('privacy')));$$('[data-open-terms]').forEach(button=>button.addEventListener('click',()=>openLegal('terms')));$('[data-close-legal]').addEventListener('click',()=>legalDialog.close());

function escapeText(value){const node=document.createElement('span');node.textContent=String(value);return node.innerHTML}

/* Calendar — a read-only month view of work that is already assigned.
   It writes nothing. A trainer still assigns and edits in Workouts and a trainee
   still logs there; choosing a workout here hands off to that view rather than
   growing a second logger that could drift from the first. */
const CALENDAR_STATUS_LABEL={ASSIGNED:'Assigned',IN_PROGRESS:'In progress',COMPLETED:'Completed',SKIPPED:'Skipped',ARCHIVED:'Archived'};
const CALENDAR_WEEKDAYS=[['Mon','Monday'],['Tue','Tuesday'],['Wed','Wednesday'],['Thu','Thursday'],['Fri','Friday'],['Sat','Saturday'],['Sun','Sunday']];
const CALENDAR_PAGE_CAP=6;
// Days are carried as YYYY-MM-DD text in the viewer's own zone throughout. Going
// through `new Date(dueDate)` would read the string as UTC and move a workout a
// day west of Greenwich, which is the one mistake a calendar cannot make.
const calendarKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const calendarDate=key=>{const [year,month,day]=String(key).split('-').map(Number);return new Date(year,month-1,day)};
const calendarDayLabel=key=>calendarDate(key).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric',year:'numeric'});
const calendarMonthOf=date=>new Date(date.getFullYear(),date.getMonth(),1);
// The grid always starts on the Monday on or before the 1st and runs six weeks,
// so the layout never reflows as the months change length.
const calendarGridStart=month=>{const first=calendarMonthOf(month);return new Date(first.getFullYear(),first.getMonth(),1-((first.getDay()+6)%7))};

function calendarMonth(){return state.calendarMonth||(state.calendarMonth=calendarMonthOf(new Date()))}
function shiftCalendarMonth(step){const month=calendarMonth();state.calendarMonth=new Date(month.getFullYear(),month.getMonth()+step,1);state.calendarSelectedDate=null;return loadCalendar()}

// A month is a window, not a page, so the range goes to the server and the rows
// come back a page at a time. The cap stops a pathological month from paging
// forever, and the summary says plainly when it was hit.
async function fetchCalendarWindow(from,to){
  const client=selectedClient(),rows=[];let cursor=null;
  for(let page=0;page<CALENDAR_PAGE_CAP;page+=1){
    const params=new URLSearchParams({from,to,limit:'200'});
    if(state.user?.role==='TRAINER'&&client)params.set('traineeId',client.id);
    if(cursor)params.set('cursor',cursor);
    const result=await api(`/api/assigned-workouts?${params}`);
    rows.push(...result.assignments);
    cursor=result.nextCursor;
    if(!cursor)return {rows,truncated:false};
  }
  return {rows,truncated:true};
}

function renderCalendarDay(){
  const list=$('#calendarDayList'),key=state.calendarSelectedDate;
  if(!key){$('#calendarDayLabel').textContent='No day selected';list.innerHTML='<p class="calendar-empty">Choose a day in the grid.</p>';return}
  $('#calendarDayLabel').textContent=calendarDayLabel(key);
  const entries=state.calendarDays.get(key)||[];
  list.innerHTML=entries.length?entries.map(item=>`<article class="calendar-entry">
      <div><strong>${escapeText(item.templateSnapshot?.name||'Workout')}</strong><small>${item.templateSnapshot?.exercises?.length||0} exercises${item.seriesId?' · part of a repeating program':''}</small></div>
      <span class="calendar-status status-${escapeText(String(item.status).toLowerCase())}">${escapeText(CALENDAR_STATUS_LABEL[item.status]||item.status)}</span>
      <button class="secondary-button" type="button" data-open-assignment="${escapeText(item.id)}">${item.status==='COMPLETED'?'See what was logged':state.user?.role==='TRAINER'?'Open client':'Open workout'}</button>
    </article>`).join(''):'<p class="calendar-empty">Nothing scheduled on this day.</p>';
}

function selectCalendarDay(key){
  state.calendarSelectedDate=key;
  $$('#calendarBody .calendar-day').forEach(button=>{
    const active=button.dataset.date===key;
    button.classList.toggle('selected',active);
    button.setAttribute('aria-pressed',String(active));
    button.tabIndex=active?0:-1;
  });
  renderCalendarDay();
}

function renderCalendarGrid(){
  const month=calendarMonth(),start=calendarGridStart(month),today=calendarKey(new Date()),monthIndex=month.getMonth();
  $('#calendarWeekdays').innerHTML=CALENDAR_WEEKDAYS.map(([short,full])=>`<th scope="col"><span aria-hidden="true">${short}</span><span class="sr-only">${full}</span></th>`).join('');
  const rows=[];
  for(let week=0;week<6;week+=1){
    const cells=[];
    for(let day=0;day<7;day+=1){
      const date=new Date(start.getFullYear(),start.getMonth(),start.getDate()+week*7+day),key=calendarKey(date);
      const entries=state.calendarDays.get(key)||[],outside=date.getMonth()!==monthIndex;
      // The count belongs in the accessible name: a row of dots says nothing to
      // somebody who cannot see them.
      const name=`${calendarDayLabel(key)}, ${entries.length===1?'1 workout':`${entries.length} workouts`}`;
      const dots=entries.slice(0,3).map(item=>`<i class="status-${escapeText(String(item.status).toLowerCase())}"></i>`).join('');
      cells.push(`<td><button type="button" class="calendar-day${outside?' outside':''}${key===today?' today':''}" data-date="${key}" aria-pressed="false" aria-label="${escapeText(name)}" tabindex="-1"><span class="calendar-day-number">${date.getDate()}</span><span class="calendar-day-dots" aria-hidden="true">${dots}${entries.length>3?`<b>+${entries.length-3}</b>`:''}</span></button></td>`);
    }
    rows.push(`<tr>${cells.join('')}</tr>`);
  }
  $('#calendarBody').innerHTML=rows.join('');
}

async function loadCalendar(){
  const month=calendarMonth(),start=calendarGridStart(month);
  const end=new Date(start.getFullYear(),start.getMonth(),start.getDate()+41);
  const startKey=calendarKey(start),endKey=calendarKey(end);
  $('#calendarMonthLabel').textContent=month.toLocaleDateString(undefined,{month:'long',year:'numeric'});
  try{
    const {rows,truncated}=await fetchCalendarWindow(startKey,endKey);
    state.calendarDays=new Map();
    for(const item of rows){
      if(!item.dueDate)continue;
      const key=String(item.dueDate).slice(0,10),bucket=state.calendarDays.get(key);
      if(bucket)bucket.push(item);else state.calendarDays.set(key,[item]);
    }
    for(const bucket of state.calendarDays.values())bucket.sort((a,b)=>String(a.templateSnapshot?.name||'').localeCompare(String(b.templateSnapshot?.name||'')));
    const monthPrefix=`${month.getFullYear()}-${String(month.getMonth()+1).padStart(2,'0')}`;
    const inMonth=rows.filter(item=>String(item.dueDate||'').startsWith(monthPrefix));
    const done=inMonth.filter(item=>item.status==='COMPLETED').length;
    const client=selectedClient(),who=state.user?.role==='TRAINER'?(client?`${client.name} · `:'No active client · '):'';
    $('#calendarSummary').textContent=`${who}${inMonth.length===1?'1 workout':`${inMonth.length} workouts`} this month · ${done} completed${truncated?' · showing the first pages only':''}`;
  }catch(error){
    // A calendar that cannot load must not take the rest of the app with it.
    state.calendarDays=new Map();
    $('#calendarSummary').textContent=error.message;
  }
  renderCalendarGrid();
  const todayKey=calendarKey(new Date());
  if(!state.calendarSelectedDate||state.calendarSelectedDate<startKey||state.calendarSelectedDate>endKey){
    state.calendarSelectedDate=todayKey>=startKey&&todayKey<=endKey?todayKey:calendarKey(month);
  }
  selectCalendarDay(state.calendarSelectedDate);
}

$('#calendarPrev').addEventListener('click',()=>shiftCalendarMonth(-1));
$('#calendarNext').addEventListener('click',()=>shiftCalendarMonth(1));
$('#calendarToday').addEventListener('click',()=>{state.calendarMonth=calendarMonthOf(new Date());state.calendarSelectedDate=calendarKey(new Date());loadCalendar()});
$('#calendarBody').addEventListener('click',event=>{const button=event.target.closest('.calendar-day');if(button)selectCalendarDay(button.dataset.date)});
// Roving tabindex: forty-two days in the tab order would bury everything after
// the grid, so the arrows move within it and only one day is tabbable.
$('#calendarBody').addEventListener('keydown',event=>{
  const button=event.target.closest('.calendar-day');if(!button)return;
  const step={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
  if(step===undefined&&!['Home','End','PageUp','PageDown'].includes(event.key))return;
  event.preventDefault();
  if(event.key==='PageUp'||event.key==='PageDown')return void shiftCalendarMonth(event.key==='PageUp'?-1:1).then(()=>$('#calendarBody .calendar-day.selected')?.focus());
  const days=$$('#calendarBody .calendar-day'),index=days.indexOf(button),row=Math.floor(index/7);
  const target=event.key==='Home'?row*7:event.key==='End'?row*7+6:Math.min(days.length-1,Math.max(0,index+step));
  days[target].focus();
});
$('#calendarDayList').addEventListener('click',event=>{
  const button=event.target.closest('[data-open-assignment]');if(!button)return;
  const id=button.dataset.openAssignment,assignment=(state.calendarDays.get(state.calendarSelectedDate)||[]).find(item=>item.id===id);
  openAssignment(id,assignment);
});


// ── FAQ accordion ────────────────────────────────────────────────────────────
// Binds to whatever .faq-item blocks exist in the markup, so adding a question
// is an HTML edit alone. One answer stays open at a time: on a page whose job
// is to be scanned, two open answers push the rest of the list off the screen.
$$('.faq-item').forEach(item=>{
  const question=item.querySelector('.faq-question');
  if(!question)return;
  question.addEventListener('click',()=>{
    const opening=question.getAttribute('aria-expanded')!=='true';
    $$('.faq-item.open').forEach(open=>{open.classList.remove('open');open.querySelector('.faq-question')?.setAttribute('aria-expanded','false')});
    item.classList.toggle('open',opening);
    question.setAttribute('aria-expanded',String(opening));
  });
});

// ── Contact form ─────────────────────────────────────────────────────────────
// Validation runs here for the immediate message and again on the server, which
// is the copy that decides. The form is marked novalidate so these messages
// appear in the page's own voice rather than the browser's bubble.
const contactForm=$('#contactForm');
if(contactForm){
  const contactError=$('#contactError'),contactSuccess=$('#contactSuccess'),contactButton=$('#contactSubmit');
  // Deliberately permissive: the address is checked properly by delivery, and a
  // clever pattern here only ever rejects somebody's real address.
  const looksLikeEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  const loadedAt=Date.now();
  const failValidation=(field,message)=>{
    contactError.textContent=message;
    field.setAttribute('aria-invalid','true');
    field.focus();
    return null;
  };
  const readContact=()=>{
    const fields={name:$('#contactName'),email:$('#contactEmail'),subject:$('#contactSubject'),message:$('#contactMessage')};
    Object.values(fields).forEach(field=>field.removeAttribute('aria-invalid'));
    const values=Object.fromEntries(Object.entries(fields).map(([key,field])=>[key,field.value.trim()]));
    if(values.name.length<2)return failValidation(fields.name,'Enter your full name.');
    if(!looksLikeEmail(values.email))return failValidation(fields.email,'Enter a valid email address so we can reply.');
    if(values.subject.length<2)return failValidation(fields.subject,'Add a short subject.');
    if(values.message.length<10)return failValidation(fields.message,'Tell us a little more — at least 10 characters.');
    return values;
  };
  contactForm.addEventListener('submit',async event=>{
    event.preventDefault();
    // The button is disabled for the whole request, so a second click during a
    // slow send cannot post the message twice.
    if(contactButton.disabled)return;
    contactError.textContent='';
    contactSuccess.hidden=true;
    const values=readContact();
    if(!values)return;
    setBusy(contactButton,true,'Sending…');
    try{
      await api('/api/contact',{method:'POST',body:JSON.stringify({...values,company:$('#contactCompany').value,elapsedMs:Date.now()-loadedAt})});
      contactForm.reset();
      contactSuccess.textContent='Thanks — your message is on its way. We reply to the address you gave us.';
      contactSuccess.hidden=false;
      showToast('Message sent');
    }catch(error){
      contactError.textContent=error.message;
    }finally{
      setBusy(contactButton,false);
    }
  });
}

// ── Help & support ───────────────────────────────────────────────────────────
// The same endpoint the public contact form posts to. Nothing here sends a name
// or address: the server takes both from the session, so a support message
// always carries the identity of the account that actually sent it.
const supportDialog=$('#supportDialog');
function openSupportDialog(){
  const form=$('#supportForm');
  form.reset();
  $('#supportError').textContent='';
  $('#supportSuccess').hidden=true;
  $('#supportReplyTo').textContent=state.user?.email
    ? `We reply to ${state.user.email}, the address on your account.`
    : 'We reply to the address on your account.';
  supportDialog.showModal();
  form.querySelector('[name="subject"]').focus();
}
if(supportDialog){
  $$('[data-close-support]').forEach(button=>button.addEventListener('click',()=>supportDialog.close()));
  $('#supportForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=$('#supportSubmit');
    if(button.disabled)return;
    const fields=new FormData(event.currentTarget);
    const subject=String(fields.get('subject')||'').trim(),message=String(fields.get('message')||'').trim();
    $('#supportError').textContent='';
    if(subject.length<2)return void($('#supportError').textContent='Add a short subject.');
    if(message.length<10)return void($('#supportError').textContent='Tell us a little more — at least 10 characters.');
    setBusy(button,true,'Sending…');
    try{
      await api('/api/contact',{method:'POST',body:JSON.stringify({subject,message})});
      supportDialog.close();
      showToast('Thanks — your message reached support');
    }catch(error){
      $('#supportError').textContent=error.message;
    }finally{
      setBusy(button,false);
    }
  });
}
