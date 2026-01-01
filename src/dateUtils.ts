export const getWeekOfYear = (date: Date): string => {
  const oneJan = new Date(date.getFullYear(), 0, 1)
  const numberOfDays = Math.floor((date.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000))
  const weekNumber = Math.ceil((oneJan.getDay() + 1 + numberOfDays) / 7)
  const year = date.getFullYear()

  return constructWeekKey(weekNumber === 53 ? { year: year + 1, week: 1 } : { year, week: weekNumber })
}

export const getWeeksKeysFromDateToNow = (date: Date): string[] => {
  const weeks = []
  let currentDate = new Date(date)

  while (currentDate <= new Date()) {
    weeks.push(getWeekOfYear(currentDate))
    currentDate.setDate(currentDate.getDate() + 7)
  }

  return weeks
}

export const getSimpleDate = (date: Date): string => {
  return date.toISOString().split('T')[0]
}

const constructWeekKey = ({ year, week }: { year: number; week: number }): string => {
  return `${year}-W${week}`
}

export const extractWeekKeyNumbers = (weekKey: string): { year: number; week: number } => {
  const [year, week] = weekKey.split('-')
  return { year: parseInt(year), week: parseInt(week.replace('W', '')) }
}
