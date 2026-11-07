import AssistantsSetting from './AssistantsSetting'

export const mount = async () => {
  await new AssistantsSetting().render()
}
