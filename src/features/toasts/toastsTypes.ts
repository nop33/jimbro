type ToastMessageType = 'success' | 'error' | 'warning' | 'info'
type ToastMessageDuration = 'short' | 'long'

export type ToastMessageSimple = {
  message: string
  type?: ToastMessageType
  duration?: ToastMessageDuration
}

export type ToastMessage = Required<ToastMessageSimple>
