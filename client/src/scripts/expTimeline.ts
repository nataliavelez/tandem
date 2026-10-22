import type { TrialTimeline } from "../../types";

// Screens in order
const expTimeline : TrialTimeline = [
    {
        "id": "intro-consent",
        "type": "consent"
    },
    {
        id: "overcooked-instructions",
        type: "instructions",
        allowBack: true,
        pages: [
            {
                text: `In this game, you and the other participants are cooks in a shared kitchen.

Together, your team's goal is to serve as many onion soups as possible before time runs out. Every soup served earns the team 20 points.

First, you'll practice on your own in a small kitchen. Once you've served a soup there, we'll match you with your team.`,
            },
            {
                text: `How to make an onion soup:

1. Pick up an onion from an onion crate (yellow onions).
2. Put it in a pot (dark circle). A pot needs 3 onions; it starts cooking by itself once it has 3.
3. While the soup cooks (an orange ring fills up), get a plate from the plate stack (white).
4. When the soup is ready (green ring), use your plate on the pot to scoop up the soup.
5. Carry the soup to a SERVE counter (green) and use it to serve.

You can put things down on any empty counter, and pick them up again later. A key to all the symbols is shown next to the kitchen during the game.`,
            },
            {
                text: `Controls:

Arrow keys or W A S D: each press moves you one square. Holding a key does not keep you moving: press again for each step.
Space or E: pick up, put down, or use whatever you are facing.

Your cook has a black pointer showing which way it faces. To face a counter, step toward it: you will turn to face it without moving.

Your own cook is marked YOU. The others are your teammates, numbered 1 and up. Cooks can't walk through each other.`,
            },
        ],
    },
    {
        // Solo practice in a small kitchen; must serve a soup before the lobby.
        id: "practice",
        type: "practice",
    },
    {
        id: "waiting-room",
        type: "waiting-room",
    },
    {
        id: "game-1",
        type: "game",
        round: 1,
    },
    {
        // INSERT LAB END SURVEY HERE.
        id: "end-survey",
        type: "survey",
        title: "A few questions about the game",
        intro: "Your answers help us improve the study. There are no right or wrong answers.",
        questions: [
            { id: "instructions_clarity", type: "scale", text: "How clear were the instructions?", min: 1, max: 5, minLabel: "Very unclear", maxLabel: "Very clear", required: true },
            { id: "controls_ease", type: "scale", text: "How easy were the controls to use?", min: 1, max: 5, minLabel: "Very hard", maxLabel: "Very easy", required: true },
            { id: "team_coordination", type: "scale", text: "How well did your team work together?", min: 1, max: 5, minLabel: "Not at all well", maxLabel: "Extremely well", required: true },
            { id: "enjoyment", type: "scale", text: "How much did you enjoy the game?", min: 1, max: 5, minLabel: "Not at all", maxLabel: "Very much", required: true },
            { id: "played_before", type: "choice", text: "Had you played Overcooked, or a similar cooking game, before?", options: ["Yes", "No", "Not sure"], required: true },
            { id: "problems", type: "text", multiline: true, text: "Did anything not work, or was anything confusing?" },
            { id: "comments", type: "text", multiline: true, text: "Any other comments?" },
        ],
    },
    {
        "id": "debriefing",
        "type": "display",
        "text": "That's all for now! Thanks so much to all of you for your hard work in making this game jam a success. (And especially to Renée for all her work organizing!) I'll keep building out this project, so watch this space!",
    },
    {
        id: "completion",
        type: "completion",
    }
];

export { expTimeline };
