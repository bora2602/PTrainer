/* Workouts — both halves of the coaching loop.

   Trainer: Create workout → add exercises with sets, reps, weight and rest →
   Done. The workout lands in the library, assigned to nobody. From there
   Assign picks one client or several and a start date.

   Client: the Workouts tab lists today first. Start opens the workout with a
   running clock and every set pre-filled from the trainer's prescription; the
   client corrects what they actually did, ticks each set, and presses Done.

   Trainer again: the client's page lists what was completed, and opening a
   session shows every set exactly as it was logged, and how long it took.

   Loaded after app.js and relies on its helpers ($, $$, api, state, escapeText,
   showToast, setBusy, switchView, selectedClient, initials, formatDate,
   calendarKey, trimNumber). */

const WEIGHT_UNITS = ['kg', 'lb'];
const todayKey = () => calendarKey(new Date());
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function formatDuration(seconds) {
  if (seconds == null) return '';
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return `${hours} h ${minutes} min`;
  return minutes ? `${minutes} min` : `${seconds} sec`;
}
function clockText(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = seconds % 60;
  const pad = value => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${pad(minutes)}:${pad(rest)}`;
}
function prescriptionText(exercise) {
  let text = `${exercise.sets} × ${exercise.reps}`;
  if (exercise.targetLoad != null) text += ` @ ${trimNumber(exercise.targetLoad)} ${exercise.loadUnit}`;
  return exercise.restSeconds ? `${text} · rest ${exercise.restSeconds}s` : text;
}
// Dates travel as YYYY-MM-DD in the viewer's own zone (see calendarDate in
// app.js), so they are compared as text and only formatted for display.
function dueLabel(dueDate) {
  if (!dueDate) return 'No date';
  const today = todayKey();
  if (dueDate === today) return 'Today';
  const tomorrow = calendarKey(new Date(Date.now() + 86400000));
  if (dueDate === tomorrow) return 'Tomorrow';
  return calendarDate(dueDate).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ── Exercise picker ─────────────────────────────────────────────────────────
   One library: the platform catalog plus the trainer's own exercises, which
   appear and behave exactly like the built-in ones. A name with no match can be
   saved as a new exercise from right here, and is then reusable everywhere. */
async function getExerciseCatalog() {
  if (state.exerciseCatalog) return state.exerciseCatalog;
  const data = await api('/api/exercises?limit=1000');
  state.exerciseCatalog = data.exercises || [];
  return state.exerciseCatalog;
}
async function createOwnExercise(name) {
  const created = await api('/api/exercises', { method: 'POST', body: JSON.stringify({ name }) });
  if (state.exerciseCatalog) state.exerciseCatalog = [...state.exerciseCatalog, created.exercise].sort((a, b) => a.name.localeCompare(b.name));
  renderOwnExercises();
  return created.exercise;
}
function wireExerciseCatalog(row) {
  const input = row.querySelector('[name="exerciseName"]'), results = row.querySelector('.exercise-catalog-results');
  const choose = item => { input.value = item.name; input.dataset.exerciseId = item.id; results.hidden = true; row.querySelector('[name="sets"]').focus(); };
  async function render() {
    results.hidden = false;
    results.innerHTML = '<span class="exercise-catalog-empty">Loading exercises…</span>';
    let catalog;
    try { catalog = await getExerciseCatalog(); }
    catch (error) { results.innerHTML = `<span class="exercise-catalog-empty">${escapeText(error.message)} — you can still type a name.</span>`; return; }
    const term = input.value.trim().toLocaleLowerCase();
    const exact = catalog.find(item => item.name.toLocaleLowerCase() === term);
    input.dataset.exerciseId = exact ? exact.id : '';
    const matches = catalog.filter(item => !term || [item.name, item.muscleGroup, item.equipment].some(value => String(value || '').toLocaleLowerCase().includes(term)))
      // The trainer's own exercises first: they are the ones typed for.
      .sort((a, b) => Number(b.canManage) - Number(a.canManage))
      .slice(0, 8);
    const offerCreate = term.length >= 2 && !exact;
    results.innerHTML = matches.map(item => `<button type="button" role="option" data-exercise-choice="${escapeText(item.id)}"><strong>${escapeText(item.name)}${item.canManage ? ' <span class="own-tag">Yours</span>' : ''}</strong><small>${escapeText([item.muscleGroup, item.equipment].filter(Boolean).join(' · ') || 'Your exercise')}</small></button>`).join('')
      + (offerCreate ? `<button type="button" class="create-exercise-choice" data-exercise-create><strong>＋ Save “${escapeText(input.value.trim())}” as a new exercise</strong><small>Only you can see it, and you can reuse it in any workout</small></button>` : '')
      || '<span class="exercise-catalog-empty">Type to search 190+ exercises, or name a new one.</span>';
    results.querySelectorAll('[data-exercise-choice]').forEach(button => button.addEventListener('mousedown', event => {
      event.preventDefault();
      choose(catalog.find(item => item.id === button.dataset.exerciseChoice));
    }));
    results.querySelector('[data-exercise-create]')?.addEventListener('mousedown', async event => {
      event.preventDefault();
      const name = input.value.trim();
      try { choose(await createOwnExercise(name)); showToast(`“${name}” saved to your exercises`); }
      catch (error) {
        // It may already exist under a different capitalisation.
        if (error.code === 'EXERCISE_EXISTS') { state.exerciseCatalog = null; render(); }
        showToast(error.message);
      }
    });
  }
  input.addEventListener('focus', render);
  input.addEventListener('input', render);
  input.addEventListener('keydown', event => { if (event.key === 'Escape') results.hidden = true; });
  input.addEventListener('blur', () => setTimeout(() => { results.hidden = true; }, 150));
}

/* ── Exercise rows (shared by the workout builder and the assignment editor) ── */
function exerciseRowMarkup(values = {}, index = 0) {
  const unit = values.loadUnit || state.lastLoadUnit || 'kg';
  return `<div class="builder-exercise-top"><span class="builder-index" aria-hidden="true">${index + 1}</span><div class="exercise-name-field"><label>Exercise<input name="exerciseName" maxlength="100" value="${escapeText(values.name || '')}" data-exercise-id="${escapeText(values.exerciseId || '')}" placeholder="Search, or type a new exercise" autocomplete="off" required /></label><div class="exercise-catalog-results" role="listbox" aria-label="Exercise matches" hidden></div></div><button type="button" class="remove-exercise" aria-label="Remove exercise">×</button></div>`
    + `<div class="builder-exercise-grid"><label>Sets<input name="sets" type="number" inputmode="numeric" min="1" max="20" value="${values.sets || 3}" required /></label><label>Reps<input name="reps" type="number" inputmode="numeric" min="1" max="1000" value="${values.reps || 10}" required /></label><label class="weight-field">Weight<span class="weight-input"><input name="targetLoad" type="number" inputmode="decimal" min="0" max="10000" step="0.5" value="${values.targetLoad ?? ''}" placeholder="—" /><select name="loadUnit" aria-label="Weight unit">${WEIGHT_UNITS.map(option => `<option${option === unit ? ' selected' : ''}>${option}</option>`).join('')}</select></span></label><label>Rest (sec)<input name="rest" type="number" inputmode="numeric" min="0" max="900" step="15" value="${values.restSeconds ?? 60}" required /></label></div>`
    + `<label class="builder-note">Coaching note<input name="note" maxlength="200" value="${escapeText(values.note || '')}" placeholder="Optional, e.g. pause at the bottom" /></label>`;
}
function renumberExerciseRows(container) {
  [...container.querySelectorAll('.builder-index')].forEach((badge, index) => { badge.textContent = index + 1; });
}
function addExerciseRow(container, values = {}) {
  const row = document.createElement('div');
  row.className = 'builder-exercise';
  row.innerHTML = exerciseRowMarkup(values, container.children.length);
  row.querySelector('.remove-exercise').addEventListener('click', () => {
    if (container.children.length === 1) return showToast('A workout needs at least one exercise');
    row.remove(); renumberExerciseRows(container);
  });
  row.querySelector('[name="loadUnit"]').addEventListener('change', event => { state.lastLoadUnit = event.target.value; });
  wireExerciseCatalog(row);
  container.append(row);
  return row;
}
function readExerciseRows(container) {
  return [...container.querySelectorAll('.builder-exercise')].map(row => {
    const field = name => row.querySelector(`[name="${name}"]`);
    const load = field('targetLoad').value.trim();
    return {
      name: field('exerciseName').value.trim(),
      exerciseId: field('exerciseName').dataset.exerciseId || null,
      sets: Number(field('sets').value), reps: Number(field('reps').value), restSeconds: Number(field('rest').value),
      targetLoad: load === '' ? null : Number(load), loadUnit: load === '' ? null : field('loadUnit').value,
      note: field('note').value.trim()
    };
  });
}

/* ── Trainer: workout library ────────────────────────────────────────────── */
async function loadTemplates() {
  if (state.user?.role !== 'TRAINER') return;
  try {
    const result = await api('/api/workout-templates');
    state.workoutTemplates = result.templates || [];
    renderTemplates();
  } catch (error) {
    $('#templateList').innerHTML = `<div class="template-item"><span>${escapeText(error.message)}</span></div>`;
  }
}
function renderTemplates(highlightId = null) {
  const templates = [...state.workoutTemplates].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  $('#templateCount').textContent = templates.length ? plural(templates.length, 'workout') : '';
  $('#templateList').innerHTML = templates.length ? templates.map(template => `<article class="workout-card${template.id === highlightId ? ' just-saved' : ''}" data-template-card="${escapeText(template.id)}">
      <div class="workout-card-body"><h3>${escapeText(template.name)}</h3><p>${plural(template.exercises.length, 'exercise')}${template.description ? ` · ${escapeText(template.description)}` : ''}</p>
      <ul class="workout-card-exercises">${template.exercises.slice(0, 4).map(exercise => `<li><span>${escapeText(exercise.name)}</span><small>${escapeText(prescriptionText(exercise))}</small></li>`).join('')}${template.exercises.length > 4 ? `<li class="more-exercises">+ ${template.exercises.length - 4} more</li>` : ''}</ul></div>
      <div class="workout-card-actions"><button class="primary-button" data-assign-template="${escapeText(template.id)}">Assign</button><button class="secondary-button" data-edit-template="${escapeText(template.id)}">Edit</button><details class="card-menu"><summary aria-label="More actions for ${escapeText(template.name)}">•••</summary><div class="card-menu-items"><button type="button" data-duplicate-template="${escapeText(template.id)}">Duplicate</button><button type="button" class="danger" data-delete-template="${escapeText(template.id)}">Delete</button></div></details></div>
    </article>`).join('')
    : '<div class="panel empty-state"><h2>No workouts yet</h2><p>Create a workout once, then assign it to any of your clients — as often as you like.</p><button class="primary-button" data-create-workout>＋ Create workout</button></div>';
  if (highlightId) $(`[data-template-card="${highlightId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
$('#templateList').addEventListener('click', async event => {
  const target = event.target.closest('button');
  if (!target) return;
  const { assignTemplate, editTemplate, duplicateTemplate, deleteTemplate } = target.dataset;
  if (target.hasAttribute('data-create-workout')) return openTemplateDialog();
  if (assignTemplate) return openAssignDialog({ templateId: assignTemplate });
  if (editTemplate) return openTemplateDialog(state.workoutTemplates.find(item => item.id === editTemplate));
  target.closest('details')?.removeAttribute('open');
  try {
    if (duplicateTemplate) {
      const copy = await api(`/api/workout-templates/${encodeURIComponent(duplicateTemplate)}/duplicate`, { method: 'POST', body: '{}' });
      state.workoutTemplates.push(copy.template); renderTemplates(copy.template.id); showToast('Workout duplicated');
    }
    if (deleteTemplate) {
      const template = state.workoutTemplates.find(item => item.id === deleteTemplate);
      if (!confirm(`Delete “${template?.name}”? Clients who already have it keep their copy.`)) return;
      await api(`/api/workout-templates/${encodeURIComponent(deleteTemplate)}`, { method: 'DELETE', body: '{}' });
      state.workoutTemplates = state.workoutTemplates.filter(item => item.id !== deleteTemplate);
      renderTemplates(); showToast('Workout deleted. Assignments already made are unaffected.');
    }
  } catch (error) { showToast(error.message); }
});
$('#newTemplateButton').addEventListener('click', () => openTemplateDialog());

/* ── Trainer: Create / edit workout window ───────────────────────────────── */
const templateDialog = $('#templateDialog'), templateForm = $('#templateForm');
let templateDirty = false;
function openTemplateDialog(template = null) {
  templateForm.reset();
  templateForm.dataset.templateId = template?.id || '';
  $('#templateError').textContent = '';
  $('#templateDialogTitle').textContent = template ? 'Edit workout' : 'Create workout';
  $('#templateDialogHelp').textContent = template ? 'Changes apply to future assignments. Workouts already assigned keep the version they were given.' : 'Add the exercises and targets, then press Done. You can assign it to clients afterwards.';
  const list = $('#builderExercises');
  list.innerHTML = '';
  (template?.exercises?.length ? template.exercises : [{}]).forEach(exercise => addExerciseRow(list, exercise));
  if (template) { templateForm.elements.name.value = template.name; templateForm.elements.description.value = template.description || ''; }
  templateDirty = false;
  templateDialog.showModal();
  templateForm.elements.name.focus();
}
function closeTemplateDialog() {
  if (templateDirty && !confirm('Discard this workout? What you entered will be lost.')) return;
  templateDialog.close();
}
templateForm.addEventListener('input', () => { templateDirty = true; });
$('#addExerciseButton').addEventListener('click', () => {
  const list = $('#builderExercises'), last = readExerciseRows(list).at(-1);
  // A new row starts from the previous one's shape, which is usually right.
  const row = addExerciseRow(list, last ? { sets: last.sets, reps: last.reps, restSeconds: last.restSeconds, loadUnit: last.loadUnit || state.lastLoadUnit } : {});
  row.querySelector('[name="exerciseName"]').focus();
});
$$('[data-close-template]').forEach(button => button.addEventListener('click', closeTemplateDialog));
templateDialog.addEventListener('cancel', event => { event.preventDefault(); closeTemplateDialog(); });
templateForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveTemplateButton'), editingId = templateForm.dataset.templateId;
  const exercises = readExerciseRows($('#builderExercises'));
  $('#templateError').textContent = '';
  if (exercises.some(exercise => exercise.name.length < 2)) return void ($('#templateError').textContent = 'Every exercise needs a name.');
  setBusy(button, true, 'Saving…');
  try {
    const payload = { name: templateForm.elements.name.value, description: templateForm.elements.description.value, exercises };
    const result = await api(editingId ? `/api/workout-templates/${encodeURIComponent(editingId)}` : '/api/workout-templates', { method: editingId ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    state.workoutTemplates = [...state.workoutTemplates.filter(item => item.id !== result.template.id), result.template];
    templateDirty = false;
    templateDialog.close();
    if ($('.page.active-view')?.id !== 'builder-view') switchView('builder');
    renderTemplates(result.template.id);
    showToast(editingId ? 'Workout updated' : `“${result.template.name}” saved. Press Assign to give it to clients.`, 5000);
  } catch (error) { $('#templateError').textContent = error.message; }
  finally { setBusy(button, false); }
});

/* ── Trainer: Assign window ──────────────────────────────────────────────── */
const assignDialog = $('#assignDialog'), assignForm = $('#assignForm');
function selectedAssignClients() { return $$('#assignClientList input[name="clients"]:checked').map(box => box.value); }
function updateAssignSubmit() {
  const count = selectedAssignClients().length, total = $$('#assignClientList input[name="clients"]').length;
  $('#assignSubmit').textContent = count ? `Assign to ${plural(count, 'client')}` : 'Choose a client';
  $('#assignSubmit').disabled = !count;
  $('#assignSelectAll').checked = count > 0 && count === total;
  $('#assignSelectAll').indeterminate = count > 0 && count < total;
}
function updateAssignRepeat() {
  const repeating = $('#assignFrequency').value !== 'ONCE';
  $('#assignEndField').hidden = !repeating;
  $('#assignEnd').required = repeating;
  if (repeating && !$('#assignEnd').value) {
    const start = calendarDate($('#assignStart').value || todayKey());
    $('#assignEnd').value = calendarKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 27));
  }
}
async function openAssignDialog({ templateId = null, clientId = null } = {}) {
  if (!state.trainerClients.length) return showToast('Invite a client first, then you can assign them workouts.');
  if (!state.workoutTemplates.length) await loadTemplates();
  if (!state.workoutTemplates.length) {
    showToast('Create a workout first, then assign it.');
    return openTemplateDialog();
  }
  assignForm.reset();
  $('#assignError').textContent = '';
  const template = templateId && state.workoutTemplates.find(item => item.id === templateId);
  $('#assignTemplateField').hidden = Boolean(template);
  $('#assignTemplate').innerHTML = [...state.workoutTemplates].sort((a, b) => a.name.localeCompare(b.name)).map(item => `<option value="${escapeText(item.id)}">${escapeText(item.name)} · ${plural(item.exercises.length, 'exercise')}</option>`).join('');
  if (template) $('#assignTemplate').value = template.id;
  $('#assignDialogTitle').textContent = template ? `Assign “${template.name}”` : 'Assign a workout';
  $('#assignClientList').innerHTML = state.trainerClients.map(client => `<label class="assign-client"><input type="checkbox" name="clients" value="${escapeText(client.id)}"${client.id === clientId ? ' checked' : ''} /><span class="client-avatar lavender" aria-hidden="true">${initials(client.name)}</span><span><strong>${escapeText(client.name)}</strong><small>${escapeText(client.email)}</small></span></label>`).join('');
  $('#assignSelectAll').closest('label').hidden = state.trainerClients.length < 2;
  $('#assignStart').value = todayKey();
  $('#assignFrequency').value = 'ONCE';
  $('#assignEnd').value = '';
  updateAssignRepeat();
  updateAssignSubmit();
  assignDialog.showModal();
}
$('#assignClientList').addEventListener('change', updateAssignSubmit);
$('#assignSelectAll').addEventListener('change', event => { $$('#assignClientList input[name="clients"]').forEach(box => { box.checked = event.target.checked; }); updateAssignSubmit(); });
$('#assignFrequency').addEventListener('change', updateAssignRepeat);
$$('[data-close-assign]').forEach(button => button.addEventListener('click', () => assignDialog.close()));
assignForm.addEventListener('submit', async event => {
  event.preventDefault();
  const traineeIds = selectedAssignClients(), frequency = $('#assignFrequency').value, button = $('#assignSubmit');
  const templateId = $('#assignTemplate').value, template = state.workoutTemplates.find(item => item.id === templateId);
  $('#assignError').textContent = '';
  setBusy(button, true, 'Assigning…');
  try {
    const result = await api('/api/assigned-workouts', { method: 'POST', body: JSON.stringify({ templateId, traineeIds, startDate: $('#assignStart').value, frequency, ...(frequency !== 'ONCE' ? { endDate: $('#assignEnd').value } : {}) }) });
    assignDialog.close();
    const names = state.trainerClients.filter(client => traineeIds.includes(client.id)).map(client => client.name.split(' ')[0]);
    const who = names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
    const sessions = result.assignments?.length || traineeIds.length;
    showToast(sessions > traineeIds.length ? `“${template?.name}” scheduled for ${who} — ${plural(sessions, 'session')}` : `“${template?.name}” assigned to ${who}`, 5000);
    await Promise.all([loadDashboard(), $('.page.active-view')?.id === 'client-view' ? loadClientPage() : null]);
  } catch (error) { $('#assignError').textContent = error.message; }
  finally { setBusy(button, false); updateAssignSubmit(); }
});

