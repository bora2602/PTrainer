// The demo accounts, their sample coaching history, and the pool that hands them
// out. Lifted out of server.mjs under CLAUDE.md §3 - extract a module when you
// next have reason to touch the domain - because this grew from one seeded
// workout into a whole consistent account per client.
//
// Three properties this file exists to hold:
//   1. One list of demo accounts. Two lists would drift, and the failure mode of
//      drift is an account left live in production with its password published
//      in this repository.
//   2. Every client is a *complete* demo. Visitors are handed different clients
//      so that concurrent sessions do not edit each other's data, which only
//      works if each one has a full history behind it.
//   3. The data is internally consistent: the weight series ends where the
//      profile says the client is now, a completed assignment has the set logs
//      to match, and the conversation refers to workouts that exist.
//
// Nothing here runs in production. server.mjs calls suspendDemoAccounts()
// instead, because a database that was ever started outside production still
// holds these rows.

export const DEMO_PASSWORD_TRAINER = 'DemoTrainer1!';
export const DEMO_PASSWORD_CLIENT = 'DemoTrainee1!';

export const DEMO_TRAINER = { name: 'Maya Adams', email: 'trainer@ptrainer.local', password: DEMO_PASSWORD_TRAINER, role: 'TRAINER' };

// Each client is a different coaching situation, so the trainer views have
// something to show: someone on track, someone who has stalled, someone brand
// new, someone carrying a niggle, someone training for an event.
export const DEMO_CLIENTS = [
  {
    name: 'Jordan Lee', email: 'trainee@ptrainer.local', password: DEMO_PASSWORD_CLIENT, role: 'TRAINEE',
    goals: 'Add strength on the main lifts without putting on weight.',
    weights: [[70, 82.4], [56, 81.9], [42, 81.5], [28, 80.8], [14, 79.9], [2, 79.2]], unit: 'kg',
    program: ['Upper Body Strength', 'Lower Body Power', 'Conditioning & Core'],
    done: 7, upcoming: 2, effort: 1,
    nutrition: [
      [2, 'Oats with berries, chicken rice bowl, salmon and greens', 2180, 148, 214, 71, 2600],
      [1, 'Eggs on toast, turkey wrap, stir fry with tofu', 2040, 139, 198, 63, 2400],
      [0, 'Skipped breakfast, big lunch after the session', null, null, null, null, 1800]
    ],
    conversation: [
      ['trainer', 'Bench felt strong last week - I have nudged the top set up by 2.5kg.'],
      ['client', 'Noticed. Fourth set was the hard one but all eight reps went up.'],
      ['trainer', 'That is exactly where I want it. Keep the rest at 90 seconds.'],
      ['client', 'Will do. Legs are on for Thursday?'],
      ['trainer', 'Thursday is Lower Body Power, yes. Eat properly beforehand.']
    ]
  },
  {
    name: 'Priya Raman', email: 'priya@ptrainer.local', password: DEMO_PASSWORD_CLIENT, role: 'TRAINEE',
    goals: 'Get back to training three times a week after a long break.',
    weights: [[63, 68.1], [49, 67.8], [35, 67.4], [21, 67.5], [7, 67.1]], unit: 'kg',
    program: ['Full Body Foundations', 'Conditioning & Core'],
    done: 4, upcoming: 2, effort: 0,
    nutrition: [
      [1, 'Porridge, lentil soup and bread, roast vegetables with feta', 1760, 82, 204, 58, 1900],
      [0, 'Yoghurt and fruit, leftover soup', 980, 51, 118, 29, 1400]
    ],
    conversation: [
      ['trainer', 'Two sessions done this week already. How is the shoulder feeling?'],
      ['client', 'Much better. The band warm-up helps more than I expected.'],
      ['trainer', 'Good. Keep it in front of every upper session.']
    ]
  },
  {
    name: 'Marcus Okafor', email: 'marcus@ptrainer.local', password: DEMO_PASSWORD_CLIENT, role: 'TRAINEE',
    goals: 'Build up to a first 10k while keeping some strength work.',
    weights: [[56, 88.2], [42, 87.1], [28, 86.4], [14, 85.6], [3, 84.9]], unit: 'kg',
    program: ['Conditioning & Core', 'Full Body Foundations'],
    done: 6, upcoming: 1, effort: 2,
    nutrition: [
      [2, 'Bagel and peanut butter, pasta with chicken, yoghurt', 2620, 121, 318, 82, 3100],
      [0, 'Long run morning - porridge, recovery shake, big dinner', 2740, 128, 341, 79, 3400]
    ],
    conversation: [
      ['client', 'Got the 7k done on Sunday. Legs were heavy but it was fine.'],
      ['trainer', 'Strong work. I will hold the distance this week and add it back after.'],
      ['client', 'Sounds good - the squats are what leave me sore, not the running.'],
      ['trainer', 'Noted. I have dropped the squat volume and kept the load.']
    ]
  },
  {
    name: 'Sofia Duarte', email: 'sofia@ptrainer.local', password: DEMO_PASSWORD_CLIENT, role: 'TRAINEE',
    goals: 'Train around a stiff lower back and get confident lifting again.',
    weights: [[42, 61.2], [28, 61.6], [14, 61.4], [5, 61.8]], unit: 'kg',
    program: ['Full Body Foundations'],
    done: 3, upcoming: 1, effort: 0, pain: true,
    nutrition: [[0, 'Eggs and avocado, chicken salad, pasta', 1920, 114, 186, 74, 2200]],
    conversation: [
      ['client', 'Back was tight during the second set of deadlifts, so I stopped there.'],
      ['trainer', 'Right call, and thank you for flagging it. I have swapped them for hip hinges this week.'],
      ['client', 'Thanks - that feels much more manageable.']
    ]
  },
  {
    name: 'Ellis Nakamura', email: 'ellis@ptrainer.local', password: DEMO_PASSWORD_CLIENT, role: 'TRAINEE',
    goals: 'Just starting out and wants a routine that sticks.',
    weights: [[10, 74.5], [3, 74.2]], unit: 'kg',
    program: ['Full Body Foundations'],
    done: 1, upcoming: 2, effort: 0,
    nutrition: [],
    conversation: [
      ['trainer', 'Welcome aboard. First session is deliberately light - it is about the movements, not the weight.'],
      ['client', 'Understood. Slightly nervous but looking forward to it.']
    ]
  }
];

