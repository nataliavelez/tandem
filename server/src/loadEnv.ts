{/*
Loads the per-study settings file into process.env. Must be the FIRST import
in index.ts, because other modules read process.env when they load.

  STUDY_CONFIG=studies/mpe-pilot.env npm run dev   → that file (relative to server/)
  npm run dev                                      → server/.env, if it exists

Variables already set in the shell take precedence over the file, so one-off
overrides (e.g. PORT=8090 for tests) still work. See studies/example.env for
every setting.

Created by: Elizabeth Mieczkowski, Updated: 10/2026
*/}
import fs from "fs";
import path from "path";

const SERVER_DIR = path.resolve(__dirname, "..");
const requested = process.env.STUDY_CONFIG;
const file = requested ? path.resolve(SERVER_DIR, requested) : path.join(SERVER_DIR, ".env");

if (fs.existsSync(file)) {
  process.loadEnvFile(file);
  console.log(`[config] loaded study settings from ${file}`);
} else if (requested) {
  // Running a study with the wrong (or no) settings is worse than not starting
  console.error(`[config] STUDY_CONFIG file not found: ${file}`);
  process.exit(1);
}