/* ── Trainer: own exercises ──────────────────────────────────────────────── */
async function loadOwnExercises() {
  if (state.user?.role !== 'TRAINER') return;
  try { state.exerciseCatalog = null; await getExerciseCatalog(); renderOwnExercises(); }
  catch (error) { $('#ownExerciseList').innerHTML = `<div class="template-item"><span>${escapeText(error.message)}</span></div>`; }
}
function renderOwnExercises() {
  const owned = (state.exerciseCatalog || []).filter(item => item.canManage);
  $('#ownExerciseCount').textContent = owned.length ? `(${owned.length})` : '';
  $('#ownExerciseList').innerHTML = owned.map(item => `<article class="note-row" data-own-exercise="${escapeText(item.id)}"><div><p>${escapeText(item.name)}</p><small>${escapeText([item.muscleGroup, item.equipment].filter(Boolean).join(' · ') || 'No details yet')}</small></div><div class="note-actions"><button class="secondary-button" data-exercise-edit="${escapeText(item.id)}">Edit</button><button class="secondary-button" data-exercise-retire="${escapeText(item.id)}">Remove</button></div></article>`).join('')
    || '<div class="template-item"><span>None yet. Add one here, or type a new name while building a workout.</span></div>';
}
$('#ownExerciseList').addEventListener('click', async event => {
  const button = event.target.closest('button');
  if (!button) return;
  const exercise = (state.exerciseCatalog || []).find(item => item.id === (button.dataset.exerciseEdit || button.dataset.exerciseRetire));
  if (!exercise) return;
  try {
    if (button.dataset.exerciseRetire) {
      if (!confirm(`Remove “${exercise.name}” from your exercises? Workouts that already use it keep it.`)) return;
      await api(`/api/exercises/${encodeURIComponent(exercise.id)}`, { method: 'DELETE', body: '{}' });
      showToast('Exercise removed');
    } else {
      const form = $('#exerciseForm');
      form.dataset.editing = exercise.id;
      form.elements.name.value = exercise.name; form.elements.muscleGroup.value = exercise.muscleGroup || ''; form.elements.equipment.value = exercise.equipment || '';
      $('#exerciseSubmit').textContent = 'Save changes';
      form.elements.name.focus();
      return;
    }
    await loadOwnExercises();
  } catch (error) { showToast(error.message); }
});
$('#exerciseForm').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, editing = form.dataset.editing;
  $('#exerciseError').textContent = '';
  const payload = { name: form.elements.name.value, muscleGroup: form.elements.muscleGroup.value, equipment: form.elements.equipment.value };
  try {
    await api(editing ? `/api/exercises/${encodeURIComponent(editing)}` : '/api/exercises', { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) });
    form.reset(); delete form.dataset.editing; $('#exerciseSubmit').textContent = 'Add exercise';
    await loadOwnExercises();
    showToast(editing ? 'Exercise updated' : 'Exercise added. It now shows up when you build a workout.');
  } catch (error) { $('#exerciseError').textContent = error.message; }
});

