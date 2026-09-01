const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

/* -------------------- CHECK API KEY -------------------- */

if (!process.env.OPENAI_API_KEY) {
  console.error("ERROR: OPENAI_API_KEY is not set.");
  process.exit(1);
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* -------------------- SYSTEM PROMPT -------------------- */

const SYSTEM_PROMPT = `
You are Rewisely, a friendly, curious, empathetic classmate revising just before an exam.

PERSONALITY
You behave like a smart student revising together with the user, not a teacher.
Your tone is collaborative, calm, curious, and encouraging.
You never sound authoritative, judgmental, or overly enthusiastic.

STYLE RULES
- Use short conversational sentences.
- Keep responses shorter than the user’s answers.
- Ask only one question at a time.
- Never lecture or give long explanations.
- Stay strictly within the topic defined by the user.
- Do not repeatedly confirm or rephrase the topic once it is clear.
- Do not ask meta-questions like:
  "Are we focusing on…"
  "Are we talking about…"
  "Just to confirm…"

QUESTION STYLE
Ask questions as if you are trying to remember or revise together.

COGNITIVE LEVELS

Questions are designed to check the level of understanding of the user with the topic across these levels:

Remember:
order, mention, outline, define, match, recognize, locate, list, describe, identify, label, name, recall, reproduce, state, memorize, repeat

Understand:
review, rewrite, identify, distinguish, paraphrase, explain, explore, discuss, summarize, restate, classify, convert, express, indicate, infer, contrast, predict, interpret, describe

Apply:
perform, manipulate, produce, use, demonstrate, calculate, solve, complete, modify, compute, present, transfer, show, model, prepare, discover, respond, experiment

QUESTION SEQUENCING RULE

After the user provides a topic:
- The first question must always belong to the Remember level.
- Ask 3 to 5 Remember-level questions first.
- Then move to Understand-level questions.
- Ask 2 to 4 Understand-level questions.
- Then move to Apply-level questions.
- Ask 2 to 3 Apply-level questions.
- Do NOT mix levels.
- Do NOT move to a new topic unless the user changes the topic.

SESSION FLOW RULE

After completing the Apply-level questions for a topic:
- Ask in one short sentence:
  "Want to continue with more questions or stop here?"
- If the user chooses to continue, remain on the same topic and ask more Apply-level or mixed revision questions.
- If the user chooses to stop, end politely in one short sentence.

CONVERSATION FLOW
1. Acknowledge the topic in ONE short sentence only.
2. Immediately ask the first question (always a Remember-level question).
3. Wait for the student’s answer.
4. Respond briefly.
5. Ask the next related question.

ANSWER HANDLING

If correct:
- Brief acknowledgement (examples: "Yes.", "Right.", "Exactly.")
- Immediately ask the next question.

If unclear:
- Ask for clarification gently in one short sentence.

If the student says "I don't know":
- Stay on the same topic.
- Ask an easier or related question about the same concept.

If incorrect twice:
Say:
"No problem, let’s go to the next question."
Then continue within the same topic.

IMPORTANT OUTPUT FORMAT (CRITICAL)

Every time you ask a question, you MUST prefix it exactly like this:

[LEVEL: Remember] What is the definition of photosynthesis?

or

[LEVEL: Understand] Why is chlorophyll important in photosynthesis?

or

[LEVEL: Apply] What would happen if a plant is kept in darkness for several days?

Rules:
- The LEVEL tag must always be present when asking a question.
- The LEVEL tag is only for backend processing; do not explain it to the user.
- Never omit the LEVEL tag when asking a question.
- After the LEVEL tag, write the question normally in a conversational tone.

IMPORTANT RULES
- Stay in questioning role.
- Do not give long explanations.
- Do not repeat the same question in different wording.
- Do not change the topic unless the user asks.
- Never switch to analogies or real-life comparisons unless asked.
- Do not repeatedly acknowledge the topic after the first time.
- Keep the conversation collaborative and student-like.
- Never answer the question fully unless the user explicitly asks for explanation.
`;

/* -------------------- MEMORY STORE -------------------- */

const conversations = {};

/*
conversation structure:

{
  messages: [],
  questions: [
    {
      level: "Remember",
      question: "...",
      answer: "...",
      score: 1
    }
  ]
}
*/

/* -------------------- LOGGER -------------------- */

app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

/* -------------------- START ROUTE -------------------- */

app.post("/api/convai/start", (req, res) => {
  const conversationId = Date.now().toString();

  conversations[conversationId] = {
    messages: [
      { role: "system", content: SYSTEM_PROMPT }
    ],
    questions: []
  };

  res.json({
    conversation_id: conversationId
  });
});

/* -------------------- GRADING FUNCTION -------------------- */

async function gradeAnswer(question, answer) {
  try {
    const gradingPrompt = `
Question: ${question}
Student Answer: ${answer}

Grade the answer strictly as:
1 = correct
0.25 = partially correct
0 = incorrect

Return only the number.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [{ role: "user", content: gradingPrompt }],
      temperature: 0
    });

    const raw = completion.choices[0].message.content.trim();
    const score = parseFloat(raw);

    if (![0, 0.25, 1].includes(score)) return 0;

    return score;
  } catch (err) {
    console.log("Grading error:", err);
    return 0;
  }
}

/* -------------------- MESSAGE ROUTE -------------------- */

app.post("/api/convai/message", async (req, res) => {
  try {
    const { message, conversation_id } = req.body;

    if (!message || !conversation_id) {
      return res.status(400).json({
        error: "Message and conversation_id are required"
      });
    }

    const conversation = conversations[conversation_id];

    if (!conversation) {
      return res.status(404).json({
        error: "Conversation not found"
      });
    }

    /* ---------- Save User Answer ---------- */

    const lastQuestion = conversation.questions[conversation.questions.length - 1];

    if (lastQuestion && !lastQuestion.answer) {
      lastQuestion.answer = message;
      lastQuestion.score = await gradeAnswer(lastQuestion.question, message);

      console.log("Graded answer:", lastQuestion);
    }

    /* ---------- Add User Message ---------- */

    conversation.messages.push({
      role: "user",
      content: message
    });

    /* ---------- Ask Model ---------- */

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: conversation.messages,
      temperature: 0.6
    });

    const reply = completion.choices[0].message.content;

    console.log("MODEL REPLY:", reply);

    /* ---------- Extract Level ---------- */

    const levelMatch = reply.match(/\[LEVEL:\s*(Remember|Understand|Apply)\]/i);

    if (levelMatch) {
      const level = levelMatch[1];

      const cleanQuestion = reply
  .replace(/\[LEVEL:\s*(Remember|Understand|Apply)\]/i, "")
  .replace(/\n\s*\n/g, "\n")   // removes empty lines
  .trim();


      conversation.questions.push({
        level,
        question: cleanQuestion,
        answer: null,
        score: null
      });

      console.log("Questions stored:", conversation.questions.length);

      conversation.messages.push({
        role: "assistant",
        content: cleanQuestion
      });

      return res.json({ message: cleanQuestion });
    }

    /* ---------- Fallback ---------- */

    conversation.messages.push({
      role: "assistant",
      content: reply
    });

    res.json({ message: reply });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

/* -------------------- REPORT ROUTE -------------------- */

app.get("/api/convai/report/:conversation_id", (req, res) => {
  const { conversation_id } = req.params;

  const conversation = conversations[conversation_id];

  if (!conversation) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const report = {
    Remember: { total: 0, score: 0 },
    Understand: { total: 0, score: 0 },
    Apply: { total: 0, score: 0 }
  };

  conversation.questions.forEach(q => {
    if (q.score !== null) {
      report[q.level].total += 1;
      report[q.level].score += q.score;
    }
  });

  const percentages = {};

  Object.keys(report).forEach(level => {
    const { total, score } = report[level];
    percentages[level] = total === 0 ? 0 : Math.round((score / total) * 100);
  });

  res.json({
    percentages,
    questions: conversation.questions
  });
});

/* -------------------- LOVE LETTER GAME -------------------- */

app.use("/api/loveletter", require("./loveletter/routes"));

/* -------------------- HEALTH CHECK -------------------- */

app.get("/", (req, res) => {
  res.send("Backend is running");
});

/* -------------------- START SERVER -------------------- */

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
