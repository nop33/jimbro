import { historyChartEnabled, isRepsSet, type ExerciseKind } from '../../db/exerciseLogging'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { parseSimpleDate } from '../../dateUtils'
import { setTextContent } from '../../utils'
import type { Chart as ChartInstance, Plugin } from 'chart.js'

export interface ExerciseHistoryTarget {
  id: string
  name: string
  kind: ExerciseKind
}

class ExerciseHistoryChart {
  private static dialog = document.getElementById('exercise-history-dialog') as HTMLDialogElement
  private static canvas = document.getElementById('exercise-history-chart') as HTMLCanvasElement
  private static closeBtn = this.dialog.querySelector('.close-dialog-btn') as HTMLButtonElement
  private static gymKey = this.dialog.querySelector('#exercise-history-gyms') as HTMLUListElement
  private static metricButtons = [...this.dialog.querySelectorAll<HTMLButtonElement>('.history-metric')]
  private static chartInstance: ChartInstance | null = null

  static init() {
    for (const button of this.metricButtons) {
      // A hidden line stays hidden for the other exercises' charts until the page reloads.
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

    this.dialog.addEventListener('close', () => {
      if (this.chartInstance) {
        this.chartInstance.destroy()
        this.chartInstance = null
      }
    })
  }

  static async openDialog(exercise: ExerciseHistoryTarget) {
    if (!this.dialog || !this.canvas) return
    if (!historyChartEnabled(exercise.kind)) return

    setTextContent('.exercise-history-title span', exercise.name, this.dialog)
    this.dialog.showModal()

    await this.renderChart(exercise)
  }

  static closeDialog() {
    this.dialog.close()
  }

  private static async renderChart(exercise: ExerciseHistoryTarget) {
    const sessions = await workoutSessionsStore.getAll()

    // Filter sessions that have this exercise and have completed sets
    const relevantSessions = sessions.reduce<
      { session: (typeof sessions)[number]; exerciseExec: (typeof sessions)[number]['exercises'][number] }[]
    >((acc, session) => {
      const exerciseExec = session.exercises.find((e) => e.exerciseId === exercise.id)
      if (exerciseExec && exerciseExec.sets.length > 0) {
        acc.push({ session, exerciseExec })
      }
      return acc
    }, [])

    // Sort chronologically
    relevantSessions.sort(
      (a, b) => parseSimpleDate(a.session.date).getTime() - parseSimpleDate(b.session.date).getTime()
    )

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

    // Chart.js is most of gymtime's code and only this dialog draws with it, so it loads when the dialog first opens.
    // The service worker caches its chunk with the rest of the build, so it loads offline too.
    const { default: Chart } = await import('chart.js/auto')
    if (!this.dialog.open) return

    if (this.chartInstance) {
      this.chartInstance.destroy()
    }

    // Chart.js configuration
    const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

    const textColor = isDarkMode ? '#e5e5e5' : '#262626'
    const gridColor = isDarkMode ? '#404040' : '#d4d4d4'
    const accentColor = '#3b82f6' // jim-accent roughly
    const est1rmColor = '#10b981' // emerald-500
    const volumeColor = '#8b5cf6' // violet-500

    this.chartInstance = new Chart(this.canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Weight',
            data: avgWeightData,
            borderColor: accentColor,
            backgroundColor: accentColor + '33', // 20% opacity
            borderWidth: 2,
            pointBackgroundColor: accentColor,
            pointBorderWidth: 0,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.3,
            hidden: this.isMetricHidden(0),
            yAxisID: 'y'
          },
          {
            label: 'Estimated 1RM (Avg)',
            data: est1rmData,
            borderColor: est1rmColor,
            backgroundColor: est1rmColor + '33',
            borderWidth: 2,
            pointBackgroundColor: est1rmColor,
            pointBorderWidth: 0,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.3,
            hidden: this.isMetricHidden(1),
            yAxisID: 'y'
          },
          {
            label: 'Total Volume',
            data: totalVolumeData,
            borderColor: volumeColor,
            backgroundColor: volumeColor + '33',
            borderWidth: 2,
            pointBackgroundColor: volumeColor,
            pointBorderWidth: 0,
            pointRadius: 2.5,
            pointHoverRadius: 5,
            fill: false,
            tension: 0.3,
            hidden: this.isMetricHidden(2),
            yAxisID: 'y1'
          }
        ]
      },
      options: {
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

  private static isMetricHidden(index: number) {
    return this.metricButtons[index]?.getAttribute('aria-pressed') === 'false'
  }

  private static renderGymKey({ usual, away }: GymBands) {
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
