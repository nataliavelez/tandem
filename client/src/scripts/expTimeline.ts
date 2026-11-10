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
        // End survey, page 1: background. Every question is optional.
        id: "end-survey-background",
        type: "survey",
        progress: "Page 1 of 2",
        title: "Almost done!",
        intro: "These questions help us understand how our research reaches people from different backgrounds and improve the experience for future participants. All questions are optional.",
        questions: [
            {
                // Logged as the ISO 3166 code (e.g. "US", "GB")
                id: "country", type: "dropdown", options: "countries",
                text: "Please indicate your current country/region of residence. (Optional. This information helps us understand the geographical diversity of our participants.)",
            },
            {
                id: "age", type: "number", text: "Age", min: 18, max: 120,
                invalidMessage: "Please enter your age as a number (18 or older).",
            },
            {
                id: "gender", type: "choice", text: "Gender",
                options: ["Woman", "Man", "Non-binary", { label: "Prefer to self-describe:", describe: true }, "Prefer not to say"],
            },
            {
                // Examples: the US federal standard (OMB SPD 15, 2024)
                id: "race_ethnicity", type: "multi",
                text: "What is your race and/or ethnicity? Please select all that apply. Hover over each category for examples.",
                options: [
                    { label: "American Indian or Alaska Native", hint: "For example, Navajo Nation, Blackfeet Tribe, Native Village of Barrow Inupiat Traditional Government, Nome Eskimo Community, Aztec, Maya" },
                    { label: "Asian", hint: "For example, Chinese, Asian Indian, Filipino, Vietnamese, Korean, Japanese" },
                    { label: "Black or African", hint: "For example, African American, Jamaican, Haitian, Nigerian, Ethiopian, Somali" },
                    { label: "Hispanic or Latino/a/e", hint: "For example, Mexican, Puerto Rican, Salvadoran, Cuban, Dominican, Guatemalan" },
                    { label: "Middle Eastern or North African", hint: "For example, Lebanese, Iranian, Egyptian, Syrian, Iraqi, Israeli" },
                    { label: "Native Hawaiian or Pacific Islander", hint: "For example, Native Hawaiian, Samoan, Chamorro, Tongan, Fijian, Marshallese" },
                    { label: "White", hint: "For example, English, German, Irish, Italian, Polish, Scottish" },
                    { label: "I’d prefer to self-describe or provide more detail:", describe: true },
                    { label: "Prefer not to say", exclusive: true },
                ],
            },
            {
                id: "education", type: "choice",
                text: "What is the highest degree or level of education you have completed? Hover over each category for examples.",
                options: [
                    { label: "Did not complete high school", hint: "Left school before finishing secondary (high) school" },
                    { label: "Completed high school or equivalent", hint: "For example, a high school diploma, GED, A-levels, Abitur, or baccalauréat" },
                    { label: "Vocational or technical education", hint: "For example, trade school, an apprenticeship, or a technical certificate or diploma" },
                    { label: "2-year college or equivalent", hint: "For example, an associate degree (AA, AS), a community college degree, a foundation degree, or an HND" },
                    { label: "Bachelor’s or equivalent", hint: "For example, a BA, BS/BSc, or BEng" },
                    { label: "Master’s or equivalent (e.g., MS, MA, MPhil)", hint: "For example, an MS/MSc, MA, MPhil, MBA, or MEng" },
                    { label: "Doctoral or professional degree (e.g., PhD, MD, JD)", hint: "For example, a PhD, EdD, MD, JD, or DDS" },
                    "Prefer not to say",
                ],
            },
            {
                id: "native_languages", type: "text",
                text: "What language or languages do you consider native for you? If you are a native speaker of more than one language, please separate them with commas.",
                maxLength: 300,
            },
            {
                id: "english_proficiency", type: "choice", text: "How would you rate your proficiency in English?",
                options: [
                    "Native or near-native speaker",
                    "Fluent but not native",
                    "Intermediate (can understand and communicate comfortably in most situations)",
                    "Basic",
                    "I do not speak English",
                    "Prefer not to say",
                ],
            },
        ],
    },
    {
        // End survey, page 2: the task. Ratings are logged as 1-5.
        id: "end-survey-task",
        type: "survey",
        progress: "Page 2 of 2",
        title: "Almost done!",
        questions: [
            {
                id: "video_game_proficiency", type: "choice",
                text: "How would you rate your proficiency with video games? Hover over each category for definitions.",
                options: [
                    { label: "No experience", hint: "I rarely or never play video games." },
                    { label: "Beginner / Casual player", hint: "I play now and then, for example casual or mobile games." },
                    { label: "Intermediate", hint: "I play regularly and am comfortable with most game controls." },
                    { label: "Advanced", hint: "I play often, including fast-paced or competitive games, and pick up new games quickly." },
                    "Prefer not to say",
                ],
            },
            {
                id: "fun", type: "rating", icon: "⭐", text: "How fun was the task?",
                labels: ["Not fun", "Less fun than average", "Average", "More fun than average", "Very fun!"],
            },
            {
                id: "difficulty", type: "rating", icon: "🔥", text: "How hard was the task?",
                labels: ["Very easy", "Somewhat easy", "Neither easy nor hard", "Somewhat hard", "Very hard"],
            },
            {
                id: "clarity", type: "rating", icon: "⭐", text: "How clear were the controls and instructions?",
                labels: ["Very confusing", "Somewhat confusing", "OK, but could be clearer", "Mostly clear", "Very clear"],
            },
            {
                id: "had_issues", type: "choice",
                text: "Did you experience any bugs, glitches, or connectivity issues during the task?",
                options: ["Yes", "No"],
            },
            {
                id: "comments", type: "text", multiline: true,
                text: "Do you have any additional comments or feedback about your experience playing the task?",
                note: "If anything made the task harder for you—like being confused by part of the task or distracted by something around you—feel free to let us know. Your honest feedback helps us improve the study and interpret the results. There’s no penalty for anything you share.",
            },
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