/* ── Loading assignments ─────────────────────────────────────────────────────
   The list is paged by creation order, and a recurring program creates many
   rows at once, so "today" can sit anywhere in it. A dated window around today
   finds everything that is due; the default page adds work with no date. */
async function fetchAssignments(traineeId = null) {
  const now = new Date(), from = calendarKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)), to = calendarKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 90));
  const scope = traineeId ? `&traineeId=${encodeURIComponent(traineeId)}` : '';
  const [dated, recent] = await Promise.all([api(`/api/assigned-workouts?from=${from}&to=${to}&limit=200${scope}`), api(`/api/assigned-workouts?limit=100${scope}`)]);
  const byId = new Map();
  for (const item of [...dated.assignments, ...recent.assignments]) byId.set(item.id, item);
  return [...byId.values()];
}
function splitAssignments(assignments) {
  const today = todayKey(), open = item => item.status === 'ASSIGNED' || item.status === 'IN_PROGRESS';
  const byDue = (a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'));
  return {
    today: assignments.filter(item => open(item) && item.dueDate === today).sort(byDue),
    overdue: assignments.filter(item => open(item) && item.dueDate && item.dueDate < today).sort(byDue).reverse(),
    upcoming: assignments.filter(item => open(item) && (!item.dueDate || item.dueDate > today)).sort(byDue),
    done: assignments.filter(item => item.status === 'COMPLETED').sort((a, b) => String(b.latestLog?.finishedAt || b.dueDate || '').localeCompare(String(a.latestLog?.finishedAt || a.dueDate || '')))
  };
}
function sessionRow(item, { action = '' } = {}) {
  const snapshot = item.templateSnapshot, count = snapshot.exercises.length;
  const done = item.status === 'COMPLETED', started = item.status === 'IN_PROGRESS';
  const meta = done
    ? [`${item.latestLog ? `${item.latestLog.completedCount} of ${count}` : count} exercises done`, item.latestLog?.durationSeconds != null ? formatDuration(item.latestLog.durationSeconds) : ''].filter(Boolean).join(' · ')
    : `${plural(count, 'exercise')}${started ? ' · in progress' : ''}`;
  const overdue = !done && item.dueDate && item.dueDate < todayKey();
  return `<article class="session-row${done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}">
    <button class="session-row-main" data-open-session="${escapeText(item.id)}"><span class="session-date"><strong>${escapeText(dueLabel(item.dueDate))}</strong>${overdue ? '<small>Overdue</small>' : done ? '<small>Done</small>' : ''}</span><span class="session-text"><strong>${escapeText(snapshot.name)}</strong><small>${escapeText(meta)}</small></span><span class="session-chevron" aria-hidden="true">›</span></button>
    ${action}
  </article>`;
}

/* ── Client: Workouts list ───────────────────────────────────────────────── */
async function loadAssignments() {
  if (state.user?.role !== 'TRAINEE') return;
  if (session.assignment) return; // a workout is open; leave it alone
  try {
    state.traineeAssignments = await fetchAssignments();
    renderTraineeWorkouts();
  } catch (error) {
    $('#todayWorkouts').innerHTML = `<div class="template-item"><span>${escapeText(error.message)}</span></div>`;
  }
}
function renderTraineeWorkouts() {
  const groups = splitAssignments(state.traineeAssignments || []);
  const startButton = (item, primary = false) => `<button class="${primary ? 'primary-button' : 'secondary-button'} session-start" data-start-session="${escapeText(item.id)}">${item.status === 'IN_PROGRESS' ? 'Resume' : 'Start'}</button>`;
  const todayItems = [...groups.today, ...groups.overdue.slice(0, 3)];
  $('#todayWorkouts').innerHTML = todayItems.length
    ? todayItems.map(item => sessionRow(item, { action: startButton(item, item.dueDate === todayKey()) })).join('')
    : `<div class="empty-inline"><strong>Nothing due today.</strong><span>${groups.upcoming[0] ? `Next up: ${escapeText(groups.upcoming[0].templateSnapshot.name)}, ${escapeText(dueLabel(groups.upcoming[0].dueDate).toLowerCase())}.` : 'Your trainer has not scheduled anything yet.'}</span></div>`;
  const todayCount = groups.today.length;
  $('#workoutListIntro').textContent = todayCount ? `You have ${plural(todayCount, 'workout')} to do today.` : 'Your schedule from your trainer.';
  $('#upcomingWorkouts').innerHTML = groups.upcoming.slice(0, 12).map(item => sessionRow(item, { action: startButton(item) })).join('') || '<div class="empty-inline"><span>Nothing else scheduled.</span></div>';
  $('#historyWorkouts').innerHTML = groups.done.slice(0, 20).map(item => sessionRow(item)).join('') || '<div class="empty-inline"><span>Finished workouts appear here.</span></div>';
}
$('#workoutListView').addEventListener('click', event => {
  const start = event.target.closest('[data-start-session]');
  if (start) return openSession(start.dataset.startSession, { start: true });
  const open = event.target.closest('[data-open-session]');
  if (!open) return;
  const item = (state.traineeAssignments || []).find(entry => entry.id === open.dataset.openSession);
  if (item?.status === 'COMPLETED') openSessionDetail(item);
  else openSession(open.dataset.openSession, { start: false });
});

/* ── Client: the workout itself ──────────────────────────────────────────── */
const session = { assignment: null, exercises: [], startedAt: null, timer: null, saveTimer: null };
const blankSet = (exercise, prefill) => ({
  // The trainer's numbers are a starting point for the person lifting, who
  // corrects them to what actually happened. Nothing counts until ticked.
  reps: prefill ? exercise.reps : null,
  loadValue: prefill && exercise.targetLoad != null ? exercise.targetLoad : null,
  loadUnit: exercise.loadUnit || state.lastLoadUnit || 'kg',
  exertion: null, completed: false, painFlag: false, note: ''
});
function sessionSets({ completedOnly = false } = {}) {
  const rows = [];
  session.exercises.forEach((exercise, exerciseIndex) => exercise.sets.forEach((set, setIndex) => {
    if (completedOnly && !set.completed) return;
    const load = set.loadValue === '' || set.loadValue == null ? null : Number(set.loadValue);
    rows.push({ exerciseIndex, setIndex, completed: Boolean(set.completed), reps: set.reps === '' || set.reps == null ? null : Number(set.reps), loadValue: load, loadUnit: load === null ? null : set.loadUnit, exertion: set.exertion === '' || set.exertion == null ? null : Number(set.exertion), painFlag: Boolean(set.painFlag), note: String(set.note || '') });
  }));
  return rows;
}
async function openSession(assignmentId, { start = false } = {}) {
  const assignment = (state.traineeAssignments || []).find(item => item.id === assignmentId);
  if (!assignment) return showToast('That workout is no longer available.');
  if (assignment.status === 'COMPLETED') return openSessionDetail(assignment);
  session.assignment = assignment;
  session.startedAt = null;
  session.exercises = assignment.templateSnapshot.exercises.map(exercise => ({ ...exercise, sets: Array.from({ length: exercise.sets }, () => blankSet(exercise, true)) }));
  // A workout opened again carries on from the saved draft, clock included.
  try {
    const history = await api(`/api/assigned-workouts/${encodeURIComponent(assignmentId)}/logs`);
    const draft = history.logs.find(log => log.status === 'DRAFT');
    if (draft) {
      session.startedAt = draft.startedAt ? new Date(draft.startedAt) : null;
      for (const row of draft.sets) {
        const exercise = session.exercises[row.exercise_index];
        if (!exercise) continue;
        while (exercise.sets.length <= row.set_index) exercise.sets.push(blankSet(exercise, false));
        exercise.sets[row.set_index] = { reps: row.reps, loadValue: row.load_value, loadUnit: row.load_unit || exercise.loadUnit || 'kg', exertion: row.exertion, completed: row.completed, painFlag: row.pain_flag, note: row.note || '' };
      }
    }
  } catch { /* the logger still opens without history */ }
  $('#workoutListView').hidden = true;
  $('#workoutSessionView').hidden = false;
  document.body.classList.add('in-session');
  $('#sessionName').textContent = assignment.templateSnapshot.name;
  $('#sessionMeta').textContent = [dueLabel(assignment.dueDate), assignment.templateSnapshot.description].filter(Boolean).join(' · ');
  renderSession();
  if (start && !session.startedAt) {
    session.startedAt = new Date();
    saveDraft(true);
  }
  startSessionClock();
  window.scrollTo({ top: 0 });
}
function startSessionClock() {
  clearInterval(session.timer);
  const tick = () => {
    const clock = $('#sessionTimer');
    if (!session.startedAt) { clock.textContent = 'Not started'; $('#sessionStartButton').hidden = false; return; }
    $('#sessionStartButton').hidden = true;
    clock.textContent = clockText((Date.now() - session.startedAt.getTime()) / 1000);
  };
  tick();
  session.timer = setInterval(tick, 1000);
}
function closeSession() {
  clearInterval(session.timer);
  clearTimeout(session.saveTimer);
  session.assignment = null;
  $('#workoutSessionView').hidden = true;
  $('#workoutListView').hidden = false;
  document.body.classList.remove('in-session');
  loadAssignments();
}
function saveDraft(immediate = false) {
  if (!session.assignment) return;
  clearTimeout(session.saveTimer);
  $('#workoutSaveState').textContent = 'Saving…';
  const assignmentId = session.assignment.id;
  session.saveTimer = setTimeout(async () => {
    try {
      const result = await api(`/api/assigned-workouts/${encodeURIComponent(assignmentId)}/logs`, { method: 'PATCH', body: JSON.stringify({ sets: sessionSets(), ...(session.startedAt ? { startedAt: session.startedAt.toISOString() } : {}) }) });
      if (result.draft.startedAt && session.assignment?.id === assignmentId) session.startedAt = new Date(result.draft.startedAt);
      $('#workoutSaveState').textContent = 'Saved';
    } catch (error) { $('#workoutSaveState').textContent = `Not saved — ${error.message}`; }
  }, immediate ? 0 : 700);
}
function setRowMarkup(exerciseIndex, set, setIndex) {
  const value = field => set[field] == null ? '' : escapeText(set[field]);
  return `<div class="set-row${set.completed ? ' is-done' : ''}" data-exercise="${exerciseIndex}" data-set="${setIndex}">
    <span class="set-number" aria-hidden="true">${setIndex + 1}</span>
    <label class="set-cell"><span>Reps</span><input data-field="reps" type="number" inputmode="numeric" min="0" max="1000" value="${value('reps')}" aria-label="Set ${setIndex + 1} reps" /></label>
    <label class="set-cell"><span>${escapeText(set.loadUnit)}</span><input data-field="loadValue" type="number" inputmode="decimal" min="0" max="100000" step="0.5" value="${value('loadValue')}" aria-label="Set ${setIndex + 1} weight in ${escapeText(set.loadUnit)}" /></label>
    <label class="set-cell"><span>RPE</span><input data-field="exertion" type="number" inputmode="decimal" min="1" max="10" step="0.5" value="${value('exertion')}" placeholder="–" aria-label="Set ${setIndex + 1} effort, 1 to 10" /></label>
    <button type="button" class="set-note-toggle${set.note ? ' has-note' : ''}" aria-label="Note for set ${setIndex + 1}" aria-expanded="false">✎</button>
    <button type="button" class="set-check" aria-pressed="${set.completed}" aria-label="Set ${setIndex + 1} done">✓</button>
    <label class="set-note" hidden><span class="sr-only">Note for set ${setIndex + 1}</span><input data-field="note" type="text" maxlength="500" value="${value('note')}" placeholder="How did it feel?" /></label>
  </div>`;
}
function renderSession() {
  $('#exerciseList').innerHTML = session.exercises.map((exercise, index) => `<article class="exercise-card session-exercise" data-exercise-card="${index}">
      <header><div><h2>${escapeText(exercise.name)}</h2><p>${escapeText(prescriptionText(session.assignment.templateSnapshot.exercises[index]))}</p>${exercise.note ? `<p class="coach-cue">Coach: ${escapeText(exercise.note)}</p>` : ''}</div></header>
      <div class="set-rows">${exercise.sets.map((set, setIndex) => setRowMarkup(index, set, setIndex)).join('')}</div>
      <button type="button" class="text-button add-set" data-add-set="${index}">＋ Add set</button>
    </article>`).join('');
  updateSessionProgress();
}
function updateSessionProgress() {
  const sets = session.exercises.flatMap(exercise => exercise.sets), done = sets.filter(set => set.completed).length;
  $('#sessionSetCount').textContent = `${done} of ${plural(sets.length, 'set')} done`;
  $('#sessionProgressBar').style.width = `${sets.length ? Math.round(done / sets.length * 100) : 0}%`;
}
$('#exerciseList').addEventListener('click', event => {
  const row = event.target.closest('.set-row');
  const addSet = event.target.closest('[data-add-set]');
  if (addSet) {
    const exercise = session.exercises[addSet.dataset.addSet], previous = exercise.sets.at(-1);
    exercise.sets.push({ ...blankSet(exercise, true), ...(previous ? { reps: previous.reps, loadValue: previous.loadValue, loadUnit: previous.loadUnit } : {}) });
    renderSession(); saveDraft();
    return;
  }
  if (!row) return;
  const set = session.exercises[row.dataset.exercise].sets[row.dataset.set];
  if (event.target.closest('.set-check')) {
    set.completed = !set.completed;
    row.classList.toggle('is-done', set.completed);
    event.target.closest('.set-check').setAttribute('aria-pressed', String(set.completed));
    updateSessionProgress(); saveDraft();
  }
  if (event.target.closest('.set-note-toggle')) {
    const note = row.querySelector('.set-note'), toggle = event.target.closest('.set-note-toggle');
    note.hidden = !note.hidden;
    toggle.setAttribute('aria-expanded', String(!note.hidden));
    if (!note.hidden) note.querySelector('input').focus();
  }
});
// Edits update in place: re-rendering mid-set would pull the field out from
// under the thumb that is typing in it.
$('#exerciseList').addEventListener('change', event => {
  const input = event.target.closest('[data-field]'), row = event.target.closest('.set-row');
  if (!input || !row) return;
  const set = session.exercises[row.dataset.exercise].sets[row.dataset.set], field = input.dataset.field;
  set[field] = field === 'note' ? input.value : input.value === '' ? null : Number(input.value);
  if (field === 'note') row.querySelector('.set-note-toggle').classList.toggle('has-note', Boolean(input.value));
  saveDraft();
});
$('#sessionStartButton').addEventListener('click', () => { session.startedAt = new Date(); saveDraft(true); startSessionClock(); });
$('#leaveSession').addEventListener('click', () => {
  // Nothing is lost by leaving: the draft is saved as it goes.
  if (session.saveTimer) saveDraft(true);
  closeSession();
});
$('#finishWorkout').addEventListener('click', async event => {
  const button = event.currentTarget, done = sessionSets({ completedOnly: true }), total = session.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0);
  if (!done.length) return showToast('Tick the sets you did first. To stop for now, go back — your progress is saved.', 5000);
  if (done.length < total && !confirm(`You ticked ${done.length} of ${total} sets. Finish the workout?`)) return;
  setBusy(button, true, 'Saving…');
  try {
    clearTimeout(session.saveTimer);
    const key = `workout_${Date.now()}_${crypto.randomUUID().replaceAll('-', '')}`;
    const data = await api(`/api/assigned-workouts/${encodeURIComponent(session.assignment.id)}/logs`, { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify({ sets: done, ...(session.startedAt ? { startedAt: session.startedAt.toISOString() } : {}) }) });
    const name = session.assignment.templateSnapshot.name;
    closeSession();
    showToast(`${name} done${data.log.durationSeconds != null ? ` in ${formatDuration(data.log.durationSeconds)}` : ''}. Your trainer can see every set.`, 5000);
    loadDashboard();
  } catch (error) { showToast(error.message); }
  finally { setBusy(button, false); }
});