export const DEMO_ACCOUNTS = [DEMO_TRAINER, ...DEMO_CLIENTS];
export const DEMO_EMAILS = new Set(DEMO_ACCOUNTS.map(account => account.email));

// The trainer's reusable library. Loads are in kg and the set logs below are
// derived from them, so a client's logged weight always relates to what was
// actually prescribed.
const DEMO_TEMPLATES = [
  { name: 'Upper Body Strength', description: 'A balanced upper-body strength session.', exercises: [
    { name: 'Barbell bench press', sets: 4, reps: 8, restSeconds: 90, load: 72.5 },
    { name: 'Single-arm dumbbell row', sets: 3, reps: 10, restSeconds: 75, load: 32 },
    { name: 'Seated shoulder press', sets: 3, reps: 10, restSeconds: 75, load: 40 },
    { name: 'Cable triceps extension', sets: 3, reps: 12, restSeconds: 60, load: 25 }
  ] },
  { name: 'Lower Body Power', description: 'Heavier lower-body work with a jump primer.', exercises: [
    { name: 'Back squat', sets: 5, reps: 5, restSeconds: 120, load: 95 },
    { name: 'Romanian deadlift', sets: 3, reps: 8, restSeconds: 90, load: 80 },
    { name: 'Walking lunge', sets: 3, reps: 12, restSeconds: 75, load: 20 },
    { name: 'Standing calf raise', sets: 4, reps: 15, restSeconds: 45, load: 45 }
  ] },
  { name: 'Conditioning & Core', description: 'Intervals and trunk work. Short and hard.', exercises: [
    { name: 'Rowing machine intervals', sets: 6, reps: 1, restSeconds: 60, load: null },
    { name: 'Kettlebell swing', sets: 4, reps: 15, restSeconds: 60, load: 24 },
    { name: 'Plank', sets: 3, reps: 1, restSeconds: 45, load: null },
    { name: 'Hanging knee raise', sets: 3, reps: 12, restSeconds: 45, load: null }
  ] },
  { name: 'Full Body Foundations', description: 'Movement quality first. Light loads, clean technique.', exercises: [
    { name: 'Goblet squat', sets: 3, reps: 10, restSeconds: 75, load: 16 },
    { name: 'Dumbbell bench press', sets: 3, reps: 10, restSeconds: 75, load: 22 },
    { name: 'Lat pulldown', sets: 3, reps: 12, restSeconds: 60, load: 35 },
    { name: 'Hip hinge with dowel', sets: 3, reps: 12, restSeconds: 45, load: null }
  ] }
];

