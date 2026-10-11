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

// "Oct 1", or "Oct 1, 2025" outside the current year, which fits a phone-width line where a full date wraps.
export const formatShortDate = (date: Date, now = new Date()): string =>
  date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric'
  })
