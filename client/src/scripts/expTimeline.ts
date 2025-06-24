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
        maxParticipants: 2 // wait for 2 participants
    },
    {
        id: "gridworld-1",
        type: "gridworld",
        round: 1,
        condition: "default",
        duration: 10000
    },
    {
        "id": "post-test",
        "type": "survey"
    }
];

export { expTimeline };