// Home's Christmas greeting: "Ho ho ho, gymbro.", with a Santa hat on the H. The hidden egg: a tap knocks the hat off,
// and it tumbles away in a puff of snow. It's back on the next visit. Under reduced motion it just goes.
export class SantaHat {
  private hat = document.getElementById('santa-hat') as HTMLButtonElement

  constructor() {
    ;(document.getElementById('greeting') as HTMLSpanElement).textContent = 'Ho ho ho'
    this.hat.hidden = false
    this.hat.addEventListener('click', () => this.knockOff(), { once: true })
  }

  private knockOff() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.hat.hidden = true
      return
    }
    const box = this.hat.getBoundingClientRect()
    const puff = document.createElement('div')
    puff.className = 'santa-hat-puff'
    puff.setAttribute('aria-hidden', 'true')
    puff.style.left = `${box.left + box.width / 2}px`
    puff.style.top = `${box.top + box.height / 2}px`
    const flakes = Array.from({ length: 14 }, (_, i) => {
      const flake = document.createElement('i')
      const angle = (Math.PI * 2 * i) / 14 + Math.random() * 0.4
      const distance = 28 + Math.random() * 36
      flake.animate(
        [
          { transform: 'translate(0, 0) scale(1)', opacity: 1 },
          {
            transform: `translate(${Math.cos(angle) * distance}px, ${Math.sin(angle) * distance + 14}px) scale(0.4)`,
            opacity: 0
          }
        ],
        { duration: 700 + Math.random() * 300, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' }
      )
      return flake
    })
    puff.append(...flakes)
    document.body.append(puff)
    const fall = this.hat.animate(
      [
        { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
        { transform: 'translate(-6px, -22px) rotate(-40deg)', opacity: 1, offset: 0.25 },
        { transform: 'translate(-30px, 120px) rotate(-220deg)', opacity: 0 }
      ],
      { duration: 900, easing: 'cubic-bezier(0.5, 0, 0.75, 0)', fill: 'forwards' }
    )
    void fall.finished.then(() => {
      this.hat.hidden = true
      puff.remove()
    })
  }
}
