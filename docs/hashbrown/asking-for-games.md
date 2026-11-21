# Asking for games

How to get the game you want when the AI drafts one from a passage. The
plan behind it is [creating-games-with-hashbrown.md](creating-games-with-hashbrown.md).

## Where

- **Draft Game page.** On **Games**, click **Draft Game**, then **New draft**.
  Paste the passage, pick a mix and the number of options, and click
  **Generate**. Your drafts are saved as you go, and you can keep several.
- **Chat.** Paste the passage and ask in your own words. The chat shows the
  draft as a card with **Create game**, **Discard** and **Open in Draft
  Game**. Ask for changes (*"make question 4 harder"*) and the card updates.
  The draft is the same one the Draft Game page lists.

Nothing the AI writes is playable until you click **Create game**. Check the
questions first: the AI can mark the wrong answer as correct, or write two
options that are both right.

## What to paste

- A few paragraphs: a story, a dialog, a short article. Up to 8,000
  characters.
- Only text you may share. Other signed-in users can see it once you share
  the draft or make a game from it.
- No one's personal details, and no real names in the game title. The title
  and questions go to the LRS.
- The text is sent to OpenAI to write the questions.

## Mixes

A game has 10 questions unless you ask for another number (up to 20). Each
question tests one of three things:

- **Vocabulary**: what a word from the passage means
- **Grammar**: which form fits, or what a pattern means
- **Comprehension**: who, what or why in the passage

| Mix | Vocabulary | Grammar | Comprehension | Good for |
| --- | --- | --- | --- | --- |
| **Vocabulary** (default) | 6 | 2 | 2 | Learning the words in a new passage |
| **Balanced** | 3 | 3 | 4 | A general check after studying the passage |
| **Comprehension** | 2 | 2 | 6 | Checking that the story was understood |
| **Grammar** | 2 | 6 | 2 | Practising the passage's patterns |

For another number of questions the counts scale: 12 questions in the
vocabulary mix are 7 vocabulary, 2 grammar and 3 comprehension.

## Options

- **4 options** (A–D) by default, with exactly one correct.
- **5 options** (A–E) if you ask for them. The game then needs a card group
  with an E card, and **Start Game** stays off until it has one.

## Examples (chat)

| You want | Ask |
| --- | --- |
| The default | *"Make a game from this story: …"* |
| Comprehension-heavy | *"Make a comprehension game from this: …"* or *"Mostly questions about what happens in the story"* |
| Balanced | *"Make a balanced game: some vocab, some grammar, some comprehension"* |
| Exact counts | *"12 questions: 8 vocabulary and 4 grammar"* |
| Five options | *"Use five options per question"* |
| A focus | *"Focus on verbs"*, *"Only the grammar pattern -았/었더니"* |
| A change afterwards | *"Make question 4 harder"*, *"Replace the last two with comprehension questions"* |

## On the Draft Game page

- **Generate** writes the whole game. **Generate again** replaces every
  question, so do it before you start editing.
- **Regenerate** (the ↻ on a question) writes a new one in its place. Add a
  note to steer it: *"harder"*, *"about 았더니"*, *"make it a grammar
  question"*.
- **Generate more** adds questions in the same mix, without repeating the
  ones you have.
- Edit any text, click the circle next to an option to make it the correct
  one, move questions up and down, or add your own.
- Red notes under a question are what stops the game being created: two
  correct options, an option over 60 characters, a question over 120.
  Short text reads better on the student screen, so shorten rather than
  explain.
- **Share** lists the draft under every referee's **Shared drafts**. They
  can edit it with you. Only you can create the game, unshare or delete it.
- **Duplicate** on any game, yours or another referee's, starts a new draft
  of your own from it.

## What gets tracked

A game made this way is an ordinary class game. When it's exported, the LRS
gets each answer (`answered`) and each player's score (`scored`). It doesn't
move Leitner levels: that needs a library chapter (planned for H2), where
the vocabulary becomes tracked learning objects.
