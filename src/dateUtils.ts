export const getWeekOfYear = (date: Date): string => {
  const oneJan = new Date(date.getFullYear(), 0, 1)
  const numberOfDays = Math.floor((date.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000))
  const weekNumber = Math.ceil((oneJan.getDay() + numberOfDays) / 7)
  const year = date.getFullYear()

  return constructWeekKey(weekNumber === 53 ? { year: year + 1, week: 1 } : { year, week: weekNumber })
}

export const getWeeksKeysFromDateToNow = (date: Date, now = new Date()): string[] => {
  const weeks: string[] = []
  const currentDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  while (currentDate <= endDate) {
    const week = getWeekOfYear(currentDate)
    if (weeks.at(-1) !== week) {
      weeks.push(week)
    }

    currentDate.setDate(currentDate.getDate() + 1)
  }

  return weeks
}

export const getSimpleDate = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

export const parseSimpleDate = (date: string): Date => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) return new Date(date)

  const [, year, month, day] = match
  return new Date(Number(year), Number(month) - 1, Number(day))
}

const constructWeekKey = ({ year, week }: { year: number; week: number }): string => {
  return `${year}-W${week}`
}

export const extractWeekKeyNumbers = (weekKey: string): { year: number; week: number } => {
  const [year, week] = weekKey.split('-')
  return { year: parseInt(year), week: parseInt(week.replace('W', '')) }
}

export const daysAgo = (date: Date): number => {
  return Math.floor((new Date().getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
}
