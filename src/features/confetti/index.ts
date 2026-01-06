export const throwConfetti = (text: string) => {
  const confettiCount = 80
  const confettiColors = [
    '#f87171',
    '#60a5fa',
    '#34d399',
    '#fbbf24',
    '#a78bfa',
    '#f472b6',
    '#38bdf8',
    '#fcd34d'
  ] as const

  const confettiContainer = document.createElement('div')
  confettiContainer.style.position = 'fixed'
  confettiContainer.style.left = '0'
  confettiContainer.style.top = '0'
  confettiContainer.style.width = '100vw'
  confettiContainer.style.height = '100vh'
  confettiContainer.style.pointerEvents = 'none'
  confettiContainer.style.zIndex = '999999'

  // Pop from center with slight randomization
  const centerX = 50 + (Math.random() - 0.5) * 10 // 45-55vw
  const centerY = 50 + (Math.random() - 0.5) * 10 // 45-55vh

  for (let i = 0; i < confettiCount; i++) {
    const confetti = document.createElement('div')
    const color = confettiColors[Math.floor(Math.random() * confettiColors.length)]
    const size = Math.random() * 0.8 + 0.6 // 0.6–1.4 rem

    // Explode in random direction (360 degrees)
    const angle = (Math.PI * 2 * i) / confettiCount + Math.random() * 0.5
    const distance = 30 + Math.random() * 40 // 30-70vw
    const velocityX = Math.cos(angle) * distance
    const velocityY = Math.sin(angle) * distance

    // Random rotation and skew
    const initialRotation = Math.random() * 360
    const finalRotation = initialRotation + (Math.random() * 1080 - 540) // ±540deg extra spin
    const skew = Math.random() * 30 - 15

    confetti.style.position = 'absolute'
    confetti.style.left = `${centerX}vw`
    confetti.style.top = `${centerY}vh`
    confetti.style.width = `${size}rem`
    confetti.style.height = `${size * 0.4}rem`
    confetti.style.background = color
    confetti.style.opacity = '1'
    confetti.style.borderRadius = `${size * 0.2}rem`
    confetti.style.transformOrigin = 'center center'

    // Pop animation: scale up, explode outward, spin, then fade
    confetti.animate(
      [
        {
          transform: `translate(0, 0) scale(0) rotate(${initialRotation}deg) skewY(${skew}deg)`,
          opacity: 1
        },
        {
          transform: `translate(${velocityX}vw, ${velocityY}vh) scale(1.2) rotate(${finalRotation}deg) skewY(${skew}deg)`,
          opacity: 1,
          offset: 0.3
        },
        {
          transform: `translate(${velocityX * 1.1}vw, ${
            velocityY * 1.1
          }vh) scale(1) rotate(${finalRotation}deg) skewY(${skew}deg)`,
          opacity: 0.8,
          offset: 0.6
        },
        {
          transform: `translate(${velocityX * 1.2}vw, ${
            velocityY * 1.2
          }vh) scale(0.8) rotate(${finalRotation}deg) skewY(${skew}deg)`,
          opacity: 0
        }
      ],
      {
        duration: 500 + Math.random() * 300, // 0.5–0.8s
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Bouncy spring effect
        fill: 'forwards'
      }
    )

    confettiContainer.appendChild(confetti)
  }

  document.body.appendChild(confettiContainer)

  // Add "Exercise done!" text that zooms in after confetti
  const textElement = document.createElement('div')
  textElement.textContent = text
  textElement.style.position = 'fixed'
  textElement.style.left = '50%'
  textElement.style.top = '50%'
  textElement.style.transform = 'translate(-50%, -50%) scale(0)'
  textElement.style.fontSize = 'clamp(2rem, 8vw, 4rem)'
  textElement.style.fontWeight = '700'
  textElement.style.color = '#f2613f'
  textElement.style.opacity = '0'
  textElement.style.pointerEvents = 'none'
  textElement.style.zIndex = '1000000'
  textElement.style.textAlign = 'center'
  textElement.style.whiteSpace = 'nowrap'
  // Strong dark glow and accent color
  textElement.style.textShadow = '0 0 24px #000, 0 0 56px #191b1f, 0 2px 4px #000a'

  document.body.appendChild(textElement)

  // Start text animation after confetti (max confetti duration is ~800ms)
  setTimeout(() => {
    // Zoom in animation
    textElement.animate(
      [
        {
          transform: 'translate(-50%, -50%) scale(0)',
          opacity: 0
        },
        {
          transform: 'translate(-50%, -50%) scale(1.1)',
          opacity: 1,
          offset: 0.6
        },
        {
          transform: 'translate(-50%, -50%) scale(1)',
          opacity: 1
        }
      ],
      {
        duration: 400,
        easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)', // Bouncy spring effect
        fill: 'forwards'
      }
    )
  }, 0)

  setTimeout(() => {
    confettiContainer.remove()
    textElement.remove()
  }, 2500)
}
