import AssistantsSetting from './AssistantsSetting'

// The page draws at once and says it is loading, and the connected assistants fill in when the worker answers, so a
// slow network never holds the tap that opened it.
export const mount = () => {
  void new AssistantsSetting().render()
}
