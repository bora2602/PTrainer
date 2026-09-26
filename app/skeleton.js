// Skeleton loading states for every view.
//
// A classic script like its neighbours: loaded after auth.js and before
// messages.js, and switched on by installSkeletons(), which initialize() calls
// before the first loader runs.
//
// How it works. Each entry in SKELETON_VIEWS names a loader and the containers
// that loader fills. installSkeletons() wraps the loader, so the loaders
// themselves stay as they were; the wrapper draws the skeleton before the fetch
// and settles it afterwards, whatever happened.
//
// When a skeleton shows - the rule everything else hangs on. Loaders are called
// from about forty places, and most of those calls are refreshes: after a save,
// or the 20-second poll. A skeleton on a refresh would blank real content the
// person is reading, which is exactly what design.md forbids ("a refresh may
// only add"). So a container shows a skeleton only when it has never been
// filled for its current *context*: the signed-in user, plus whichever client,
// month or day the view is about. Same context, no skeleton, however often the
// loader runs. A different client is a different context, so her data never
// sits on screen under his name while it loads.
//
// A new loader needs an entry here. work/accessibility-check.mjs fails the build
// for any `async function load...` that is neither registered nor listed in
// SKELETON_EXEMPT with a reason.

// Width and height steps are classes rather than inline styles because the CSP
// forbids style attributes (design.md, "Fonts are self-hosted").
const SK_WIDTHS = ['sk-w5', 'sk-w3', 'sk-w4', 'sk-w2', 'sk-w6', 'sk-w3'];
const skBar = (width, extra = '') => `<span class="sk-bar ${width}${extra ? ` ${extra}` : ''}"></span>`;
const skWidth = index => SK_WIDTHS[index % SK_WIDTHS.length];

// Each shape returns top-level nodes that all carry .sk, so they sit directly in
// the container and inherit its real layout - a grid stays a grid, a list keeps
// its gaps - rather than being wrapped in something the container never styled.
const SKELETON_SHAPES = {
  // A list row: an optional leading avatar or date block, a title and a meta
  // line, and an optional trailing status chip.
  rows: (count, { lead = true, chip = true } = {}) => Array.from({ length: count }, (_, index) =>
    `<div class="sk sk-row" aria-hidden="true">${lead ? '<span class="sk-bar sk-lead"></span>' : ''}<span class="sk-lines">${skBar(skWidth(index))}${skBar(skWidth(index + 3), 'sk-sm')}</span>${chip ? '<span class="sk-bar sk-chip"></span>' : ''}</div>`).join(''),
  calendar: () => Array.from({ length: 6 }, () =>
    `<tr class="sk" aria-hidden="true">${Array.from({ length: 7 }, (_, day) => `<td class="sk-cal"><div class="sk-cal-day"><span class="sk-bar sk-cal-date"></span>${day % 3 === 1 ? skBar('sk-w5', 'sk-sm') : ''}</div></td>`).join('')}</tr>`).join(''),
  // Bars of varying height, so it reads as a chart before it is one. Heights
  // are a fixed pattern: a skeleton that implied a trend would be inventing one.
  chart: () => `<div class="sk sk-chart" aria-hidden="true">${[3, 4, 3, 5, 4, 5, 4, 5].map(step => `<span class="sk-bar sk-col sk-h${step}"></span>`).join('')}</div>`,
  stats: count => Array.from({ length: count }, () =>
    `<div class="sk sk-stat" aria-hidden="true">${skBar('sk-w3', 'sk-sm')}${skBar('sk-w2', 'sk-lg')}</div>`).join(''),
  // A conversation: bubbles from both sides, so it is recognisably a thread.
  thread: count => Array.from({ length: count }, (_, index) =>
    `<div class="sk sk-bubble ${index % 3 === 1 ? 'is-mine' : 'is-theirs'}" aria-hidden="true">${skBar(skWidth(index))}${index % 2 ? skBar(skWidth(index + 2)) : ''}</div>`).join(''),
  // A logged session: a line of totals, then set rows.
  detail: () => `<div class="sk sk-detail" aria-hidden="true">${skBar('sk-w4')}${skBar('sk-w6', 'sk-sm')}${Array.from({ length: 4 }, (_, index) => `<div class="sk-row sk-row-flat">${skBar('sk-w2')}${skBar(skWidth(index), 'sk-sm')}${skBar('sk-w1', 'sk-sm')}</div>`).join('')}</div>`
};

