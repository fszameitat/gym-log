// seed-history.js — the exercise library a fresh install starts with.
//
// This file deliberately contains NO training data. Earlier versions had a person's logged
// sessions hard-coded here, which meant publishing the app also published their workout
// history. Personal data now travels only in a backup file the owner keeps themselves and
// loads through Progress → Backup → Restore backup.

export const SEED_EXERCISES = [
  { name: 'Pulldown',         muscleGroup: 'Back',      unit: 'kg',    defaultSets: 4 },
  { name: 'Reverse Fly',      muscleGroup: 'Shoulders', unit: 'stufe', defaultSets: 4 },
  { name: 'Planks',           muscleGroup: 'Core',      unit: 'time',  defaultSets: 4 },
  { name: 'Back Extension',   muscleGroup: 'Back',      unit: 'kg',    defaultSets: 3 },
  { name: 'Cable Fly normal', muscleGroup: 'Chest',     unit: 'stufe', defaultSets: 4 },
  { name: 'Chest Press',      muscleGroup: 'Chest',     unit: 'kg',    defaultSets: 4 },
  { name: 'Bench Press',      muscleGroup: 'Chest',     unit: 'kg',    defaultSets: 4 },
  { name: 'Back Squat',       muscleGroup: 'Legs',      unit: 'kg',    defaultSets: 4 },
  { name: 'Deadlift',         muscleGroup: 'Back',      unit: 'kg',    defaultSets: 3 },
  { name: 'Overhead Press',   muscleGroup: 'Shoulders', unit: 'kg',    defaultSets: 4 },
];
