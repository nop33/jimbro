import { getSimpleDate } from '../dateUtils'
import { getFestive } from '../settings'

// Christmas, from Nov 20 to Jan 6 on the phone's own calendar, unless Settings turned festive touches off. In season
// <html> carries data-season="christmas", which every decoration in src/style.css keys on: the lights under each header,
// the snow, the bauble Start button, the presents on the calendar and the Santa hat on the break timer. The few that
// need script (Home's greeting, hat and advent calendar, the festive celebrations and the break's elf lines) ask
// christmas().

export const inChristmasSeason = (date: string): boolean => {
  const monthDay = date.slice(5)
  return monthDay >= '11-20' || monthDay <= '01-06'
}

export const christmas = (): boolean => getFestive() && inChristmasSeason(getSimpleDate(new Date()))

const FLAKES = 24

// A light snowfall over every page: flakes fall behind taps, from top to bottom, each at its own speed, sway and
// size. They move by transform alone, on the compositor. Under reduced motion src/style.css stops them where they
// are, scattered down the screen. The layer outlives a page, like the break timer, so the snow never restarts.
const letItSnow = () => {
  if (document.querySelector('.season-snow')) return
  const layer = document.createElement('div')
  layer.className = 'season-snow'
  layer.setAttribute('aria-hidden', 'true')
  layer.dataset.persist = ''
  for (let i = 0; i < FLAKES; i++) {
    const flake = document.createElement('i')
    const size = 2 + Math.random() * 4
    const duration = 9 + Math.random() * 10
    flake.style.setProperty('--x', `${(Math.random() * 100).toFixed(1)}vw`)
    flake.style.setProperty('--y', `${(Math.random() * 100).toFixed(1)}vh`)
    flake.style.setProperty('--size', `${size.toFixed(1)}px`)
    flake.style.setProperty('--sway', `${(Math.random() * 40 - 20).toFixed(0)}px`)
    flake.style.setProperty('--opacity', (0.2 + Math.random() * 0.45).toFixed(2))
    flake.style.animationDuration = `${duration.toFixed(1)}s`
    // A negative delay starts each flake part way down, so the first frame is already snowing.
    flake.style.animationDelay = `${(-Math.random() * duration).toFixed(1)}s`
    layer.append(flake)
  }
  document.body.append(layer)
}

// Puts the season on the page, or takes it off: on load, when the app comes back into view (the date may have moved
// on), and when Settings turns festive touches on or off.
export const applySeason = () => {
  const root = document.documentElement
  if (christmas()) {
    root.dataset.season = 'christmas'
    letItSnow()
  } else {
    delete root.dataset.season
    document.querySelector('.season-snow')?.remove()
  }
}
