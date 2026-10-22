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

/** One survey question. Answers are logged by id (survey_response). */
export type SurveyQuestion =
  /** Rating from min to max (e.g. 1–5), with labels for the ends */
  | { id: string; type: "scale"; text: string; min: number; max: number; minLabel?: string; maxLabel?: string; required?: boolean }
  /** Pick one option */
  | { id: string; type: "choice"; text: string; options: string[]; required?: boolean }
  /** Free text; multiline for a text box. maxLength defaults to 2000 characters */
  | { id: string; type: "text"; text: string; multiline?: boolean; maxLength?: number; required?: boolean };

export interface SurveyTrialConfig extends BaseTrialConfig {
  type: "survey";
  title?: string;
  intro?: string;
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

