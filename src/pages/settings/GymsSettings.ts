import { workoutSessionsStore } from '../../db/stores/workoutSessionsStore'
import Toasts from '../../features/toasts'

// Renames a gym on every workout, which also fixes workouts saved under a city before gyms had names.
class GymsSettings {
  private static form = document.querySelector('#rename-gym-form') as HTMLFormElement
  private static fromSelect = this.form.querySelector('#rename-gym-from') as HTMLSelectElement
  private static toInput = this.form.querySelector('#rename-gym-to') as HTMLInputElement
  private static toOptions = this.form.querySelector('#rename-gym-options') as HTMLDataListElement
  private static noGyms = document.querySelector('#no-gyms') as HTMLParagraphElement

  static async init() {
    this.form.addEventListener('submit', (event) => {
      event.preventDefault()
      void this.rename()
    })
    await this.render()
  }

  private static async render() {
    const gyms = await workoutSessionsStore.getGyms()
    this.noGyms.hidden = gyms.length > 0
    this.form.hidden = gyms.length === 0
    this.fromSelect.replaceChildren(
      ...gyms.map(
        ({ name, sessions }) => new Option(`${name} (${sessions} ${sessions === 1 ? 'workout' : 'workouts'})`, name)
      )
    )
    this.toOptions.replaceChildren(...gyms.map(({ name }) => new Option(name)))
  }

  private static async rename() {
    const from = this.fromSelect.value
    const to = this.toInput.value.trim()
    if (!from || !to || to === from) return
    if (!confirm(`Rename "${from}" to "${to}" on every workout?`)) return
    try {
      const count = await workoutSessionsStore.renameGym(from, to)
      this.toInput.value = ''
      await this.render()
      this.fromSelect.value = to
      Toasts.show({ message: `Renamed on ${count} ${count === 1 ? 'workout' : 'workouts'}.`, type: 'success' })
    } catch (error) {
      console.error('Could not rename the gym', error)
      Toasts.show({ message: 'Could not rename the gym.', type: 'error' })
    }
  }
}

export default GymsSettings
