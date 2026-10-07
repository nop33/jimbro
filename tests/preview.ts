// The preview server that serves the production build, started by playwright.config.ts. It listens on an IP because
// in a container localhost is also ::1: a server on localhost listens there alone, and a Node client connecting to
// localhost tries only 127.0.0.1.
export const PREVIEW_HOST = '127.0.0.1'
export const PREVIEW_PORT = 4173
export const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`
