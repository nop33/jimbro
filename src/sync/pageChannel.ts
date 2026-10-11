export const PAGE_NOTICES = ['rows-written', 'sync-settled'] as const
export type PageNotice = (typeof PAGE_NOTICES)[number]

// Each user runs the app in one tab on one device, so a notice only needs to reach the page that sent it. The page
// hears it as a jimbro: window event, which the specs listen for too.
export const announce = (notice: PageNotice) => {
  window.dispatchEvent(new CustomEvent(`jimbro:${notice}`))
}

// Calls handle for each notice this page announces.
export const onPageNotice = (handle: (notice: PageNotice) => void) => {
  for (const notice of PAGE_NOTICES) window.addEventListener(`jimbro:${notice}`, () => handle(notice))
}
