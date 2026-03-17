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

  const soundFiles = [
    '/sounds/cartoon_boing.ogg',
    '/sounds/success.ogg',
    '/sounds/magic_chime.ogg',
    '/sounds/metal_twang.ogg'
  ]
  const randomSoundFile = soundFiles[Math.floor(Math.random() * soundFiles.length)]
  const audio = new Audio(randomSoundFile)
  audio.play().catch((e) => console.warn('Audio playback failed:', e))

  const id = `confetti-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`

  const confettiContainer = document.createElement('div')
  confettiContainer.id = id
  confettiContainer.style.position = 'fixed'
  confettiContainer.style.left = '0'
  confettiContainer.style.top = '0'
  confettiContainer.style.width = '100vw'
  confettiContainer.style.height = '100vh'
  confettiContainer.style.pointerEvents = 'none'
  confettiContainer.style.zIndex = '999999'

  const styleTag = document.createElement('style')
  let cssText = ''

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

    const duration = 500 + Math.random() * 300 // 0.5–0.8s
    const animationName = `${id}-anim-${i}`

    confetti.style.position = 'absolute'
    confetti.style.left = `${centerX}vw`
    confetti.style.top = `${centerY}vh`
    confetti.style.width = `${size}rem`
    confetti.style.height = `${size * 0.4}rem`
    confetti.style.background = color
    confetti.style.opacity = '0' // Initial state hidden before animation takes over, or keyframe handles it
    confetti.style.borderRadius = `${size * 0.2}rem`
    confetti.style.transformOrigin = 'center center'

    // We use CSS animations as they are far more reliable on iOS Safari than Web Animations API
    // for immediately injected dynamic elements.
    cssText += `
      @keyframes ${animationName} {
        0% {
          transform: translate(0, 0) scale(0) rotate(${initialRotation}deg) skewY(${skew}deg);
          opacity: 1;
        }
        30% {
          transform: translate(${velocityX}vw, ${velocityY}vh) scale(1.2) rotate(${finalRotation}deg) skewY(${skew}deg);
          opacity: 1;
        }
        60% {
          transform: translate(${velocityX * 1.1}vw, ${velocityY * 1.1}vh) scale(1) rotate(${finalRotation}deg) skewY(${skew}deg);
          opacity: 0.8;
        }
        100% {
          transform: translate(${velocityX * 1.2}vw, ${velocityY * 1.2}vh) scale(0.8) rotate(${finalRotation}deg) skewY(${skew}deg);
          opacity: 0;
        }
      }
      #${id} .confetti-piece-${i} {
        animation: ${animationName} ${duration}ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
      }
    `
    confetti.className = `confetti-piece-${i}`
    confettiContainer.appendChild(confetti)
  }

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
  textElement.style.textShadow = '0 0 24px #000, 0 0 56px #191b1f, 0 2px 4px #000a'
  textElement.className = 'confetti-text'

  const textAnimationName = `${id}-text-anim`
  cssText += `
    @keyframes ${textAnimationName} {
      0% {
        transform: translate(-50%, -50%) scale(0);
        opacity: 0;
      }
      60% {
        transform: translate(-50%, -50%) scale(1.1);
        opacity: 1;
      }
      100% {
        transform: translate(-50%, -50%) scale(1);
        opacity: 1;
      }
    }
    #${id} .confetti-text {
      animation: ${textAnimationName} 400ms cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
    }
  `

  styleTag.textContent = cssText
  confettiContainer.appendChild(styleTag)
  confettiContainer.appendChild(textElement)

  document.body.appendChild(confettiContainer)

  setTimeout(() => {
    confettiContainer.remove()
  }, 2500)
}