/* ── Session detail (trainer review, and a client's own history) ─────────── */
const sessionDialog = $('#sessionDialog');
async function openSessionDetail(assignment) {
  $('#sessionDialogTitle').textContent = assignment.templateSnapshot.name;
  $('#sessionDialogMeta').textContent = 'Loading…';
  $('#sessionDialogBody').innerHTML = '';
  sessionDialog.showModal();
  try {
    const history = await api(`/api/assigned-workouts/${encodeURIComponent(assignment.id)}/logs`);
    const log = history.logs.find(entry => entry.status === 'FINAL');
    const exercises = history.assignment.exercises;
    if (!log) {
      $('#sessionDialogMeta').textContent = `${dueLabel(assignment.dueDate)} · not logged yet`;
      $('#sessionDialogBody').innerHTML = '<p class="empty-inline">Nothing has been logged for this workout yet.</p>';
      return;
    }
    const finished = new Date(log.savedAt);
    $('#sessionDialogMeta').textContent = [finished.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), log.durationSeconds != null ? formatDuration(log.durationSeconds) : null, `${log.completedCount} of ${plural(exercises.length, 'exercise')} done`].filter(Boolean).join(' · ');
    $('#sessionDialogBody').innerHTML = exercises.map((exercise, index) => {
      const sets = log.sets.filter(set => set.exercise_index === index);
      return `<section class="session-detail-exercise"><header><h3>${escapeText(exercise.name)}</h3><p>Prescribed ${escapeText(prescriptionText(exercise))} · ${(done => done > exercise.sets ? `${done} sets done` : `${done} of ${exercise.sets} sets done`)(sets.filter(set => set.completed).length)}</p></header>${sets.length
        ? `<table class="set-table"><caption class="sr-only">${escapeText(exercise.name)}, logged sets</caption><thead><tr><th scope="col">Set</th><th scope="col">Reps</th><th scope="col">Weight</th><th scope="col">RPE</th><th scope="col">Note</th></tr></thead><tbody>${sets.map(set => `<tr class="${set.completed ? '' : 'is-skipped'}"><td>${set.set_index + 1}</td><td>${set.reps ?? '—'}</td><td>${set.load_value != null ? `${trimNumber(set.load_value)} ${escapeText(set.load_unit)}` : '—'}</td><td>${set.exertion ?? '—'}</td><td>${set.pain_flag ? '⚠ ' : ''}${escapeText(set.note || '')}</td></tr>`).join('')}</tbody></table>`
        : '<p class="skipped-exercise">Not done</p>'}</section>`;
    }).join('');
  } catch (error) {
    $('#sessionDialogMeta').textContent = error.message;
  }
}
$$('[data-close-session]').forEach(button => button.addEventListener('click', () => sessionDialog.close()));

