const express = require('express');
const router = express.Router();
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const supabase = require('../lib/supabase');
const { verifyKey, sevenDaysFromNow } = require('../lib/utils');

// Allowed MIME types
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

const MAX_SIZE = 25 * 1024 * 1024; // 25MB

// Use memory storage — we stream directly to Supabase
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  }
});

// POST /api/files/upload — upload file to a box
// Requires either: owner key (any box), or submission_mode=true (public upload)
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const { box_id, key } = req.body;
    if (!req.file) return res.status(400).json({ success: false, error: 'No file provided' });
    if (!box_id) return res.status(400).json({ success: false, error: 'box_id required' });

    // Fetch the box
    const { data: box, error: boxError } = await supabase
      .from('boxes')
      .select('id, key_hash, submission_mode')
      .eq('id', box_id)
      .single();

    if (boxError || !box) return res.status(404).json({ success: false, error: 'Box not found' });

    // Check permissions: must be owner OR box must be in submission mode
    let allowed = false;
    if (key) {
      allowed = await verifyKey(key, box.key_hash);
    }
    if (!allowed && box.submission_mode) {
      allowed = true; // Public submission allowed
    }
    if (!allowed) {
      return res.status(403).json({ success: false, error: 'Access denied. Box is not in submission mode.' });
    }

    // Generate UUID-based storage path
    const ext = req.file.originalname.split('.').pop();
    const storagePath = `${box_id}/${uuidv4()}.${ext}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('pandora-files')
      .upload(storagePath, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Save metadata to DB
    const { data: fileRecord, error: dbError } = await supabase
      .from('files')
      .insert({
        box_id,
        original_name: req.file.originalname,
        storage_path: storagePath,
        mime_type: req.file.mimetype,
        size_bytes: req.file.size,
        expires_at: sevenDaysFromNow()
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

// GET /api/files/:fileId/download — download a file (increments counter)
router.get('/:fileId/download', async (req, res) => {
  try {
    const { fileId } = req.params;

    const { data: file, error } = await supabase
      .from('files')
      .select('*')
      .eq('id', fileId)
      .single();

    if (error || !file) return res.status(404).json({ success: false, error: 'File not found' });

    // Check expiry
    if (new Date(file.expires_at) < new Date()) {
      return res.status(410).json({ success: false, error: 'File has expired' });
    }

    // Get signed URL from Supabase Storage (60 second expiry)
    const { data: signed, error: signError } = await supabase.storage
      .from('pandora-files')
      .createSignedUrl(file.storage_path, 60);

    if (signError) throw signError;

    // Increment download count
    await supabase
      .from('files')
      .update({ download_count: file.download_count + 1 })
      .eq('id', fileId);

    // Redirect to the signed URL
    res.redirect(signed.signedUrl);
  } catch (err) {
    console.error('Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Multer error handler
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ success: false, error: 'File too large. Maximum size is 25MB.' });
  }
  res.status(400).json({ success: false, error: err.message });
});

module.exports = router;
