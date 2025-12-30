export const getWeekOfYear = (date: Date): string => {
  const oneJan = new Date(date.getFullYear(), 0, 1)
  const numberOfDays = Math.floor((date.getTime() - oneJan.getTime()) / (24 * 60 * 60 * 1000))
  const weekNumber = Math.ceil((oneJan.getDay() + 1 + numberOfDays) / 7)
  const year = date.getFullYear()

  return weekNumber === 53 ? `${year + 1}-W1` : `${year}-W${weekNumber}`
}

export const nodeFromTemplate = (templateId: string) => {
  const template = document.querySelector(templateId) as HTMLTemplateElement
  if (!template) {
    throw new Error(`Template with id ${templateId} not found`)
  }
  return document.importNode(template.content, true)
}

export const setTextContent = (
  selector: string,
  text: string,
  parent: HTMLElement | DocumentFragment = document.body
) => {
  const element = parent.querySelector(selector) as HTMLElement
  if (!element) {
    throw new Error(`Element with selector ${selector} not found in parent ${parent}`)
  }
  element.textContent = text
}
