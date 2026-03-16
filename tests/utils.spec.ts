import { test, expect } from '@playwright/test'

test.describe('Utils: nodeFromTemplate', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('throws error when template is not found', async ({ page }) => {
    const errorMessage = await page.evaluate(async () => {
      const { nodeFromTemplate } = await import('/src/utils.ts')
      try {
        nodeFromTemplate('#non-existent-template')
        return 'No error thrown'
      } catch (e: any) {
        return e.message
      }
    })

    expect(errorMessage).toBe('Template with id #non-existent-template not found')
  })

  test('returns DocumentFragment when template exists', async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { nodeFromTemplate } = await import('/src/utils.ts')

      // Create a template element
      const template = document.createElement('template')
      template.id = 'test-template'
      template.innerHTML = '<div class="test-content">Hello</div>'
      document.body.appendChild(template)

      try {
        const node = nodeFromTemplate('#test-template')
        return {
          isDocumentFragment: node instanceof DocumentFragment,
          content: node.querySelector('.test-content')?.textContent
        }
      } finally {
        document.body.removeChild(template)
      }
    })

    expect(result.isDocumentFragment).toBe(true)
    expect(result.content).toBe('Hello')
  })
})
