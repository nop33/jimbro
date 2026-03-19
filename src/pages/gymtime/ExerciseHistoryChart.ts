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
    const relevantSessions = sessions.filter((session) => {
      const exerciseExec = session.exercises.find((e) => e.exerciseId === exercise.id)
      return exerciseExec && exerciseExec.sets.length > 0
    })

    // Sort chronologically
    relevantSessions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

    const labels: string[] = []
    const dataPoints: number[] = []

    for (const session of relevantSessions) {
      const exerciseExec = session.exercises.find((e) => e.exerciseId === exercise.id)!

      let totalWeight = 0
      let validSetsCount = 0

      for (const set of exerciseExec.sets) {
        if (set.reps > 0) {
          totalWeight += set.weight
          validSetsCount++
        }
      }

      if (validSetsCount > 0) {
        labels.push(new Date(session.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }))
        dataPoints.push(totalWeight / validSetsCount)
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

    this.chartInstance = new Chart(this.canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Weight',
            data: dataPoints,
            borderColor: accentColor,
            backgroundColor: accentColor + '33', // 20% opacity
            borderWidth: 2,
            pointBackgroundColor: accentColor,
            pointBorderColor: isDarkMode ? '#171717' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            fill: true,
            tension: 0.3
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const value = context.parsed.y !== null ? context.parsed.y.toFixed(1) : ''
                return `${value} kg`
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
            ticks: {
              color: textColor
            },
            grid: {
              color: gridColor
            },
            beginAtZero: false
          }
        }
      }
    })
  }
}

export default ExerciseHistoryChart
