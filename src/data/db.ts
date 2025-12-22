import { templates } from "./templates"
import { workoutSessions, type WorkoutSessionStatus } from "./workoutSessions"
import { getWeekOfYear } from "../utils"

export interface WeekWorkoutSession {
  id: string;
  name: string;
  status: WorkoutSessionStatus | 'pending';
}

export const getCurrentWeekWorkoutSessions = () => {
  return getWeekWorkoutSessions(getWeekOfYear(new Date()))
}

export const getLastWeekWorkoutSessions = () => {
  return getWeekWorkoutSessions(getWeekOfYear(new Date()) - 1)
}

const getWeekWorkoutSessions = (week: number): Array<WeekWorkoutSession> => {
  const sessions = getWorkoutSessions().filter((w) => getWeekOfYear(w.date) === week)

  const templates = getTemplates()

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    status: sessions.find((s) => s.templateId === template.id)?.status || 'pending',
  }))
}

const getWorkoutSessions = () => workoutSessions

const getTemplates = () => templates
