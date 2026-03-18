/**
 * Shared Zod schemas used by both server (validation at startup) and client
 * (validation of /api/contenders response).
 */
import { z } from "zod";

export const contenderFilmSchema = z.object({
  title:     z.string().min(1, "title is required"),
  studio:    z.string().min(1, "studio is required"),
  precursor: z.number().int("precursor must be an integer").min(0, "precursor must be ≥ 0").max(100, "precursor must be ≤ 100"),
  history:   z.number().int("history must be an integer").min(0, "history must be ≥ 0").max(100, "history must be ≤ 100"),
  buzz:      z.number().int("buzz must be an integer").min(0, "buzz must be ≥ 0").max(100, "buzz must be ≤ 100"),
  strength:  z.enum(["High", "Medium", "Low"], { error: 'strength must be "High", "Medium", or "Low"' }),
});

export const contendersFileSchema = z.object({
  ceremony: z.number().int().positive(),
  year:     z.number().int().positive(),
  categoryDefinitions: z.array(z.object({
    id:         z.string().min(1),
    name:       z.string().min(1),
    nominees:   z.number().int().positive(),
    winnerBase: z.number().min(0).max(1),
  })).min(1),
  categorySeeds: z.record(z.string(), z.array(contenderFilmSchema)),
});

/** Inferred Film type as validated by the schema (matches `Film` in types.ts). */
export type ValidatedFilm = z.infer<typeof contenderFilmSchema>;
