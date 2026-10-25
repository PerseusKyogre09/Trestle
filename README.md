# TRESTLE

TRESTLE helps people turn a life event into a clear list of next steps. Describe what happened, review a proposed plan, and work through the steps while keeping control of personal and important actions.

## What you can do

- Describe a situation in English, Hindi, Bengali, Gujarati, or Punjabi.
- Use the microphone to add a speech transcript to the description. You can edit it before continuing.
- Review a suggested workflow and save it as a case.
- Track progress, review official guidance, and see what still needs your attention.
- Approve sensitive actions before they can run. TRESTLE does not submit applications, make payments, or claim an action succeeded without evidence.

Cases are saved in a local SQLite database during development.

## Run TRESTLE locally

You need Node.js 20.9 or later, npm, and Git.

```bash
git clone <YOUR_REPOSITORY_URL>
cd trestle
npm install
cp .env.example .env.local
cp .env.example .env
npm run db:generate
npm run db:migrate
npm run speech:models
npm run dev
```

Open <http://localhost:3000>.

Next.js reads `.env.local`. Prisma reads `.env`. The example files set up a local SQLite database. Add optional API keys to `.env.local` when you want to use the related service.

`npm run speech:models` downloads the Tiny and Base speech models (about 217 MB total) into `public/speech/`. The model files are ignored by Git and checked against their SHA-256 checksums. To download only one model, run `npm run speech:models -- base` or `npm run speech:models -- tiny`.

**Keep your data:** `npm run db:reset` deletes the local database. Use it only when you intentionally want to erase saved cases and start over.

## Speech and audio: what happens

The microphone control records audio in the browser. TRESTLE runs two transcription paths at the same time:

1. The browser converts the recording to 16 kHz audio and sends it to a Web Worker. The worker runs whisper.cpp WASM locally with the selected language and model.
2. The browser also sends the recording to TRESTLE's `/api/speech` route. If a Sarvam API key is configured, the server forwards the audio to Sarvam's `saaras:v4` speech-to-text service.

The first successful transcript is inserted into the description field. If Sarvam fails, the local worker can still provide the transcript.

**Speech is not local-only in the current implementation.** The browser sends audio to the TRESTLE server on every transcription attempt. With `SARVAM_API` or `SARVAM_API_KEY` configured, the server also sends the recording to Sarvam. The API key stays on the server; the recording is shared with Sarvam. Both paths start in parallel, so audio may reach Sarvam even when the local model returns first.

### Models and browser requirements

- Whisper Base (about 142 MB) is selected by default. Whisper Tiny (about 75 MB) is available as a smaller, faster option.
- Both multilingual model files and the whisper.cpp WASM runtime are served from `public/speech/` by this app. The browser model manager caches model weights in IndexedDB for later use.
- Microphone recording requires browser permission and HTTPS, or `localhost` during development.
- WASM shared memory needs cross-origin isolation. The Next.js configuration sets the required COOP and COEP headers. A production host or proxy must preserve them.
- Whisper can mishear short phrases, accents, and code-switching. Check and edit the transcript before you submit the case.

To enable the Sarvam path, set one of these server environment variables in `.env.local`:

```dotenv
SARVAM_API=your_key_here
# or: SARVAM_API_KEY=your_key_here
```

Do not put the key in browser code or commit it. If no Sarvam key is set, the browser still posts audio to `/api/speech`, but that route cannot forward it and the local worker remains available. Keeping transcription entirely in the browser requires disabling that request in the application code.

## Optional planning and research services

- `GROQ_API_KEY` enables workflow planning. TRESTLE sends Groq a reduced planning brief rather than the raw description or saved case details. Local workflow rules are used when planning is unavailable.
- `TINYFISH_API_KEY` enables live, read-only research for supported workflows. TinyFish receives generic research details such as jurisdiction and document type, not audio or completed form values.

Leave either key blank to run without that service. Never commit API keys.

## Commands

```bash
npm run dev       # Start the development server
npm test          # Run the test suite
npm run lint      # Check the code with ESLint
npm run build     # Create a production build
npm start         # Serve the production build
```

## Current limits

- The app does not have multi-user sign-in or access control. Keep deployments private until authentication and case ownership are implemented.
- Live TinyFish support is limited to read-only research for supported cases. The shared browser is user controlled.
- Speech transcription can be inaccurate. Local WASM is a fallback path, and configured Sarvam processing sends the audio outside the app.
- Some workflow steps are guidance for the user; they are not automatically completed by TRESTLE.

## Where to look in the code

- `src/app/page.tsx` — home page and case description form
- `src/app/speech/` — microphone UI, audio preparation, and worker orchestration
- `public/speech/` — whisper.cpp WASM runtime, model assets, and inference worker
- `src/app/api/speech/` and `src/server/sarvam.ts` — server speech route and Sarvam request
- `src/domain/` — workflow types, compiler, and readiness rules
- `src/server/` — persistence, approvals, policy, planning, and providers
- `src/app/cases/[id]/page.tsx` — case dashboard
