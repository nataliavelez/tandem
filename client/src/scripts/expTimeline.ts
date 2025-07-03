import type { TrialTimeline } from "../../types";

const expTimeline : TrialTimeline = [
    {
        "id": "intro-consent",
        "type": "consent"
    },
    // {
    //     "id": "gpdr-notice",
    //     "type": "display",
    //     "text": "This is the lab's GDPR notice. Please read carefully.",
    //     "continueDelay": 5000 // 5 seconds before allowing to continue
    // },
    {
        id: "waiting-room",
        type: "waiting-room",
        maxParticipants: 2
    },
    {
        id: "gridworld-1",
        type: "gridworld",
        round: 1,
        condition: "default",
        duration: 10000
    },
    {
        "id": "debriefing",
        "type": "display",
        "text": "That's all for now! Thanks so much to all of you for your hard work in making this game jam a success. (And especially to Renée for all her work organizing!) I'll keep building out this project, so watch this space!",
    }
];

export { expTimeline };