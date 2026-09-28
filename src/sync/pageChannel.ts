const CHANNEL_NAME = 'jimbro'

export type PageNotice = 'rows-written' | 'sync-settled'

const channel = new BroadcastChannel(CHANNEL_NAME)

export const announce = (notice: PageNotice) => {
  channel.postMessage(notice)
}

export const onPageNotice = (handle: (notice: PageNotice) => void) => {
  channel.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.data === 'rows-written' || event.data === 'sync-settled') handle(event.data)
  })
}
