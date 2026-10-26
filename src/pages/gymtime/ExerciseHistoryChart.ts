import { historyChartEnabled, isRepsSet, type ExerciseKind } from '../../db/exerciseLogging'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { parseSimpleDate } from '../../dateUtils'
import { setTextContent } from '../../utils'
import { loadChartJs } from './chartJs'
import type { Chart as ChartInstance, ChartDataset, Plugin } from 'chart.js'

export interface ExerciseHistoryTarget {
  id: string
  name: string
  kind: ExerciseKind
}

class ExerciseHistoryChart {
  private dialog = document.getElementById('exercise-history-dialog') as HTMLDialogElement
  private canvas = document.getElementById('exercise-history-chart') as HTMLCanvasElement
  private closeBtn = this.dialog.querySelector('.close-dialog-btn') as HTMLButtonElement
  private gymKey = this.dialog.querySelector('#exercise-history-gyms') as HTMLUListElement
  private metricButtons = [...this.dialog.querySelectorAll<HTMLButtonElement>('.history-metric')]
  private chartInstance: ChartInstance | null = null

  constructor(signal: AbortSignal) {
    for (const button of this.metricButtons) {
      // A hidden line stays hidden for the other exercises' charts while the page shows.
      button.addEventListener('click', () => {
        const visible = button.getAttribute('aria-pressed') === 'false'
        button.setAttribute('aria-pressed', String(visible))
        this.chartInstance?.setDatasetVisibility(Number(button.dataset.dataset), visible)
        this.chartInstance?.update()
      })
    }

    this.closeBtn.addEventListener('click', () => {
      this.closeDialog()
    })

    // A chart listens to the window for resizes, so it goes with the dialog or the page.
    const destroyChart = () => {
      this.chartInstance?.destroy()
      this.chartInstance = null
    }
    this.dialog.addEventListener('close', destroyChart)
    signal.addEventListener('abort', destroyChart)
  }

  async openDialog(exercise: ExerciseHistoryTarget) {
    if (!historyChartEnabled(exercise.kind)) return

    setTextContent('.exercise-history-title span', exercise.name, this.dialog)
    this.dialog.showModal()

    await this.renderChart(exercise)
  }

  closeDialog() {
    this.dialog.close()
  }

  private async renderChart(exercise: ExerciseHistoryTarget) {
    const sessions = await workoutSessionsStore.getAll()

    // The sessions that logged a set of this exercise, oldest first.
    const relevantSessions = sessions
      .flatMap((session) => {
        const exerciseExec = session.exercises.find((e) => e.exerciseId === exercise.id)
        return exerciseExec && exerciseExec.sets.length > 0 ? [{ session, exerciseExec }] : []
      })
      .sort((a, b) => a.session.date.localeCompare(b.session.date))

    const labels: string[] = []
    const avgWeightData: number[] = []
    const est1rmData: number[] = []
    const totalVolumeData: number[] = []
    const locationsData: string[] = []

    for (const { session, exerciseExec } of relevantSessions) {
      let totalWeight = 0
      let total1rm = 0
      let totalVolume = 0
      let validSetsCount = 0

      for (const set of exerciseExec.sets) {
        if (isRepsSet(set) && set.reps > 0) {
          const weight = set.weight ?? 0
          totalWeight += weight
          total1rm += weight * (1 + set.reps / 30)
          totalVolume += weight * set.reps
          validSetsCount++
        }
      }

      if (validSetsCount > 0) {
        labels.push(parseSimpleDate(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
        avgWeightData.push(totalWeight / validSetsCount)
        est1rmData.push(total1rm / validSetsCount)
        totalVolumeData.push(totalVolume)
        locationsData.push(session.location.trim())
      }
    }

    const gymBands = bandsByGym(locationsData)
    this.renderGymKey(gymBands)

    const Chart = await loadChartJs()
    if (!this.dialog.open) return

    if (this.chartInstance) {
      this.chartInstance.destroy()
    }

    // The app is dark only, so the chart's text and grid are light on the dialog's dark background.
    const textColor = '#e5e5e5'
    const gridColor = '#404040'

    this.chartInstance = new Chart(this.canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          this.line('Average Weight', avgWeightData, '#3b82f6', 0, 'y'), // jim-accent roughly
          this.line('Estimated 1RM (Avg)', est1rmData, '#10b981', 1, 'y'), // emerald-500
          this.line('Total Volume', totalVolumeData, '#8b5cf6', 2, 'y1') // violet-500
        ]
      },
      options: {
        // Chart.js animates in script, where src/style.css cannot stop it.
        ...(matchMedia('(prefers-reduced-motion: reduce)').matches ? { animation: false } : {}),
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          // The header lists the metrics, in the same row as the title.
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y !== null ? context.parsed.y.toFixed(1) : ''
                return `${context.dataset.label}: ${value}`
              },
              afterLabel: (context) => {
                const location = locationsData[context.dataIndex]
                return location ? `Location: ${location}` : ''
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: textColor,
              // Level labels, thinned out to fit, take one line of the short side instead of three.
              maxRotation: 0,
              autoSkipPadding: 12
            },
            grid: {
              color: gridColor,
              display: false
            }
          },
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'Weight',
              color: textColor
            },
            ticks: {
              color: textColor
            },
            grid: {
              color: gridColor
            },
            beginAtZero: false
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            title: {
              display: true,
              text: 'Volume',
              color: textColor
            },
            ticks: {
              color: textColor
            },
            grid: {
              drawOnChartArea: false // only want the grid lines for one axis to show up
            },
            beginAtZero: true
          }
        }
      },
      plugins: [gymBandsPlugin(gymBands)]
    })
  }

  // One metric's line, which its button in the header hides and shows.
  private line(
    label: string,
    data: number[],
    color: string,
    metric: number,
    yAxisID: 'y' | 'y1'
  ): ChartDataset<'line'> {
    return {
      label,
      data,
      borderColor: color,
      backgroundColor: color + '33', // 20% opacity
      borderWidth: 2,
      pointBackgroundColor: color,
      pointBorderWidth: 0,
      pointRadius: 2.5,
      pointHoverRadius: 5,
      fill: false,
      tension: 0.3,
      hidden: this.isMetricHidden(metric),
      yAxisID
    }
  }

  private isMetricHidden(index: number) {
    return this.metricButtons[index]?.getAttribute('aria-pressed') === 'false'
  }

  private renderGymKey({ usual, away }: GymBands) {
    this.gymKey.hidden = away.length === 0
    const items = away.map(({ name, color }) => {
      const swatch = document.createElement('span')
      swatch.className = 'inline-block size-3 rounded-sm border'
      swatch.style.backgroundColor = color + BAND_ALPHA
      swatch.style.borderColor = color
      const item = document.createElement('li')
      item.className = 'flex items-center gap-1.5'
      item.append(swatch, name)
      return item
    })
    if (usual) {
      const item = document.createElement('li')
      item.textContent = `Unshaded: ${usual}`
      items.unshift(item)
    }
    this.gymKey.replaceChildren(...items)
  }
}