const dayString = offsetDays => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
const timeAt = (offsetDays, hour = 18) => new Date(new Date(Date.now() - offsetDays * 86400000).setHours(hour, 5, 0, 0)).toISOString();
// A template's exercises as an assignment snapshot keeps them, with the private
// `load` hint dropped: it drives the seeded set logs and is not part of the
// shape the app reads back.
const snapshotOf = template => ({ ...template, exercises: template.exercises.map(({ load, ...rest }) => rest) });

// Deterministic jitter, so the numbers look human rather than uniform but the
// seed produces the same history on every start. Math.random() here would mean a
// client's logged weights changed every time the process restarted.
const jitter = (seed, spread) => ((Math.sin(seed * 12.9898) * 43758.5453) % 1 + 1) % 1 * spread - spread / 2;

export async function seedDemoAccounts(ctx) {
  const { query, transaction, createUser, id, log, workoutTemplates, assignments, findRelationship, forgetUser } = ctx;

  const trainer = await createUser({ ...DEMO_TRAINER, isDemo: true });
  const clients = [];
  for (const spec of DEMO_CLIENTS) clients.push({ ...spec, user: await createUser({ ...spec, isDemo: true }) });

  // A previous production start suspends these, and an account created before
  // migration 021 has is_demo false. Running outside production is what puts
  // both right, so the two modes stay symmetric.
  for (const account of [trainer, ...clients.map(item => item.user)]) {
    if (account.status !== 'ACTIVE' || account.isDemo !== true || !account.emailVerifiedAt) {
      account.status = 'ACTIVE'; account.isDemo = true;
      account.emailVerifiedAt = account.emailVerifiedAt || new Date().toISOString();
      forgetUser(account);
      await query("UPDATE users SET status='ACTIVE',is_demo=TRUE,email_verified_at=COALESCE(email_verified_at,now()),updated_at=now() WHERE id=$1", [account.id]);
      log('info', 'demo_account_prepared', { email: account.email });
    }
  }

  for (const { user } of clients) {
    if (await findRelationship(trainer.id, user.id)) continue;
    await query("INSERT INTO trainer_trainee_relationships(trainer_id,trainee_id,status,created_at,updated_at) VALUES($1,$2,'ACTIVE',$3,$3)", [trainer.id, user.id, new Date().toISOString()]);
    log('info', 'demo_client_connected', { email: user.email });
  }

  // Templates are matched by name so a restart reuses them rather than growing
  // the library by four every time.
  const templates = new Map();
  for (const spec of DEMO_TEMPLATES) {
    let template = [...workoutTemplates.values()].find(item => item.trainerId === trainer.id && item.name === spec.name);
    if (!template) {
      template = { id: id('tpl'), trainerId: trainer.id, name: spec.name, description: spec.description, exercises: snapshotOf(spec).exercises, version: 1, createdAt: timeAt(75, 9) };
      await query('INSERT INTO workout_templates(id,trainer_id,name,description,version,exercises,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [template.id, template.trainerId, template.name, template.description, template.version, JSON.stringify(template.exercises), template.createdAt]);
      workoutTemplates.set(template.id, template);
    }
    templates.set(spec.name, { ...template, loads: spec.exercises.map(exercise => exercise.load) });
  }

  for (const [clientIndex, client] of clients.entries()) {
    await seedClient({ ...ctx, trainer, client, templates, clientIndex, assignments });
  }

  // The trainer's inbox, built from what the clients actually just did rather
  // than from invented events.
  const existingNotifications = await query('SELECT count(*)::int AS count FROM notifications WHERE recipient_id=$1', [trainer.id]);
  if (Number(existingNotifications.rows[0].count) === 0) {
    const recent = [
      ['WORKOUT_COMPLETED', 'Workout completed', 'Jordan Lee completed Upper Body Strength.', 1],
      ['PROGRESS_ADDED', 'New progress update', 'Jordan Lee logged 79.2 kg.', 2],
      ['WORKOUT_COMPLETED', 'Workout completed', 'Marcus Okafor completed Conditioning & Core.', 3],
      ['MESSAGE_RECEIVED', 'New message', 'Sofia Duarte mentioned tightness in her lower back.', 4]
    ];
    for (const [type, title, body, daysAgo] of recent) {
      await query('INSERT INTO notifications(id,recipient_id,event_type,title,body,created_at) VALUES($1,$2,$3,$4,$5,$6)', [id('notification'), trainer.id, type, title, body, timeAt(daysAgo, 20)]);
    }
  }

  log('info', 'demo_seed_ready', { clients: clients.length, templates: templates.size });
  return { trainer, clients: clients.map(item => item.user) };
}

async function seedClient({ query, id, trainer, client, templates, clientIndex, assignments }) {
  const user = client.user;

  // Everything below is idempotent on "has this client got any yet", so a
  // restart does not multiply the history.
  const profile = await query('SELECT user_id FROM user_profiles WHERE user_id=$1', [user.id]);
  if (!profile.rowCount) await query('INSERT INTO user_profiles(user_id,goals,preferred_units,timezone) VALUES($1,$2,$3,$4)', [user.id, client.goals, 'METRIC', 'America/Toronto']);

  const hasProgress = await query('SELECT count(*)::int AS count FROM progress_entries WHERE trainee_id=$1', [user.id]);
  if (Number(hasProgress.rows[0].count) === 0) {
    for (const [daysAgo, value] of client.weights) {
      await query("INSERT INTO progress_entries(id,trainee_id,author_id,metric_type,value,unit,value_normalized,normalized_unit,measured_at,note) VALUES($1,$2,$2,'weight',$3,$4,$3,$4,$5,'')", [id('progress'), user.id, value, client.unit, timeAt(daysAgo, 7)]);
    }
  }

  const hasNutrition = await query('SELECT count(*)::int AS count FROM nutrition_entries WHERE trainee_id=$1', [user.id]);
  if (Number(hasNutrition.rows[0].count) === 0) {
    for (const [daysAgo, description, calories, protein, carbs, fat, water] of client.nutrition) {
      await query("INSERT INTO nutrition_entries(id,trainee_id,author_id,entry_date,entry_type,description,calories,protein_g,carbs_g,fat_g,water_ml,created_at) VALUES($1,$2,$2,$3,'DAILY',$4,$5,$6,$7,$8,$9,$10)", [id('nutrition'), user.id, dayString(daysAgo), description, calories, protein, carbs, fat, water, timeAt(daysAgo, 21)]);
    }
  }

  const hasAssignments = [...assignments.values()].some(item => item.traineeId === user.id);
  if (!hasAssignments) {
    const program = client.program.map(name => templates.get(name)).filter(Boolean);
    // Completed sessions march backwards from a week ago, every third day, so a
    // history reads as a schedule somebody kept rather than a burst.
    for (let index = 0; index < client.done; index += 1) {
      const template = program[index % program.length];
      const daysAgo = 7 + (client.done - index - 1) * 3;
      await seedAssignment({ query, id, trainer, user, template, daysAgo, completed: true, client, assignments, seed: clientIndex * 31 + index });
    }
    for (let index = 0; index < client.upcoming; index += 1) {
      const template = program[(client.done + index) % program.length];
      await seedAssignment({ query, id, trainer, user, template, daysAgo: -(index * 2 + 1), completed: false, client, assignments, seed: clientIndex * 31 + 90 + index });
    }
  }

  const hasMessages = await query('SELECT count(*)::int AS count FROM messages WHERE relationship_trainer_id=$1 AND relationship_trainee_id=$2', [trainer.id, user.id]);
  if (Number(hasMessages.rows[0].count) === 0) {
    const total = client.conversation.length;
    for (const [index, [who, body]] of client.conversation.entries()) {
      const sender = who === 'trainer' ? trainer.id : user.id;
      // Spread back from yesterday, and mark everything but a trailing client
      // message as read, so the trainer's unread badge has a real reason.
      const daysAgo = 1 + (total - index - 1);
      const unread = who === 'client' && index === total - 1;
      await query('INSERT INTO messages(id,relationship_trainer_id,relationship_trainee_id,sender_id,body,read_at,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [id('message'), trainer.id, user.id, sender, body, unread ? null : timeAt(daysAgo, 20), timeAt(daysAgo, 12 + index % 6)]);
    }
  }
}

async function seedAssignment({ query, id, trainer, user, template, daysAgo, completed, client, assignments, seed }) {
  const assignmentId = id('assigned');
  const snapshot = { id: template.id, trainerId: template.trainerId, name: template.name, description: template.description, version: template.version, exercises: template.exercises, createdAt: template.createdAt };
  const dueDate = dayString(daysAgo), status = completed ? 'COMPLETED' : 'ASSIGNED', createdAt = timeAt(Math.max(daysAgo, 0) + 2, 9);
  await query('INSERT INTO assigned_workouts(id,template_id,trainer_id,trainee_id,template_snapshot,due_date,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
    [assignmentId, template.id, trainer.id, user.id, JSON.stringify(snapshot), dueDate, status, createdAt]);
  // The dashboards read assignments from this process-local mirror, which
  // server.mjs fills from the table at boot and keeps in step on every write. A
  // seed that only wrote SQL was invisible until the next restart - and a reset
  // is not a restart, so every client looked like it had no program.
  assignments.set(assignmentId, { id: assignmentId, templateId: template.id, trainerId: trainer.id, traineeId: user.id, templateSnapshot: snapshot, dueDate, status, createdAt });
  if (!completed) return;

  // A completed assignment gets the log and the individual sets to match, so the
  // trainer's read-back view has real numbers in it and the completion count on
  // the log equals the number of sets marked complete.
  const exercises = template.exercises.map((exercise, index) => ({ ...exercise, completedSets: exercise.sets, load: template.loads[index] }));
  const logId = id('log');
  const startedAt = timeAt(daysAgo, 18);
  const durationSeconds = 2400 + Math.round(jitter(seed, 900));
  await query('INSERT INTO workout_logs(id,assigned_workout_id,author_id,idempotency_key,exercises,completed_count,started_at,duration_seconds,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [logId, assignmentId, user.id, `demo-${assignmentId}`, JSON.stringify(exercises.map(({ load, ...rest }) => rest)), exercises.reduce((total, exercise) => total + exercise.sets, 0), startedAt, durationSeconds, new Date(new Date(startedAt).getTime() + durationSeconds * 1000).toISOString()]);

  for (const [exerciseIndex, exercise] of exercises.entries()) {
    for (let setIndex = 0; setIndex < exercise.sets; setIndex += 1) {
      const hasLoad = typeof exercise.load === 'number';
      // Load creeps up across the weeks and wobbles a little set to set, which
      // is what a real log looks like; reps drop on the last set of a heavy lift.
      const progression = 1 - daysAgo * 0.0012;
      const load = hasLoad ? Math.round(exercise.load * progression * 2) / 2 : null;
      const reps = Math.max(1, exercise.reps - (setIndex === exercise.sets - 1 && exercise.reps > 5 ? 1 : 0));
      const exertion = Math.min(10, Math.max(5, Math.round((6.5 + setIndex * 0.4 + jitter(seed + exerciseIndex + setIndex, 0.8)) * 2) / 2));
      await query('INSERT INTO set_logs(id,workout_log_id,exercise_index,set_index,completed,reps,load_value,load_unit,rest_seconds,exertion,pain_flag,note) VALUES($1,$2,$3,$4,TRUE,$5,$6,$7,$8,$9,$10,$11)',
        [id('set'), logId, exerciseIndex, setIndex, reps, load, hasLoad ? 'kg' : null, exercise.restSeconds,
          exertion, Boolean(client.pain) && exerciseIndex === 0 && setIndex === exercise.sets - 1,
          Boolean(client.pain) && exerciseIndex === 0 && setIndex === exercise.sets - 1 ? 'Lower back felt tight, stopped the set early.' : '']);
    }
  }
}

// Production path. A database that was ever started outside production still
// holds these rows and their passwords are published in this repository, so
// skipping the seed is not enough - the rows have to stop being usable.
// Suspending rather than deleting keeps anything attached to them recoverable.
export async function suspendDemoAccounts({ query, findUserByEmail, forgetUser, log }) {
  for (const { email } of DEMO_ACCOUNTS) {
    const account = await findUserByEmail(email);
    if (account && account.status === 'ACTIVE') {
      account.status = 'SUSPENDED'; forgetUser(account);
      await query("UPDATE users SET status='SUSPENDED',updated_at=now() WHERE id=$1", [account.id]);
      log('warn', 'demo_account_suspended', { email });
    }
  }
}

// Which account a "try the demo" button gets. The trainer is shared, because the
// whole sample roster hangs off her. Clients rotate least-recently-used, so
// several people looking at the demo at once land on different accounts and do
// not edit each other's data.
export function createDemoPool(emails, now = Date.now) {
  const handedOut = new Map(emails.map(email => [email, 0]));
  return {
    take() {
      let oldest = null;
      for (const [email, when] of handedOut) if (!oldest || when < handedOut.get(oldest)) oldest = email;
      handedOut.set(oldest, now());
      return oldest;
    },
    state() { return new Map(handedOut); }
  };
}

// Wipe the demo content and seed it again. Every statement is constrained to the
// ids of accounts the database itself marks is_demo, and the id list is read
// fresh here rather than taken from a caller, so there is no argument anyone can
// pass that widens the blast radius to a real account. If that query returns
// nothing, this function deletes nothing.
//
// Accounts and coaching relationships are kept: recreating them would churn the
// user rows the sessions table points at. Only what the seed itself produces is
// removed, in foreign-key order.
export async function resetDemoData(ctx) {
  const { query, log, workoutTemplates, assignments } = ctx;
  const demoIds = (await query('SELECT id FROM users WHERE is_demo')).rows.map(row => row.id);
  if (!demoIds.length) { log('warn', 'demo_reset_skipped', { reason: 'no demo accounts' }); return { deleted: 0, accounts: 0 }; }

  let deleted = 0;
  const run = async (sql, params = [demoIds]) => { deleted += (await query(sql, params)).rowCount || 0; };

  await run('DELETE FROM set_logs WHERE workout_log_id IN (SELECT id FROM workout_logs WHERE author_id = ANY($1))');
  await run('DELETE FROM workout_logs WHERE author_id = ANY($1)');
  await run('DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE sender_id = ANY($1))');
  await run('DELETE FROM messages WHERE sender_id = ANY($1)');
  await run('DELETE FROM assigned_workouts WHERE trainee_id = ANY($1) OR trainer_id = ANY($1)');
  await run('DELETE FROM workout_templates WHERE trainer_id = ANY($1)');
  await run('DELETE FROM progress_entries WHERE trainee_id = ANY($1)');
  await run('DELETE FROM nutrition_entries WHERE trainee_id = ANY($1)');
  await run('DELETE FROM nutrition_targets WHERE trainee_id = ANY($1)');
  await run('DELETE FROM trainer_notes WHERE trainee_id = ANY($1) OR trainer_id = ANY($1)');
  await run('DELETE FROM notifications WHERE recipient_id = ANY($1)');
  await run('DELETE FROM invitations WHERE trainer_id = ANY($1)');
  // A demo account cannot enrol a second factor, but a database that predates
  // that guard could hold one, and leaving it would lock the demo out for good.
  await run('DELETE FROM two_factor_recovery_codes WHERE user_id = ANY($1)');
  await run('DELETE FROM user_two_factor WHERE user_id = ANY($1)');

  // The process-local mirrors of the two tables just emptied, or the seed would
  // think the templates and assignments it needs are still there.
  for (const [key, value] of [...workoutTemplates]) if (demoIds.includes(value.trainerId)) workoutTemplates.delete(key);
  for (const [key, value] of [...assignments]) if (demoIds.includes(value.traineeId) || demoIds.includes(value.trainerId)) assignments.delete(key);

  log('info', 'demo_reset', { accounts: demoIds.length, deleted });
  await seedDemoAccounts(ctx);
  return { deleted, accounts: demoIds.length };
}
