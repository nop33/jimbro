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
