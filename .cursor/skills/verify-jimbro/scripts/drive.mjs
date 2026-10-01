#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'

const base = process.env.JIMBRO_VERIFY_URL
if (!base) {
  console.error('JIMBRO_VERIFY_URL is not set')
  process.exit(1)
}

const artifactsRoot = process.env.JIMBRO_ARTIFACTS_DIR
const viewport = { width: 390, height: 844 }

async function withPage(fn) {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport })
  try {
    return await fn(page)
  } finally {
    await browser.close()
  }
}

async function capture(page, outDir, stem) {
  mkdirSync(outDir, { recursive: true })
  await page.screenshot({ path: resolve(outDir, `${stem}.png`), fullPage: true })
  const aria = await page.locator('body').ariaSnapshot()
  writeFileSync(resolve(outDir, `${stem}.aria.yml`), aria)
}

async function snapshot(route, outDir) {
  await withPage(async (page) => {
    const url = new URL(route, `${base}/`).href
    await page.goto(url, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1.app-header-title')
    await capture(page, resolve(outDir), 'page')
    writeFileSync(
      resolve(outDir, 'proof.txt'),
      [`feature: snapshot`, `url: ${page.url()}`, `entry: GET ${route}`].join('\n') + '\n',
    )
    console.log(`Wrote snapshot of ${page.url()} to ${outDir}`)
  })
}

async function driveHome() {
  const outDir = resolve(artifactsRoot, 'home')
  await withPage(async (page) => {
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('h1.app-header-title')
    const heading = await page.locator('h1.app-header-title').innerText()
    if (!heading.includes('Hey, gymbro.')) {
      throw new Error(`Home heading was "${heading}"`)
    }
    const start = page.getByRole('link', { name: 'Start workout' })
    if (!(await start.isVisible())) {
      throw new Error('Start workout link not visible')
    }
    await capture(page, outDir, 'home')

    await start.click()
    await page.waitForURL('**/workouts/**')
    await page.waitForSelector('h1.app-header-title')
    const workoutsHeading = await page.locator('h1.app-header-title').innerText()
    if (!workoutsHeading.includes('Workouts')) {
      throw new Error(`Workouts heading was "${workoutsHeading}"`)
    }
    const workoutsActive = page.locator('.nav-link.active[href="/workouts/"]')
    if (!(await workoutsActive.isVisible())) {
      throw new Error('Workouts bottom-nav link is not active')
    }
    await capture(page, outDir, 'workouts')

    writeFileSync(
      resolve(outDir, 'proof.txt'),
      [
        'feature: home',
        `homeUrl: ${base}/`,
        `afterClick: ${page.url()}`,
        'entry: Start workout link on /',
        `homeHeading: ${heading.trim()}`,
        `workoutsHeading: ${workoutsHeading.trim()}`,
      ].join('\n') + '\n',
    )
    console.log(`Home feature proved. Artifacts in ${outDir}`)
  })
}

const [cmd, a, b] = process.argv.slice(2)

if (cmd === 'snapshot') {
  if (!a || !b) {
    console.error('drive.mjs snapshot <route> <outDir>')
    process.exit(1)
  }
  await snapshot(a, b)
} else if (cmd === 'drive' && a === 'home') {
  if (!artifactsRoot) {
    console.error('JIMBRO_ARTIFACTS_DIR is not set')
    process.exit(1)
  }
  await driveHome()
} else {
  console.error('Usage: drive.mjs snapshot <route> <outDir> | drive.mjs drive home')
  process.exit(1)
}
