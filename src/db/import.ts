import type { ExportData } from "./export";
import { exercisesStore } from "./stores/exercisesStore";
import { programsStore } from "./stores/programsStore";

export const importIndexedDbFromJson = async (file: File) => {
  const text = await file.text();
  const data: ExportData = JSON.parse(text);
  const { version, stores } = data;

  if (version !== 1) {
    throw new Error('Unsupported version');
  }

  try {
    await importExercises(stores.exercises);
    await importPrograms(stores.programs);

    console.log('✅ Imported data successfully');
  } catch (error) {
    console.error('❌ Failed to import data', error);
    throw error;
  }
}

const importExercises = async (exercises: ExportData['stores']['exercises']) => {
  const existingExercises = await exercisesStore.getAllExercises();

  for (const exercise of exercises) {
    if (!existingExercises.some((e) => e.id === exercise.id)) {
      await exercisesStore.importExercise(exercise);
    }
  }
}

const importPrograms = async (programs: ExportData['stores']['programs']) => {
  const existingPrograms = await programsStore.getAllPrograms();

  for (const program of programs) {
    if (!existingPrograms.some((p) => p.id === program.id)) {
      await programsStore.importProgram(program);
    }
  }
}
