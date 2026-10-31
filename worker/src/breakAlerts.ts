import { DurableObject } from 'cloudflare:workers'
import { parsePushTarget, sendPush, type PushTarget, type VapidKeys } from './webPush'

// Break alerts: while a break runs and the app is out of sight, the app asks the worker to notify the phone when the
// break ends. Each user has one BreakAlarm Durable Object, which keeps their device's push subscription and the break
// it waits for, and its alarm sends the push at the break's end. Coming back to the app cancels it, since the page
// then rings itself.

export interface BreakAlertsEnv {
  BREAK_ALARMS: DurableObjectNamespace<BreakAlarm>
  // The VAPID key pair (see webPush.ts) and the contact for the push services, as secrets. Without them the worker
  // answers not_configured and the app offers no break alerts.
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
}

// What the notification says, and the page a tap on it opens.
export interface BreakAlert {
  title: string
  body: string
  url: string
}

// The longest break the app schedules an alert for. Anything further away is a mistake.
const LONGEST_BREAK_MS = 60 * 60 * 1000

const vapidKeys = (env: BreakAlertsEnv): VapidKeys | null =>
  env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT
    ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }
    : null

export class BreakAlarm extends DurableObject<BreakAlertsEnv> {
  // A device has one subscription, and the user one device, so a new one replaces the last.
  async subscribe(target: PushTarget) {
    await this.ctx.storage.put('target', target)
  }

  async unsubscribe() {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.delete(['target', 'alert'])
  }

  // Waits for the break that ends at endsAt, replacing any other. Resolves to false when there is no subscription to
  // notify.
  async schedule(endsAt: number, alert: BreakAlert) {
    if (!(await this.ctx.storage.get<PushTarget>('target'))) return false
    await this.ctx.storage.put('alert', alert)
    await this.ctx.storage.setAlarm(endsAt)
    return true
  }

  async cancel() {
    await this.ctx.storage.deleteAlarm()
    await this.ctx.storage.delete('alert')
  }

  async alarm() {
    const [target, alert] = await Promise.all([
      this.ctx.storage.get<PushTarget>('target'),
      this.ctx.storage.get<BreakAlert>('alert')
    ])
    await this.ctx.storage.delete('alert')
    const keys = vapidKeys(this.env)
    if (!target || !alert || !keys) return
    // A failed push is not retried: by the time a retry ran, the break would be long over.
    try {
      if ((await sendPush(target, JSON.stringify(alert), keys)) === 'gone') await this.ctx.storage.delete('target')
    } catch (error) {
      console.error('break alert failed', error)
    }
  }
}

const alarmOf = (env: BreakAlertsEnv, userId: string) => env.BREAK_ALARMS.get(env.BREAK_ALARMS.idFromName(userId))

const readJson = async (request: Request): Promise<unknown> => {
  try {
    return await request.json()
  } catch {
    return undefined
  }
}

const text = (value: unknown, longest: number) => (typeof value === 'string' && value.length <= longest ? value : null)

const parseSchedule = (value: unknown, now: number) => {
  if (typeof value !== 'object' || value === null) return null
  const { endsAt, title, body, url } = value as Record<string, unknown>
  if (
    typeof endsAt !== 'number' ||
    !Number.isFinite(endsAt) ||
    endsAt < now - 5000 ||
    endsAt > now + LONGEST_BREAK_MS
  ) {
    return null
  }
  const alert = { title: text(title, 120), body: text(body, 200), url: text(url, 300) }
  // A path on the app's own origin: "//host" and "/\host" would open another site.
  if (!alert.title || alert.body === null || !alert.url || !/^\/(?![/\\])/.test(alert.url)) return null
  return { endsAt, alert: alert as BreakAlert }
}

// GET /api/break-alerts: the public key the app subscribes with.
// POST /api/break-alerts/subscribe { endpoint, keys }: the device's push subscription.
// POST /api/break-alerts/unsubscribe: forgets it, and any break waiting.
// POST /api/break-alerts/schedule { endsAt, title, body, url }: notifies at endsAt, in ms since the epoch.
// POST /api/break-alerts/cancel: the break ended in sight, or was skipped.
export const handleBreakAlerts = async (request: Request, env: BreakAlertsEnv, userId: string, path: string) => {
  const keys = vapidKeys(env)
  if (!keys) return Response.json({ error: 'not_configured' }, { status: 503 })
  if (path === '/api/break-alerts' && request.method === 'GET') return Response.json({ publicKey: keys.publicKey })
  if (request.method !== 'POST') return Response.json({ error: 'not found' }, { status: 404 })

  const alarm = alarmOf(env, userId)
  switch (path) {
    case '/api/break-alerts/subscribe': {
      const target = parsePushTarget(await readJson(request))
      if (!target) return Response.json({ error: 'invalid_subscription' }, { status: 400 })
      await alarm.subscribe(target)
      return Response.json({ ok: true })
    }
    case '/api/break-alerts/unsubscribe':
      await alarm.unsubscribe()
      return Response.json({ ok: true })
    case '/api/break-alerts/schedule': {
      const parsed = parseSchedule(await readJson(request), Date.now())
      if (!parsed) return Response.json({ error: 'invalid_break' }, { status: 400 })
      return Response.json({ scheduled: await alarm.schedule(parsed.endsAt, parsed.alert) })
    }
    case '/api/break-alerts/cancel':
      await alarm.cancel()
      return Response.json({ ok: true })
  }
  return Response.json({ error: 'not found' }, { status: 404 })
}
