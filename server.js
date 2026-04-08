require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const boxesRouter = require('./routes/boxes');
const filesRouter = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──
app.use('/api/boxes', boxesRouter);
app.use('/api/files', filesRouter);

// ── Frontend Routes ──
// Box viewer page — now served by index.html (full UI with sidebar)
app.get('/box/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// All other routes → main app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`\n🔒 Pandora running at http://localhost:${PORT}\n`);
});