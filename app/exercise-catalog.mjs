const groups = {
  Chest: [
    'Barbell bench press|Barbell','Incline barbell bench press|Barbell','Decline barbell bench press|Barbell','Dumbbell bench press|Dumbbells','Incline dumbbell press|Dumbbells','Dumbbell fly|Dumbbells','Cable chest fly|Cable','Low-to-high cable fly|Cable','Machine chest press|Machine','Pec deck fly|Machine','Push-up|Bodyweight','Incline push-up|Bodyweight','Decline push-up|Bodyweight','Diamond push-up|Bodyweight','Chest dip|Dip bars','Dumbbell pullover|Dumbbells'
  ],
  Back: [
    'Deadlift|Barbell','Romanian deadlift|Barbell','Pull-up|Pull-up bar','Chin-up|Pull-up bar','Neutral-grip pull-up|Pull-up bar','Lat pulldown|Cable','Wide-grip lat pulldown|Cable','Seated cable row|Cable','Barbell bent-over row|Barbell','Pendlay row|Barbell','T-bar row|Machine','Single-arm dumbbell row|Dumbbells','Chest-supported dumbbell row|Dumbbells','Machine row|Machine','Inverted row|Bodyweight','Straight-arm pulldown|Cable','Face pull|Cable','Barbell shrug|Barbell','Dumbbell shrug|Dumbbells','Back extension|Bodyweight'
  ],
  Shoulders: [
    'Standing overhead press|Barbell','Seated shoulder press|Dumbbells','Arnold press|Dumbbells','Machine shoulder press|Machine','Dumbbell lateral raise|Dumbbells','Cable lateral raise|Cable','Front raise|Dumbbells','Reverse fly|Dumbbells','Rear delt machine fly|Machine','Upright row|Barbell','Pike push-up|Bodyweight','Handstand push-up|Bodyweight','Landmine press|Landmine','Y raise|Dumbbells'
  ],
  Biceps: [
    'Barbell curl|Barbell','EZ-bar curl|EZ bar','Dumbbell curl|Dumbbells','Hammer curl|Dumbbells','Incline dumbbell curl|Dumbbells','Preacher curl|Machine','Cable curl|Cable','Concentration curl|Dumbbell','Reverse curl|Barbell','Zottman curl|Dumbbells','Chin-up biceps curl|Pull-up bar'
  ],
  Triceps: [
    'Cable triceps extension|Cable','Rope triceps pushdown|Cable','Overhead cable extension|Cable','Skull crusher|EZ bar','Close-grip bench press|Barbell','Dumbbell triceps kickback|Dumbbells','Overhead dumbbell extension|Dumbbell','Bench dip|Bench','Parallel bar dip|Dip bars','Diamond push-up|Bodyweight'
  ],
  Quadriceps: [
    'Back squat|Barbell','Front squat|Barbell','Goblet squat|Dumbbell','Hack squat|Machine','Leg press|Machine','Leg extension|Machine','Bulgarian split squat|Dumbbells','Walking lunge|Dumbbells','Reverse lunge|Dumbbells','Forward lunge|Bodyweight','Step-up|Bench','Sissy squat|Bodyweight','Wall sit|Bodyweight','Cyclist squat|Dumbbell','Pistol squat|Bodyweight'
  ],
  Hamstrings: [
    'Romanian deadlift|Barbell','Stiff-leg deadlift|Barbell','Good morning|Barbell','Lying leg curl|Machine','Seated leg curl|Machine','Nordic hamstring curl|Bodyweight','Glute-ham raise|Machine','Single-leg Romanian deadlift|Dumbbells','Kettlebell swing|Kettlebell','Sliding leg curl|Sliders'
  ],
  Glutes: [
    'Barbell hip thrust|Barbell','Glute bridge|Bodyweight','Single-leg glute bridge|Bodyweight','Cable pull-through|Cable','Cable kickback|Cable','Donkey kick|Bodyweight','Fire hydrant|Bodyweight','Sumo squat|Dumbbell','Curtsy lunge|Dumbbells','Frog pump|Bodyweight','Lateral band walk|Resistance band','Clamshell|Resistance band'
  ],
  Calves: [
    'Standing calf raise|Machine','Seated calf raise|Machine','Single-leg calf raise|Bodyweight','Donkey calf raise|Machine','Calf press|Leg press','Tibialis raise|Bodyweight','Jump rope|Jump rope'
  ],
  Core: [
    'Plank|Bodyweight','Side plank|Bodyweight','Dead bug|Bodyweight','Bird dog|Bodyweight','Crunch|Bodyweight','Bicycle crunch|Bodyweight','Reverse crunch|Bodyweight','Hanging leg raise|Pull-up bar','Captain chair knee raise|Machine','Ab wheel rollout|Ab wheel','Cable crunch|Cable','Pallof press|Cable','Russian twist|Medicine ball','Mountain climber|Bodyweight','V-up|Bodyweight','Hollow body hold|Bodyweight','Farmer carry|Dumbbells','Suitcase carry|Dumbbell','Wood chop|Cable','Bear crawl|Bodyweight'
  ],
  Olympic: [
    'Clean and jerk|Barbell','Snatch|Barbell','Power clean|Barbell','Hang clean|Barbell','Power snatch|Barbell','Hang snatch|Barbell','Clean pull|Barbell','Snatch pull|Barbell','Push press|Barbell','Split jerk|Barbell','Thruster|Barbell','Overhead squat|Barbell'
  ],
  Kettlebell: [
    'Kettlebell swing|Kettlebell','Kettlebell goblet squat|Kettlebell','Kettlebell clean|Kettlebell','Kettlebell snatch|Kettlebell','Kettlebell press|Kettlebell','Turkish get-up|Kettlebell','Kettlebell windmill|Kettlebell','Kettlebell halo|Kettlebell','Kettlebell high pull|Kettlebell','Kettlebell farmer carry|Kettlebells'
  ],
  Functional: [
    'Battle rope waves|Battle ropes','Sled push|Sled','Sled pull|Sled','Tire flip|Tire','Box jump|Plyo box','Broad jump|Bodyweight','Burpee|Bodyweight','Medicine ball slam|Medicine ball','Wall ball|Medicine ball','TRX row|Suspension trainer','TRX chest press|Suspension trainer','Sandbag carry|Sandbag','Rope climb|Rope','Bear crawl|Bodyweight','Crab walk|Bodyweight'
  ],
  Cardio: [
    'Treadmill running|Treadmill','Outdoor running|None','Walking|None','Incline walking|Treadmill','Cycling|Bicycle','Stationary bike|Exercise bike','Rowing|Rowing machine','Elliptical trainer|Elliptical','Stair climber|Machine','Jump rope|Jump rope','Swimming|Pool','Ski erg|Ski erg','Assault bike|Air bike','High knees|Bodyweight','Jumping jack|Bodyweight','Shadow boxing|Bodyweight'
  ],
  Mobility: [
    'Cat-cow stretch|Bodyweight','Child pose|Bodyweight','Downward dog|Bodyweight','Cobra stretch|Bodyweight','Hip flexor stretch|Bodyweight','Pigeon pose|Bodyweight','World greatest stretch|Bodyweight','Thoracic rotation|Bodyweight','Shoulder dislocate|Resistance band','Ankle dorsiflexion stretch|Bodyweight','Deep squat hold|Bodyweight','Hamstring stretch|Bodyweight','Figure-four stretch|Bodyweight','Foam roll quadriceps|Foam roller','Foam roll upper back|Foam roller'
  ]
};

const catalogEntries = Object.entries(groups).flatMap(([muscleGroup,entries])=>entries.map((entry,index)=>{
  const [name,equipment]=entry.split('|');
  return {id:`catalog_${muscleGroup.toLowerCase()}_${index+1}`,name,muscleGroup,equipment};
}));

export const exerciseCatalog = [...new Map(catalogEntries.map(item=>[item.name.toLocaleLowerCase(),item])).values()];
