import { exercisesStore } from '../../../db/stores/exercisesStore'
import { programsStore } from '../../../db/stores/programsStore'
import ProgramPage from './ProgramPage'

// /programs/program/?id=<program>. With &add, as a new program opens, the page opens on the exercise picker.
export const mount = async (signal: AbortSignal) => {
  await Promise.all([programsStore.load(), exercisesStore.load()])
  const params = new URLSearchParams(location.search)
  const page = new ProgramPage(params.get('id') ?? '', signal)
  if (params.has('add')) {
    params.delete('add')
    history.replaceState(history.state, '', `?${params}`)
    page.openSheet()
  }
}