/* ── Trainer: a client's page ────────────────────────────────────────────── */
function openClientPage(clientId) {
  state.selectedTraineeId = clientId;
  state.clientShowAllScheduled = false;
  const picker = $('#clientPicker');
  if (picker) picker.value = clientId;
  switchView('client');
}
async function loadClientPage() {
  const client = selectedClient();
  if (!client) return switchView('clients');
  $('#clientPageAvatar').textContent = initials(client.name);
  $('#clientPageName').textContent = client.name;
  $('#clientPageMeta').textContent = client.email;
  $('#clientUpcoming').innerHTML = $('#clientCompleted').innerHTML = '<div class="empty-inline"><span>Loading…</span></div>';
  try {
    const assignments = await fetchAssignments(client.id);
    if (state.selectedTraineeId !== client.id) return; // switched away meanwhile
    state.clientAssignments = assignments;
    const groups = splitAssignments(assignments), editable = item => item.status === 'ASSIGNED' ? `<button class="secondary-button" data-edit-assignment="${escapeText(item.id)}">Edit</button>` : '';
    const open = [...groups.overdue, ...groups.today, ...groups.upcoming];
    $('#clientStats').innerHTML = `<div><strong>${client.completionRate}%</strong><span>completion</span></div><div><strong>${groups.done.length}</strong><span>completed</span></div><div><strong>${groups.today.length + groups.upcoming.length}</strong><span>coming up</span></div><div><strong>${groups.overdue.length}</strong><span>overdue</span></div>`;
    const shown = state.clientShowAllScheduled ? open.slice(0, 50) : open.slice(0, 5);
    $('#clientUpcoming').innerHTML = shown.map(item => sessionRow(item, { action: editable(item) })).join('') + (open.length > shown.length ? `<button class="text-button show-more" type="button" data-show-all-scheduled>Show all ${open.length}</button>` : '')
      || `<div class="empty-inline"><strong>Nothing scheduled.</strong><span>Assign a workout to get ${escapeText(client.name.split(' ')[0])} started.</span></div>`;
    $('#clientCompleted').innerHTML = groups.done.slice(0, 20).map(item => sessionRow(item)).join('')
      || '<div class="empty-inline"><span>Completed workouts appear here, with every set logged.</span></div>';
  } catch (error) {
    $('#clientUpcoming').innerHTML = `<div class="template-item"><span>${escapeText(error.message)}</span></div>`;
  }
}
$('#client-view').addEventListener('click', event => {
  const openButton = event.target.closest('[data-open-session]'), edit = event.target.closest('[data-edit-assignment]'), go = event.target.closest('[data-client-go]');
  const find = id => (state.clientAssignments || []).find(item => item.id === id);
  if (edit) return openAssignmentEditor(find(edit.dataset.editAssignment));
  if (openButton) {
    const item = find(openButton.dataset.openSession);
    if (item?.status === 'COMPLETED') return openSessionDetail(item);
    if (item?.status === 'ASSIGNED') return openAssignmentEditor(item);
    return showToast(`${selectedClient()?.name.split(' ')[0]} has started this one. You will see every set once they press Done.`, 5000);
  }
  if (go) switchView(go.dataset.clientGo);
  if (event.target.closest('[data-show-all-scheduled]')) { state.clientShowAllScheduled = true; loadClientPage(); }
});
$('#clientAssignButton').addEventListener('click', () => openAssignDialog({ clientId: state.selectedTraineeId }));

