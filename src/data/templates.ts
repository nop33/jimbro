import type { Exercise } from "./exercises";

export interface Template {
  id: string;
  name: string;
  exercises: Array<Exercise['id']>;
}

export const templates: Template[] = [
  {
    "id": '1',
    "name": "Leg day",
    "exercises": ['1', '2', '3', '4', '5', '6', '7']
  },
  {
    "id": '2',
    "name": "Push day",
    "exercises": ['8', '9', '10', '11', '12', '13']
  },
  {
    "id": '3',
    "name": "Pull day",
    "exercises": ['15', '16', '17', '18', '19', '6']
  }
]
