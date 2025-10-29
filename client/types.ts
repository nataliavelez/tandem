// The type of a trial – you can add more as needed
export type TrialType =
  | "consent"
  | "display"
  | "instructions"
  | "quiz"
  | "waiting-room"
  | "chat"
  | "mpe"
  | "survey"; 

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
  maxParticipants: number;
}

export interface ChatTrialConfig extends BaseTrialConfig {
  type: "chat";
  roomId: string;
  duration: number; 
}

export interface MpeTrialConfig extends BaseTrialConfig {
  type: "mpe";
  round: number;
  horizon?: number; 
  tickMs?: number;  
  condition?: string;
}

export interface SurveyTrialConfig extends BaseTrialConfig {
  type: "survey";
}

export type TrialConfig =
  | ConsentTrialConfig
  | DisplayTrialConfig
  | InstructionTrialConfig
  | QuizTrialConfig
  | WaitingTrialConfig
  | ChatTrialConfig
  | MpeTrialConfig
  | SurveyTrialConfig;

export type TrialTimeline = TrialConfig[];

