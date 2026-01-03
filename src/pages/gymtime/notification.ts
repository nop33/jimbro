export const sendBreakFinishedNotification = () => {
  const notificationTitle = 'Break finished!'
  const notificationBody = 'Time to start your next set!'
  const notificationIcon = '/favicon.ico'

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(notificationTitle, {
        body: notificationBody,
        icon: notificationIcon
      })
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then((permission) => {
        if (permission === 'granted') {
          new Notification(notificationTitle, {
            body: notificationBody,
            icon: notificationIcon
          })
        }
      })
    }
  }
}
