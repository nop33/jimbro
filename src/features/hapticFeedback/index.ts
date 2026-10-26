document.addEventListener('click', (e) => {
  if ((e.target as Element).closest('button, a, summary, .light-haptic')) navigator.vibrate?.(2)
})