// A screen reader gets one sentence rather than a dozen empty shapes; the
// shapes themselves are aria-hidden. A table body cannot hold a paragraph, so
// there aria-busy on the container is the only signal.
function skeletonMarkup(shape, count = 3, options = {}) {
  const shapes = SKELETON_SHAPES[shape](count, options);
  return shape === 'calendar' ? shapes : `<p class="sk sr-only">Loading…</p>${shapes}`;
}

// Mask shapes keep the container's own markup and paint its text as bars in
// CSS. They are for panels whose structure is static and only the values load -
// a stat card, the today card, a form - where replacing the markup would throw
// away labels and controls that are already correct.
//   mask - paint the text inside the element
//   text - paint the element itself
const MASK_SHAPES = new Set(['mask', 'text']);

const skUserKey = () => state.user?.id || 'anon';

const SKELETON_VIEWS = [
  { loader: 'loadDashboard', targets: () => state.user?.role === 'TRAINER'
      ? [['#trainerDashboard .welcome-row', 'mask'], ['.attention-list', 'rows', 2, { chip: false }], ['.schedule-list', 'rows', 3, { chip: false }], ['#clientFigures', 'mask'], ['#clientList', 'rows', 4], ['#clientPicker', 'text']]
      : [['#todayCard', 'mask'], ['#traineeDashboard .trainee-stats', 'mask'], ['#traineeDashboard .coach-chip', 'text']] },
  // Trainee-only: for a trainer this loader returns at once, and its containers
  // are not theirs to show.
  { loader: 'loadAssignments', targets: () => state.user?.role === 'TRAINEE' ? [['#todayWorkouts', 'rows', 1], ['#upcomingWorkouts', 'rows', 3], ['#historyWorkouts', 'rows', 3]] : [] },
  { loader: 'loadInvitations', targets: () => [['#invitationList', 'rows', 2, { lead: false }]] },
  { loader: 'loadClientPage', key: () => state.selectedTraineeId, targets: () => [['#clientStats', 'stats', 4], ['#clientCompleted', 'rows', 3], ['#clientUpcoming', 'rows', 2]] },
  { loader: 'loadNotes', key: () => state.selectedTraineeId, targets: () => [['#noteList', 'rows', 2, { lead: false, chip: false }]] },
  { loader: 'loadTemplates', targets: () => [['#templateList', 'rows', 3, { lead: false }], ['#templateCount', 'text']] },
  { loader: 'loadOwnExercises', targets: () => [['#ownExerciseList', 'rows', 3, { lead: false }]] },
  { loader: 'loadCalendar', key: () => `${+calendarMonth()}${traineeQuery()}`, targets: () => [['#calendarBody', 'calendar'], ['#calendarSummary', 'text']] },
  { loader: 'loadProgress', key: () => traineeQuery(), targets: () => [['#progressChart', 'chart'], ['#progressEntries', 'rows', 4, { lead: false }], ['#progressLatest', 'text']] },
  { loader: 'loadNutrition', key: () => `${$('#nutritionDateFilter')?.value}${traineeQuery()}`, targets: () => [['#nutritionSummary', 'mask'], ['#nutritionList', 'rows', 3, { lead: false }]] },
  { loader: 'loadMessages', key: () => traineeQuery(), targets: () => [['#messageList', 'thread', 5]] },
  { loader: 'loadNotifications', targets: () => [['#notificationList', 'rows', 3, { chip: false }]] },
  { loader: 'loadSubscription', targets: () => [['#currentPlan', 'mask']] },
  { loader: 'loadSettings', targets: () => [['#profileForm', 'mask'], ['#storageRegion', 'text'], ['#privacyNoticeStatus', 'text'], ['#auditList', 'rows', 3, { lead: false, chip: false }]] },
  { loader: 'loadSharingPreferences', targets: () => [['#sharingPanel .sharing-toggles', 'mask'], ['#sharingTrainer', 'text']] },
  { loader: 'loadCalendarFeed', targets: () => [['#calendarFeedStatus', 'text']] },
  { loader: 'loadTwoFactorPanel', targets: () => [['#twoFactorStatus', 'text']] }
];

// Loaders deliberately without a skeleton, as name: 'reason'. Empty today:
// every loader has one. The static check reads this and rejects an entry whose
// loader does not exist, so it cannot quietly go stale.
const SKELETON_EXEMPT = {};

// Which call to a loader is the latest for each element. Two calls can overlap -
// a view switch and the poll - and only the newer one may settle the skeleton,
// or an older response would clear a skeleton that a newer context put up.
const skGeneration = new WeakMap();

