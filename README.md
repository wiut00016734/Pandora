# 🔒 Pandora — Anonymous File Sharing

A presentation-safe, account-free file sharing platform with QR codes, 
student submission mode, and 7-day auto-expiry.

---

## Quick Start

### 1. Install dependencies
```bash
npm install
```

### 2. Set up your .env
Your `.env` file is already pre-filled with your Supabase credentials.
Double-check it looks like this:
```
SUPABASE_URL=https://qqxertnwujdiykbnxlrj.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci...
PORT=3000
```

### 3. Set up the database
Go to **Supabase Dashboard → SQL Editor → New Query**
and run the contents of `pandora_setup.sql`.

This creates:
- `boxes` table — stores anonymous keys (hashed) and box settings
- `files` table — stores file metadata and expiry dates
- `pandora-files` storage bucket — stores the actual file bytes

### 4. Run the app
```bash
npm start
# or for development with auto-reload:
npm run dev
```

Open http://localhost:3000

---

## How it works

### For presenters
1. Click **Create My Box** — a `XXXX-XXXX-XXXX-XXXX` key is generated
2. Copy and save your key (shown once only)
3. Upload your files (PDF, DOCX, PPTX, XLSX, images — max 25MB each)
4. Share the **QR code** or **Box link** with your audience
5. Optionally toggle **Submission Mode** to let students upload back to you

### For audience members
1. Scan the QR code or open the shared link
2. Download any file with one click — no login required
3. In submission mode, upload files anonymously (no identity recorded)

### Security
- Keys are stored as **bcrypt hashes** — never in plaintext
- Files are stored under **UUID-based paths** — not guessable
- All files **auto-delete after 7 days**
- MIME-type validation prevents executable uploads
- 25MB file size limit

---

## Project Structure

```
pandora/
├── server.js              # Express app entry point
├── .env                   # Your Supabase credentials (DO NOT COMMIT)
├── package.json
├── lib/
│   ├── supabase.js        # Supabase client
│   └── utils.js           # Key generation, hashing, helpers
├── routes/
│   ├── boxes.js           # Box create/login/manage API
│   └── files.js           # File upload/download API
└── public/
    ├── index.html         # Main app (create/login/manage box)
    └── box.html           # Public viewer (audience page)
```

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/boxes` | Create a new box |
| POST | `/api/boxes/login` | Login with anonymous key |
| GET | `/api/boxes/:id/public` | Get box + files (no key needed) |
| PATCH | `/api/boxes/:id/submission` | Toggle submission mode |
| DELETE | `/api/boxes/:id/files/:fileId` | Delete a file |
| POST | `/api/files/upload` | Upload a file to a box |
| GET | `/api/files/:id/download` | Download a file (redirects to signed URL) |

---

## Deployment (optional)

To deploy to the web, push to **Railway**, **Render**, or **Fly.io**:
1. Create a new project on Railway (railway.app)
2. Connect your GitHub repo
3. Add your `.env` variables in the Railway dashboard
4. Deploy — Railway auto-detects Node.js

Your Supabase database and storage are already in the cloud, 
so only the Node.js server needs deploying.

---

## ⚠️ Important

- **Never commit `.env` to GitHub** — add it to `.gitignore`
- The service role key has full database access
- For production, add rate limiting (express-rate-limit) to the upload route
