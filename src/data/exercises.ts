export interface Exercise {
  id: string;
  name: string;
  muscle: 'Quads' | 'Calves' | 'Hamstrings' | 'Core' | 'Chest' | 'Triceps' | 'Shoulders' | 'Back' | 'Biceps' | 'Traps';
  sets: number;
  reps: number;
}

export const exercises: Exercise[] = [
  {
    "id": '1',
    "name": "Free barbell squat",
    "muscle": "Quads",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '2',
    "name": "Seated calf raises",
    "muscle": "Calves",
    "sets": 4,
    "reps": 12
  },
  {
    "id": '3',
    "name": "Quad extensions",
    "muscle": "Quads",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '4',
    "name": "Hamstring curls",
    "muscle": "Hamstrings",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '5',
    "name": "Elevated standing calf raises",
    "muscle": "Calves",
    "sets": 4,
    "reps": 15
  },
  {
    "id": '6',
    "name": "Ab crunches",
    "muscle": "Core",
    "sets": 4,
    "reps": 15
  },
  {
    "id": '7',
    "name": "Lower back raises",
    "muscle": "Core",
    "sets": 4,
    "reps": 12
  },
  {
    "id": '8',
    "name": "Bench press",
    "muscle": "Chest",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '9',
    "name": "Bar pushdowns",
    "muscle": "Triceps",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '10',
    "name": "Side delt cable fly",
    "muscle": "Shoulders",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '11',
    "name": "Incline dumblell fly",
    "muscle": "Chest",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '12',
    "name": "Rope pushdowns",
    "muscle": "Triceps",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '13',
    "name": "Rear cable delt fly",
    "muscle": "Shoulders",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '14',
    "name": "Front delt cable fly",
    "muscle": "Shoulders",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '15',
    "name": "Pull down machine",
    "muscle": "Back",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '16',
    "name": "Cable curl",
    "muscle": "Biceps",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '17',
    "name": "Rowing machine",
    "muscle": "Back",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '18',
    "name": "Incline Bench Dumbbell Curl",
    "muscle": "Biceps",
    "sets": 4,
    "reps": 8
  },
  {
    "id": '19',
    "name": "Trap dumbell raises",
    "muscle": "Traps",
    "sets": 4,
    "reps": 8
  }
]