function showSkeleton(element, shape, count, options, key) {
  if (element.dataset.skKey === key) return false;
  const generation = (skGeneration.get(element) || 0) + 1;
  skGeneration.set(element, generation);
  element.setAttribute('aria-busy', 'true');
  if (MASK_SHAPES.has(shape)) {
    element.dataset.skMask = shape;
    // Nothing inside can be pressed or typed into until it is known what it is.
    // A client tapping "Start workout" on the placeholder would start nothing;
    // somebody typing into the profile form would lose it when the saved values
    // landed on top.
    element.inert = true;
  } else {
    element.innerHTML = skeletonMarkup(shape, count, options);
  }
  return generation;
}

function settleSkeleton(element, shape, key, generation, loaderName) {
  if (skGeneration.get(element) !== generation) return;
  element.removeAttribute('aria-busy');
  if (MASK_SHAPES.has(shape)) {
    delete element.dataset.skMask;
    element.inert = false;
    element.dataset.skKey = key;
    return;
  }
  const stillSkeleton = [...element.children].some(child => child.classList.contains('sk'));
  if (!stillSkeleton) { element.dataset.skKey = key; return; }
  // The loader finished without drawing anything here, which means it failed:
  // most loaders catch their own errors and report them in a toast or an error
  // line, so "it did not throw" is not "it worked". A skeleton that never
  // resolves is the same dead end as a spinner that never stops, and quietly
  // emptying it leaves a blank panel with no way forward. So it says so, and
  // offers the retry. A loader that legitimately skips a container must not
  // register it (see loadAssignments above) - that is what keeps this honest.
  element.innerHTML = skeletonError(element, loaderName);
}

function skeletonError(element, loaderName) {
  const body = `<span>Couldn't load this.</span><button class="text-button" type="button" data-sk-retry="${loaderName}">Try again</button>`;
  if (element.tagName === 'TBODY') return `<tr class="sk-error"><td colspan="${element.closest('table')?.querySelector('tr')?.children.length || 1}"><div class="sk-error-row">${body}</div></td></tr>`;
  return `<div class="sk-error sk-error-row" role="alert">${body}</div>`;
}

document.addEventListener('click', event => {
  const retry = event.target.closest('[data-sk-retry]');
  if (!retry) return;
  const loader = globalThis[retry.dataset.skRetry];
  const holder = retry.closest('[id]');
  // Clear the settled key so the retry is allowed to draw its skeleton again.
  if (holder) delete holder.dataset.skKey;
  if (typeof loader === 'function') loader();
});

let skeletonsInstalled = false;
function installSkeletons() {
  if (skeletonsInstalled) return;
  skeletonsInstalled = true;
  for (const view of SKELETON_VIEWS) {
    const original = globalThis[view.loader];
    if (typeof original !== 'function') continue;
    // Top-level function declarations in a classic script are properties of the
    // global object, and every caller - including the ones inside other files -
    // resolves the name at call time, so this reaches all of them.
    globalThis[view.loader] = async function skeletonLoader(...args) {
      const key = `${skUserKey()}|${view.key ? view.key() : ''}`;
      const shown = [];
      for (const [selector, shape, count, options] of view.targets()) {
        const element = document.querySelector(selector);
        if (!element) continue;
        const generation = showSkeleton(element, shape, count, options, key);
        if (generation) shown.push([element, shape, generation]);
      }
      try { return await original.apply(this, args); }
      finally { for (const [element, shape, generation] of shown) settleSkeleton(element, shape, key, generation, view.loader); }
    };
  }
}

// On sign-out every registered container is emptied and forgotten. Before this,
// the previous person's clients, weights and messages stayed in the hidden DOM,
// and on a shared device showed for a moment under the next person's name while
// their own data loaded.
function resetSkeletons() {
  for (const view of SKELETON_VIEWS) {
    // Targets depend on the role that just signed out, so both sets are cleared.
    for (const role of ['TRAINER', 'TRAINEE']) {
      const saved = state.user;
      state.user = { role };
      const targets = view.targets();
      state.user = saved;
      for (const [selector, shape] of targets) {
        const element = document.querySelector(selector);
        if (!element) continue;
        delete element.dataset.skKey;
        if (!MASK_SHAPES.has(shape) && element.tagName !== 'SELECT') element.innerHTML = '';
      }
    }
  }
}

// The boot screen: shown from the first paint until /api/session says which
// screen this is. Without it a signed-in person saw the sign-in form flash on
// every load. See #bootSkeleton in index.html for the failsafe.
function finishBoot() {
  document.documentElement.classList.remove('is-booting');
  const boot = document.getElementById('bootSkeleton');
  if (boot) boot.hidden = true;
}
