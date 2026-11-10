// The type of a trial – you can add more as needed
export type TrialType =
  | "consent"
  | "display"
  | "instructions"
  | "quiz"
  | "waiting-room"
  | "chat"
  | "game"
  | "survey"
  | "practice"
  | "completion"; 

interface BaseTrialConfig {
  id: string; 
  type: TrialType;
  duration?: number; 
  data?: Record<string, string | number | boolean>;
}

export interface DisplayTrialConfig extends BaseTrialConfig {
  type: "display";
  text: string;
  image?: string;
  continueDelay?: number;
  _delayElapsed?: number;
}

export interface ConsentTrialConfig extends BaseTrialConfig {
  type: "consent";
}

export interface InstructionTrialConfig extends BaseTrialConfig {
  type: "instructions";
  allowBack?: boolean;
  pages: { text: string; image?: string }[];
}

export interface QuizTrialConfig extends BaseTrialConfig {
  type: "quiz";
  questions: {
    question: string;
    options: string[];
    correctAnswer: string;
    feedback?: string;
  }[];
}

export interface WaitingTrialConfig extends BaseTrialConfig {
  type: "waiting-room";
  /** Fallback only: the group size comes from the server (REQUIRED_PLAYERS) */
  maxParticipants?: number;
}

export interface ChatTrialConfig extends BaseTrialConfig {
  type: "chat";
  roomId: string;
  duration: number; 
}

/** One round of the multiplayer game. Which game (MPE / Overcooked) is the server's GAME setting. */
export interface GameTrialConfig extends BaseTrialConfig {
  type: "game";
  round: number;
  horizon?: number; 
  tickMs?: number;  
  condition?: string;
}

/**
 * An option of a choice/multi question: a plain label, or a label with
 * hint (shown on hover/focus, e.g. examples) and/or describe (adds a text box;
 * its text is logged as <question id>_self_describe while the option is picked).
 * exclusive (multi only): picking it clears the others, e.g. "Prefer not to say".
 */
export type SurveyOption = string | { label: string; hint?: string; describe?: boolean; exclusive?: boolean };

/** One survey question. Answers are logged by id (survey_response). */
export type SurveyQuestion =
  /** Rating from min to max (e.g. 1–5), with labels for the ends */
  | { id: string; type: "scale"; text: string; min: number; max: number; minLabel?: string; maxLabel?: string; required?: boolean }
  /** Pick one option (logged as the option's label) */
  | { id: string; type: "choice"; text: string; options: SurveyOption[]; required?: boolean }
  /** Pick any number of options (logged as an array of labels) */
  | { id: string; type: "multi"; text: string; options: SurveyOption[]; required?: boolean }
  /** Drop-down. "countries" = every country/region, logged as its ISO 3166 code (e.g. "US") */
  | { id: string; type: "dropdown"; text: string; options: "countries" | string[]; placeholder?: string; required?: boolean }
  /** Whole number between min and max (logged as a number); anything else blocks Continue */
  | { id: string; type: "number"; text: string; min?: number; max?: number; invalidMessage?: string; required?: boolean }
  /** 1..labels.length icons (e.g. stars); the hovered or picked rating's label is shown beside them. Logged as a number */
  | { id: string; type: "rating"; text: string; icon?: string; labels: string[]; required?: boolean }
  /** Free text; multiline for a text box. maxLength defaults to 2000 characters */
  | { id: string; type: "text"; text: string; note?: string; multiline?: boolean; maxLength?: number; required?: boolean };

export interface SurveyTrialConfig extends BaseTrialConfig {
  type: "survey";
  title?: string;
  intro?: string;
  /** Small line above the title, e.g. "Page 1 of 2" */
  progress?: string;
  questions: SurveyQuestion[];
}

/**
 * Solo practice before the lobby: attempts in the server's practice kitchen
 * until one serves the required soups (server settings PRACTICE_*).
 */
export interface PracticeTrialConfig extends BaseTrialConfig {
  type: "practice";
  title?: string;
  /** Shown before the first attempt */
  intro?: string;
}

/** Last screen for participants who finished: thanks + redirect to the completion URL (from the server). */
export interface CompletionTrialConfig extends BaseTrialConfig {
  type: "completion";
  text?: string;
}

export type TrialConfig =
  | ConsentTrialConfig
  | DisplayTrialConfig
  | InstructionTrialConfig
  | QuizTrialConfig
  | WaitingTrialConfig
  | ChatTrialConfig
  | GameTrialConfig
  | SurveyTrialConfig
  | PracticeTrialConfig
  | CompletionTrialConfig;

export type TrialTimeline = TrialConfig[];

