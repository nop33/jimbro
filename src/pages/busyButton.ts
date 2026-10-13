// While a tap's work runs, the tapped button says what is happening and shows a spinner, and it and the buttons beside
// it take no more taps. aria-busy tells a screen reader the button is working. A passkey sign-in downloads the whole
// backup, which takes seconds on a phone, so without this the tap looks ignored.
export const whileBusy = async <T>(
  button: HTMLButtonElement,
  label: string,
  work: () => Promise<T>,
  beside: readonly HTMLButtonElement[] = []
) => {
  const text = button.textContent
  const buttons = [button, ...beside]
  button.textContent = label
  button.classList.add('btn-busy')
  button.setAttribute('aria-busy', 'true')
  for (const each of buttons) each.disabled = true
  try {
    return await work()
  } finally {
    button.textContent = text
    button.classList.remove('btn-busy')
    button.removeAttribute('aria-busy')
    for (const each of buttons) each.disabled = false
  }
}
