const CHANNEL_NAME = 'jimbro'

export const PAGE_NOTICES = ['rows-written', 'sync-settled', 'open-session-pulled'] as const
export type PageNotice = (typeof PAGE_NOTICES)[number]
// Tabs share one database, so another tab's writes and syncs change what this page shows too.
export type NoticeSource = 'this-tab' | 'other-tab'

const messageHandlers: Array<(event: MessageEvent<unknown>) => void> = []

let channel: BroadcastChannel | null = null
let listensForPageLifecycle = false
let hidden = false

// The back/forward cache evicts a page whose channel gets a message, and the next page always announces
// sync-settled, so an open channel made every Back a full reload. The channel closes on pagehide, stays closed while
// the page is hidden, and opens again when a restored page has someone listening. A restored page missed the notices
// sent meanwhile, and navigation.ts reloads it when the database changed. The channel opens on first use, so the
// unit tests can stub window before anything touches it.
const openChannel = () => {
  if (!listensForPageLifecycle) {
    listensForPageLifecycle = true
    window.addEventListener('pagehide', () => {
      hidden = true
      channel?.close()
      channel = null
    })
    window.addEventListener('pageshow', (event) => {
      hidden = false
      if (event.persisted && messageHandlers.length > 0) openChannel()
    })
  }
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    for (const handler of messageHandlers) channel.addEventListener('message', handler)
  }
  return channel
}

const isPageNotice = (data: unknown): data is PageNotice => PAGE_NOTICES.some((notice) => notice === data)

// Tells the pages in this tab and in the other tabs. A BroadcastChannel never hears its own messages, so this tab
// hears a jimbro: window event instead, which the specs listen for too.
export const announce = (notice: PageNotice) => {
  window.dispatchEvent(new CustomEvent(`jimbro:${notice}`))
  // A sync that ends after pagehide must not open the channel again.
  if (!hidden) openChannel().postMessage(notice)
}

// Calls handle for each notice from this tab and from every other tab.
export const onPageNotice = (handle: (notice: PageNotice, source: NoticeSource) => void) => {
  for (const notice of PAGE_NOTICES) window.addEventListener(`jimbro:${notice}`, () => handle(notice, 'this-tab'))
  const handler = (event: MessageEvent<unknown>) => {
    if (isPageNotice(event.data)) handle(event.data, 'other-tab')
  }
  messageHandlers.push(handler)
  if (channel) channel.addEventListener('message', handler)
  else if (!hidden) openChannel()
}
