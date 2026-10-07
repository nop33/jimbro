const CHANNEL_NAME = 'jimbro'

export const PAGE_NOTICES = ['rows-written', 'sync-settled', 'open-session-pulled'] as const
export type PageNotice = (typeof PAGE_NOTICES)[number]
// Tabs share one database, so another tab's writes and syncs change what this page shows too.
export type NoticeSource = 'this-tab' | 'other-tab'

const channel = new BroadcastChannel(CHANNEL_NAME)

const isPageNotice = (data: unknown): data is PageNotice => PAGE_NOTICES.some((notice) => notice === data)

// Tells the pages in this tab and in the other tabs. A BroadcastChannel never hears its own messages, so this tab
// hears a jimbro: window event instead, which the specs listen for too.
export const announce = (notice: PageNotice) => {
  window.dispatchEvent(new CustomEvent(`jimbro:${notice}`))
  channel.postMessage(notice)
}

// Calls handle for each notice from this tab and from every other tab.
export const onPageNotice = (handle: (notice: PageNotice, source: NoticeSource) => void) => {
  for (const notice of PAGE_NOTICES) window.addEventListener(`jimbro:${notice}`, () => handle(notice, 'this-tab'))
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (isPageNotice(event.data)) handle(event.data, 'other-tab')
  })
}
