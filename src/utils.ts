export const getWeekOfYear = (date: Date) => {
  const oneJan = new Date(date.getFullYear(), 0, 1);
  const numberOfDays = Math.floor((date.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000));
  const weekNumber = Math.ceil((((oneJan.getDay() + 1) + numberOfDays) / 7));

  return weekNumber;
}
