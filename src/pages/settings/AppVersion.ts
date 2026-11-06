// The build the app runs, at the foot of Settings: its commit's short hash, linked to the commit on GitHub, and when
// that commit was made. A new build takes over soon after it deploys (src/appUpdates.ts), so this tells which one it is.
export default class AppVersion {
  private line = document.querySelector('#app-version') as HTMLParagraphElement
  private commitLink = document.querySelector('#app-version-commit') as HTMLAnchorElement
  private date = document.querySelector('#app-version-date') as HTMLSpanElement

  constructor({ commit, committedAt }: { commit: string; committedAt: string }) {
    if (!commit) return
    this.commitLink.textContent = commit.slice(0, 7)
    this.commitLink.href = `https://github.com/nop33/jimbro/commit/${commit}`
    if (committedAt) {
      const time = document.createElement('time')
      time.dateTime = committedAt
      time.textContent = new Date(committedAt).toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
      this.date.replaceChildren('· ', time)
    }
    this.line.hidden = false
  }
}
