// The type of a trial – you can add more as needed
export type TrialType = "consent" | "display" | "instructions" | "quiz" | "waiting-room" | "chat" | "gridworld" | "quiz" | "survey";

// Common configuration fields shared by all trials
interface BaseTrialConfig {
    id: string; // unique identifier for the trial
    type: TrialType;
    duration?: number; // optional max time in ms
    data?: Record<string, string | number | boolean>; // any metadata to log
}

export interface DisplayTrialConfig extends BaseTrialConfig {
    type: "display";
    text: string; // text to display in the trial
    image?: string; // optional image URL to display
    continueDelay?: number; // optional delay before allowing to continue
    _delayElapsed?: number; // timestamp when continue button can be clicked
}

export interface ConsentTrialConfig extends BaseTrialConfig {
    type: "consent";
}

// Specialized config for instruction screens
export interface InstructionTrialConfig extends BaseTrialConfig {
  type: "instructions";
  allowBack?: boolean;
  pages: {
    text: string;
    image?: string;
}[];
}

// Specialized config for a multiple-choice question, used for comprehension checks
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
  maxParticipants: number; // max number of participants to wait for
}

export interface ChatTrialConfig extends BaseTrialConfig {
    type: "chat";
    roomId: string;
    duration: number;
}

// Specialized config for an interactive grid trial
export interface GridworldTrialConfig extends BaseTrialConfig {
  type: "gridworld";
  round: number; // round number for this trial
  condition: string;
  duration: number; // max time in ms for this round
}

// Post-test survey
export interface SurveyTrialConfig extends BaseTrialConfig {
    type: "survey";
}

// Union of all trial configurations
export type TrialConfig = 
    | ConsentTrialConfig    
    | DisplayTrialConfig
    | InstructionTrialConfig 
    | QuizTrialConfig
    | WaitingTrialConfig
    | ChatTrialConfig   
    | GridworldTrialConfig 
    | SurveyTrialConfig;

// A timeline is just an array of trials
export type TrialTimeline = TrialConfig[];
