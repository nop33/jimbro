import { getSimpleDate } from '../../dateUtils'
import { pullDownToClose } from '../../features/bottomSheet'
import { getWatchReminder, storeWatchReminder } from '../../settings'

// Asks the lifter to start the workout on their watch before the first change starts it here, so the watch tracks the
// whole workout. "Don't remind me again" turns the reminder off, and Settings turns it back on. A workout for another
// day has nothing for a watch to track, so it starts without asking.
class WatchReminderSheet {
  private dialog = document.querySelector('#watch-reminder-dialog') as HTMLDialogElement
  private form = this.dialog.querySelector('form') as HTMLFormElement
  private dontRemind = this.dialog.querySelector('input[name="dont-remind"]') as HTMLInputElement
  private closeBtn = this.dialog.querySelector('.close-dialog-btn') as HTMLButtonElement

  constructor() {
    pullDownToClose(this.dialog)
    this.closeBtn.addEventListener('click', () => this.dialog.close())
  }

  // Resolves to whether the workout should start: at once when the reminder is off or the day is not today, otherwise
  // once the lifter taps Start workout, or false when they close the sheet.
  confirmStart(date: string): Promise<boolean> {
    if (!getWatchReminder() || date !== getSimpleDate(new Date())) return Promise.resolve(true)

    this.form.reset()
    this.dialog.returnValue = ''
    this.dialog.showModal()
    return new Promise((resolve) => {
      this.dialog.addEventListener(
        'close',
        () => {
          const start = this.dialog.returnValue === 'start'
          if (start && this.dontRemind.checked) storeWatchReminder(false)
          resolve(start)
        },
        { once: true }
      )
    })
  }
}

export default WatchReminderSheet