// Gyms other than the usual one get a band of colour behind their sessions. These hues stay clear of the three
// metric lines (blue, emerald, violet).
const GYM_COLORS = ['#f59e0b', '#f43f5e', '#22d3ee', '#a3e635', '#f97316', '#e879f9'] as const
const BAND_ALPHA = '33' // 20% opacity

interface GymBands {
  // The gym with the most sessions, left unshaded.
  usual: string | undefined
  away: Array<{ name: string; color: string }>
  // Runs of consecutive sessions at one gym that is not the usual one, by index into the chart's points.
  runs: Array<{ color: string; from: number; to: number }>
}

const bandsByGym = (locations: Array<string>): GymBands => {
  const counts = new Map<string, number>()
  for (const location of locations) {
    if (location) counts.set(location, (counts.get(location) ?? 0) + 1)
  }
  const usual = [...counts].sort((left, right) => right[1] - left[1])[0]?.[0]
  const away = [...counts.keys()]
    .filter((name) => name !== usual)
    .map((name, index) => ({ name, color: GYM_COLORS[index % GYM_COLORS.length] as string }))
  const colorOf = new Map(away.map(({ name, color }) => [name, color]))

  const runs: GymBands['runs'] = []
  locations.forEach((location, index) => {
    const color = colorOf.get(location)
    const last = runs.at(-1)
    if (!color) return
    if (last && last.to === index - 1 && locations[last.from] === location) last.to = index
    else runs.push({ color, from: index, to: index })
  })
  return { usual, away, runs }
}

// Draws the bands under the lines, each reaching halfway to the neighbouring points, with a solid edge on top.
const gymBandsPlugin = ({ runs }: GymBands): Plugin<'line'> => ({
  id: 'gymBands',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart
    const x = scales.x
    const halfStep = (chart.data.labels?.length ?? 0) > 1 ? (x.getPixelForValue(1) - x.getPixelForValue(0)) / 2 : 12
    ctx.save()
    for (const { color, from, to } of runs) {
      const left = Math.max(chartArea.left, x.getPixelForValue(from) - halfStep)
      const right = Math.min(chartArea.right, x.getPixelForValue(to) + halfStep)
      ctx.fillStyle = color + BAND_ALPHA
      ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top)
      ctx.fillStyle = color
      ctx.fillRect(left, chartArea.top, right - left, 3)
    }
    ctx.restore()
  }
})

export default ExerciseHistoryChart
