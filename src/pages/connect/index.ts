import ConnectPage from './ConnectPage'

export const mount = async (signal: AbortSignal) => {
  await new ConnectPage(signal).show(new URLSearchParams(location.search).get('request') ?? '')
}
