document.addEventListener('click', (e) => {
  const target = e.target as HTMLElement

  if (target.closest('button') || target.closest('a') || target.closest('summary')) {
    navigator.vibrate(20)
  }
})
