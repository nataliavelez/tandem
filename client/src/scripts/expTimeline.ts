import type { TrialTimeline } from "../../types";

// Screens in order. The game itself (MPE or Overcooked), group size and round
// length are set on the server (server/studies/<study>.env); the instructions
// below are for Overcooked (GAME=overcooked).
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
        id: "overcooked-instructions",
        type: "instructions",
        allowBack: true,
        pages: [
            {
                text: `In this game, you and the other participants are cooks in a shared kitchen.

Together, your team's goal is to serve as many onion soups as possible before time runs out. Every soup served earns the team 20 points.`,
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
        id: "waiting-room",
        type: "waiting-room",
    },
    {
        id: "game-1",
        type: "game",
        round: 1,
    },
    {
        "id": "debriefing",
        "type": "display",
        "text": "That's all for now! Thanks so much to all of you for your hard work in making this game jam a success. (And especially to Renée for all her work organizing!) I'll keep building out this project, so watch this space!",
    },
    {
        // Must be last: sends participants who finished to the server's COMPLETION_URL.
        // The server's ROUNDS must equal the number of "game" screens above.
        id: "completion",
        type: "completion",
    }
];

export { expTimeline };
