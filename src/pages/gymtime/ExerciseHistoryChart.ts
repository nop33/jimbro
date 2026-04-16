import type { Exercise } from '../../db/stores/exercisesStore'
import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import { setTextContent } from '../../utils'
import Chart from 'chart.js/auto'

class ExerciseHistoryChart {
  private static dialog = document.getElementById('exercise-history-dialog') as HTMLDialogElement
  private static canvas = document.getElementById('exercise-history-chart') as HTMLCanvasElement
  private static closeBtn = this.dialog.querySelector('.close-dialog-btn') as HTMLButtonElement
  private static chartInstance: Chart | null = null

  static init() {
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

  static async openDialog(exercise: Exercise) {
    if (!this.dialog || !this.canvas) return

    setTextContent('.exercise-history-title span', exercise.name, this.dialog)
    this.dialog.showModal()

    await this.renderChart(exercise)
  }

  static closeDialog() {
    this.dialog.close()
  }

  private static async renderChart(exercise: Exercise) {
    const sessions = await workoutSessionsStore.getAllWorkoutSessions()

    // Filter sessions that have this exercise and have completed sets
    const relevantSessions = sessions.reduce<{ session: typeof sessions[number]; exerciseExec: typeof sessions[number]['exercises'][number] }[]>(
      (acc, session) => {
        const exerciseExec = session.exercises.find((e) => e.exerciseId === exercise.id)
        if (exerciseExec && exerciseExec.sets.length > 0) {
          acc.push({ session, exerciseExec })
        }
        return acc
      },
      []
    )

    // Sort chronologically
    relevantSessions.sort((a, b) => new Date(a.session.date).getTime() - new Date(b.session.date).getTime())

    const labels: string[] = []
    const avgWeightData: number[] = []
    const est1rmData: number[] = []
    const totalVolumeData: number[] = []

    for (const { session, exerciseExec } of relevantSessions) {
      let totalWeight = 0
      let total1rm = 0
      let totalVolume = 0
      let validSetsCount = 0

      for (const set of exerciseExec.sets) {
        if (set.reps > 0) {
          totalWeight += set.weight
          total1rm += set.weight * (1 + set.reps / 30)
          totalVolume += set.weight * set.reps
          validSetsCount++
        }
      }

      if (validSetsCount > 0) {
        labels.push(new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
        avgWeightData.push(totalWeight / validSetsCount)
        est1rmData.push(total1rm / validSetsCount)
        totalVolumeData.push(totalVolume)
      }
    }

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
            pointBorderColor: isDarkMode ? '#171717' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Estimated 1RM (Avg)',
            data: est1rmData,
            borderColor: est1rmColor,
            backgroundColor: est1rmColor + '33',
            borderWidth: 2,
            pointBackgroundColor: est1rmColor,
            pointBorderColor: isDarkMode ? '#171717' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3,
            yAxisID: 'y'
          },
          {
            label: 'Total Volume',
            data: totalVolumeData,
            borderColor: volumeColor,
            backgroundColor: volumeColor + '33',
            borderWidth: 2,
            pointBackgroundColor: volumeColor,
            pointBorderColor: isDarkMode ? '#171717' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3,
            yAxisID: 'y1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: textColor
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y !== null ? context.parsed.y.toFixed(1) : ''
                return `${context.dataset.label}: ${value}`
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: textColor,
              maxRotation: 45,
              minRotation: 45
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
      }
    })
  }
}

export default ExerciseHistoryChart
