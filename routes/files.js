const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { verifyKey, daysFromNow } = require('../lib/utils');

const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
]);

const MAX_SIZE = 25 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    ALLOWED_TYPES.has(file.mimetype) ? cb(null, true) : cb(new Error(`File type not allowed: ${file.mimetype}`));
  }
});

// POST /api/files/upload
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { box_id, key } = req.body;
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!box_id)   return res.status(400).json({ success: false, error: 'box_id required' });

    const { data: box, error: boxError } = await supabase
      .from('boxes')
      .select('id, key_hash, submission_mode, duration_days')
      .eq('id', box_id)
      .single();

    if (boxError || !box) return res.status(404).json({ success: false, error: 'Box not found' });

    // Owner key OR submission mode
    let allowed = false;
    if (key) allowed = await verifyKey(key, box.key_hash);
    if (!allowed && box.submission_mode) allowed = true;
    if (!allowed) return res.status(403).json({ success: false, error: 'Access denied. Box is not in submission mode.' });

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const storagePath = `${box_id}/${uuidv4()}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from('pandora-files')
      .upload(storagePath, req.file.buffer, { contentType: req.file.mimetype, upsert: false });

    if (uploadError) throw uploadError;

    // Use the BOX's duration, not hardcoded 7 days
    const days = box.duration_days || 7;

    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        box_id,
        original_name: req.file.originalname,
        storage_path: storagePath,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        expires_at: daysFromNow(days)
      })
      .select()
      .single();

    if (dbError) throw dbError;
    res.json({ success: true, file: fileRecord });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/files/:fileId/download
router.get('/:fileId/download', async (req, res) => {
  try {
    const { fileId } = req.params;
    const { data: file, error } = await supabase.from('files').select('*').eq('id', fileId).single();
    if (error || !file) return res.status(404).json({ success: false, error: 'File not found' });
    if (new Date(file.expires_at) < new Date()) return res.status(410).json({ success: false, error: 'File has expired' });

    const { data: signed, error: signError } = await supabase.storage
      .from('pandora-files').createSignedUrl(file.storage_path, 60);
    if (signError) throw signError;

    await supabase.from('files').update({ download_count: file.download_count + 1 }).eq('id', fileId);
    res.redirect(signed.signedUrl);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: 'File too large. Max 25MB.' });
  res.status(400).json({ success: false, error: err.message });
});

module.exports = router;