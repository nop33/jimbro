import { type ActivityDay, type ActivityMetric, type ActivityWeek, activityLevels } from '../../activityMap'
import { parseSimpleDate } from '../../dateUtils'

const formatNumber = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(value)
const formatMonth = (date: string) => new Intl.DateTimeFormat('en-US', { month: 'short' }).format(parseSimpleDate(date))
const formatDay = (date: string) =>
  new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(parseSimpleDate(date))

const formatAmount = (metric: ActivityMetric, value: number) =>
  metric === 'sets' ? `${formatNumber(value)} ${value === 1 ? 'set' : 'sets'}` : `${formatNumber(Math.floor(value))} kg`

// The last twelve months as a grid of days, shaded by the sets or the volume logged on each. A tap on a day names it
// and its amount in the line under the map, where the year's total stands otherwise. The squares are too small to
// tap one by one with a screen reader, so the map is hidden from it and the line says what the map shows.
export class ActivityMap {
  private readonly map: HTMLElement
  private readonly scroller: HTMLElement
  private readonly summary: HTMLElement
  private readonly metricField: HTMLFieldSetElement
  private readonly cells = new Map<string, HTMLElement>()
  private days: Array<ActivityDay> = []
  private selected?: ActivityDay

  constructor() {
    this.map = document.getElementById('activity-map') as HTMLElement
    this.scroller = document.getElementById('activity-scroller') as HTMLElement
    this.summary = document.getElementById('activity-summary') as HTMLElement
    this.metricField = document.querySelector('.activity-metric') as HTMLFieldSetElement

    this.metricField.addEventListener('change', () => this.shade())
    this.map.addEventListener('click', (event) => {
      const date = (event.target as HTMLElement).closest<HTMLElement>('.activity-cell')?.dataset.date
      const day = this.days.find((candidate) => candidate.date === date && !candidate.future)
      this.selected = day === undefined || day === this.selected ? undefined : day
      this.shade()
    })
  }

  private get metric(): ActivityMetric {
    const checked = this.metricField.querySelector<HTMLInputElement>('input:checked')
    return checked?.value === 'volume' ? 'volume' : 'sets'
  }

  show(weeks: Array<ActivityWeek>, today: string) {
    this.days = weeks.flatMap((week) => week.days)
    this.cells.clear()
    const nodes: Array<HTMLElement> = []
    for (const week of weeks) {
      const month = document.createElement('span')
      month.className = 'activity-month'
      // The first column only names its month when the 1st falls in it, so a part month at the left stays unnamed.
      if (week.monthStart !== undefined) month.textContent = formatMonth(week.monthStart)
      nodes.push(month)
      for (const day of week.days) {
        const cell = document.createElement('span')
        cell.className = 'activity-cell'
        cell.dataset.date = day.date
        if (day.future) cell.dataset.future = ''
        if (day.date === today) cell.setAttribute('aria-current', 'date')
        this.cells.set(day.date, cell)
        nodes.push(cell)
      }
    }
    this.map.replaceChildren(...nodes)
    this.shade()
    // Today at the right edge, as the map reads from the left.
    this.scroller.scrollLeft = this.scroller.scrollWidth
  }

  private shade() {
    const metric = this.metric
    const levelOf = activityLevels(this.days.map((day) => day[metric]))
    for (const day of this.days) {
      const cell = this.cells.get(day.date)
      if (cell === undefined) continue
      cell.dataset.level = String(levelOf(day[metric]))
      cell.title = `${formatDay(day.date)}: ${formatAmount(metric, day[metric])}`
      cell.toggleAttribute('data-selected', day === this.selected)
    }

    if (this.selected !== undefined) {
      const amount = this.selected[metric]
      this.summary.textContent = `${formatDay(this.selected.date)} · ${amount > 0 ? formatAmount(metric, amount) : 'Rest day'}`
      return
    }
    const active = this.days.filter((day) => day.sets > 0)
    const total = active.reduce((sum, day) => sum + day[metric], 0)
    this.summary.textContent =
      active.length === 0
        ? 'Nothing logged yet'
        : `${formatAmount(metric, total)} on ${active.length} ${active.length === 1 ? 'day' : 'days'}`
  }
}