/* ── Trainer: editing one assignment before it starts ───────────────────── */
const workoutEditorDialog = $('#workoutEditorDialog'), workoutEditorForm = $('#workoutEditorForm');
function openAssignmentEditor(assignment) {
  if (!assignment) return;
  if (assignment.status !== 'ASSIGNED') return showToast('Only workouts that have not started can be edited');
  workoutEditorForm.reset();
  workoutEditorForm.dataset.assignmentId = assignment.id;
  $('#workoutEditorError').textContent = '';
  workoutEditorForm.elements.name.value = assignment.templateSnapshot.name;
  workoutEditorForm.elements.description.value = assignment.templateSnapshot.description || '';
  workoutEditorForm.elements.dueDate.value = String(assignment.dueDate || '').slice(0, 10);
  const list = $('#workoutEditorExercises');
  list.innerHTML = '';
  assignment.templateSnapshot.exercises.forEach(exercise => addExerciseRow(list, exercise));
  workoutEditorDialog.showModal();
}
$('#addWorkoutExerciseButton').addEventListener('click', () => addExerciseRow($('#workoutEditorExercises')).querySelector('[name="exerciseName"]').focus());
$$('[data-close-workout-editor]').forEach(button => button.addEventListener('click', () => workoutEditorDialog.close()));
workoutEditorForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#saveWorkoutButton'), fields = new FormData(workoutEditorForm);
  $('#workoutEditorError').textContent = '';
  setBusy(button, true, 'Saving…');
  try {
    await api(`/api/assigned-workouts/${encodeURIComponent(workoutEditorForm.dataset.assignmentId)}`, { method: 'PATCH', body: JSON.stringify({ traineeId: state.selectedTraineeId, name: fields.get('name'), description: fields.get('description'), dueDate: fields.get('dueDate'), exercises: readExerciseRows($('#workoutEditorExercises')) }) });
    workoutEditorDialog.close();
    showToast('Workout updated for this client only');
    await Promise.all([loadClientPage(), loadDashboard()]);
  } catch (error) { $('#workoutEditorError').textContent = error.message; }
  finally { setBusy(button, false); }
});

/* ── Hand-offs from other screens ────────────────────────────────────────── */
// Anything on the trainer's dashboard that names a client leads to that
// client's page, which is where everything about them now lives.
$('#trainerDashboard').addEventListener('click', event => { const link = event.target.closest('[data-client-link]'); if (link?.dataset.clientLink) openClientPage(link.dataset.clientLink); });
// The calendar and the dashboard point at one assignment. A client opens it to
// train or to look back; a trainer lands on that client's page, or on the
// session itself once it has been done.
async function openAssignment(assignmentId, assignment = null) {
  if (state.user?.role === 'TRAINEE') {
    if (!state.traineeAssignments?.some(item => item.id === assignmentId)) {
      state.traineeAssignments = await fetchAssignments();
      if (assignment && !state.traineeAssignments.some(item => item.id === assignmentId)) state.traineeAssignments.push(assignment);
    }
    switchView('workouts');
    const item = state.traineeAssignments.find(entry => entry.id === assignmentId);
    return item?.status === 'COMPLETED' ? openSessionDetail(item) : openSession(assignmentId, { start: false });
  }
  if (assignment?.status === 'COMPLETED') return openSessionDetail(assignment);
  if (assignment?.traineeId) openClientPage(assignment.traineeId);
}
