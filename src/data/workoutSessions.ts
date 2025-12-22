import type { Exercise } from "./exercises";
import type { Template } from "./templates";

export type WorkoutSessionStatus = 'completed' | 'skipped' | 'incomplete';

interface ExerciseSetExecution {
  reps: number;
  weight: number;
}

interface ExerciseExecution {
  exerciseId: Exercise['id'];
  sets: Array<ExerciseSetExecution>;
  notes?: string;
}

interface WorkoutSession {
  date: Date;
  templateId: Template['id'];
  exercises: Array<ExerciseExecution>;
  location: string;
  status: WorkoutSessionStatus;
  notes?: string;
}

export const workoutSessions: WorkoutSession[] = [
  {
    date: new Date('2025-12-15'),
    templateId: '3',
    location: 'Singapore',
    status: 'completed',
    exercises: [
    {
      exerciseId: '15',
      sets: [
        { reps: 8, weight: 60 },
        { reps: 8, weight: 60 },
        { reps: 8, weight: 70 },
        { reps: 8, weight: 70 }
      ]
    },
    {
      exerciseId: '16',
      sets: [
        { reps: 8, weight: 16.25 },
        { reps: 8, weight: 16.25 },
        { reps: 8, weight: 16.25 },
        { reps: 8, weight: 16.25 }
      ]
    },
    {
      exerciseId: '17',
      sets: [
        { reps: 8, weight: 70 },
        { reps: 8, weight: 80 },
        { reps: 8, weight: 80 },
        { reps: 8, weight: 80 }
      ]
    },
    {
      exerciseId: '18',
      sets: [
        { reps: 8, weight: 14 },
        { reps: 8, weight: 14 },
        { reps: 8, weight: 14 },
        { reps: 8, weight: 14 }
      ]
    },
    {
      exerciseId: '19',
      sets: [
        { reps: 8, weight: 80 },
        { reps: 8, weight: 80 },
        { reps: 8, weight: 80 },
        { reps: 8, weight: 80 }
      ]
    },
    {
      exerciseId: '6',
      sets: [
        { reps: 8, weight: 70 },
        { reps: 8, weight: 70 },
        { reps: 8, weight: 70 },
        { reps: 8, weight: 70 }
      ]
    }
    ]
  },
  {
    date: new Date('2025-12-17'),
    templateId: '1',
    location: 'Singapore',
    status: 'completed',
    exercises: [
      {
        exerciseId: '1',
        sets: [
          {
            reps: 8,
            weight: 72.5
          },
          {
            reps: 8,
            weight: 72.5
          },
          {
            reps: 8,
            weight: 72.5
          },
          {
            reps: 8,
            weight: 72.5
          }
        ]
      },
      {
        exerciseId: '2',
        sets: [
          {
            reps: 12,
            weight: 80
          },
          {
            reps: 12,
            weight: 80
          },
          {
            reps: 12,
            weight: 80
          },
          {
            reps: 12,
            weight: 80
          }
        ]
      },
      {
        exerciseId: '3',
        sets: [
          {
            reps: 8,
            weight: 87.5
          },
          {
            reps: 8,
            weight: 87.5
          },
          {
            reps: 8,
            weight: 87.5
          },
          {
            reps: 8,
            weight: 87.5
          }
        ]
      },
      {
        exerciseId: '4',
        sets: [
          {
            reps: 8,
            weight: 65
          },
          {
            reps: 8,
            weight: 75
          },
          {
            reps: 8,
            weight: 67.5
          },
          {
            reps: 8,
            weight: 67.5
          }
        ]
      },
      {
        exerciseId: '5',
        sets: [
          {
            reps: 8,
            weight: 80
          },
          {
            reps: 8,
            weight: 80
          },
          {
            reps: 8,
            weight: 80
          },
          {
            reps: 8,
            weight: 80
          }
        ]
      },
      {
        exerciseId: '6',
        sets: [
          {
            reps: 20,
            weight: 0
          },
          {
            reps: 20,
            weight: 0
          },
          {
            reps: 20,
            weight: 0
          },
          {
            reps: 20,
            weight: 0
          }
        ]
      },
      {
        exerciseId: '7',
        sets: [
          {
            reps: 12,
            weight: 20
          },
          {
            reps: 12,
            weight: 20
          },
          {
            reps: 12,
            weight: 20
          },
          {
            reps: 12,
            weight: 20
          }
        ]
      }
    ]
  },
  {
    date: new Date('2025-12-19'),
    templateId: '2',
    location: 'Singapore',
    status: 'completed',
    exercises: [
      {
        exerciseId: '8',
        sets: [
          {
            reps: 8,
            weight: 72.5
          },
          {
            reps: 8,
            weight: 72.5
          },
          {
            reps: 8,
            weight: 72.5
          },
          {
            reps: 8,
            weight: 72.5
          }
        ]
      },{
        exerciseId: '9',
        sets: [
          {
            reps: 8,
            weight: 59
          },
          {
            reps: 8,
            weight: 59
          },
          {
            reps: 8,
            weight: 59
          },
          {
            reps: 8,
            weight: 59
          }
        ]
      },{
        exerciseId: '10',
        sets: [
          {
            reps: 8,
            weight: 10
          },
          {
            reps: 8,
            weight: 10
          },
          {
            reps: 8,
            weight: 10
          },
          {
            reps: 8,
            weight: 10
          }
        ]
      },{
        exerciseId: '11',
        sets: [
          {
            reps: 8,
            weight: 14
          },
          {
            reps: 8,
            weight: 14
          },
          {
            reps: 8,
            weight: 14
          },
          {
            reps: 8,
            weight: 14
          }
        ]
      },{
        exerciseId: '12',
        sets: [
          {
            reps: 8,
            weight: 7.5
          },
          {
            reps: 8,
            weight: 5
          },
          {
            reps: 8,
            weight: 5
          },
          {
            reps: 8,
            weight: 5
          }
        ]
      },{
        exerciseId: '13',
        sets: [
          {
            reps: 8,
            weight: 12.5
          },
          {
            reps: 8,
            weight: 12.5
          },
          {
            reps: 8,
            weight: 12.5
          },
          {
            reps: 8,
            weight: 12.5
          }
        ]
      }
    ]
  }
]
