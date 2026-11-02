// Prints a new VAPID key pair for break alerts, as the worker's secrets take them (src/webPush.ts):
//   node scripts/vapid-keys.mjs
// then `vp exec wrangler secret put VAPID_PUBLIC_KEY`, and the same for VAPID_PRIVATE_KEY and VAPID_SUBJECT
// (a mailto: or https: URL the push services can reach you at).
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey)
console.log(`VAPID_PUBLIC_KEY=${Buffer.from(raw).toString('base64url')}`)
console.log(`VAPID_PRIVATE_KEY=${d}`)
