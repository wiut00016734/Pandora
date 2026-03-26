const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { generateKey, hashKey, verifyKey, sevenDaysFromNow } = require('../lib/utils');
const QRCode = require('qrcode');

// SHA-256 of the key — used for fast DB lookup (not secret, just an index)
function keyIndex(key) {
  return crypto.createHash('sha256').update(key.toUpperCase().trim()).digest('hex');
}

// POST /api/boxes — create a new box
router.post('/', async (req, res) => {
  try {
    const { label, key_override } = req.body;
    const plainKey = (key_override || generateKey()).toUpperCase().trim();
    const key_hash = await hashKey(plainKey);
    const key_index = keyIndex(plainKey);

    const { data, error } = await supabase
      .from('boxes')
      .insert({ key_hash, key_index, label: label || null, expires_at: null })
      .select('id, created_at, label, submission_mode')
      .single();

    if (error) throw error;

    const boxUrl = `${req.protocol}://${req.get('host')}/box/${data.id}`;
    const qr = await QRCode.toDataURL(boxUrl, { width: 300, margin: 2 });

    res.json({ success: true, key: plainKey, box: data, boxUrl, qr });
  } catch (err) {
    console.error('Create box error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/boxes/login — verify key, return box data
router.post('/login', async (req, res) => {
  try {
    const { key } = req.body;
    if (!key) return res.status(400).json({ success: false, error: 'Key required' });

    const normalised = key.toUpperCase().trim();
    const index = keyIndex(normalised);

    // Fast lookup by SHA index — only one row fetched
    const { data: boxes, error } = await supabase
      .from('boxes')
      .select('id, key_hash, created_at, label, submission_mode, expires_at')
      .eq('key_index', index);

    if (error) throw error;
    if (!boxes || boxes.length === 0) {
      return res.status(401).json({ success: false, error: 'Invalid key' });
    }

    // bcrypt verify the single matched row
    const matched = boxes[0];
    const ok = await verifyKey(normalised, matched.key_hash);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid key' });

    const { data: files } = await supabase
      .from('files')
      .select('id, original_name, mime_type, size_bytes, uploaded_at, expires_at, download_count')
      .eq('box_id', matched.id)
      .order('uploaded_at', { ascending: false });

    const boxUrl = `${req.protocol}://${req.get('host')}/box/${matched.id}`;
    const qr = await QRCode.toDataURL(boxUrl, { width: 300, margin: 2 });

    res.json({ success: true, box: matched, files: files || [], boxUrl, qr });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/boxes/:id/public — public viewer (no key needed)
router.get('/:id/public', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: box, error } = await supabase
      .from('boxes')
      .select('id, label, submission_mode, created_at')
      .eq('id', id)
      .single();

    if (error || !box) return res.status(404).json({ success: false, error: 'Box not found' });

    const { data: files } = await supabase
      .from('files')
      .select('id, original_name, mime_type, size_bytes, uploaded_at, expires_at, download_count')
      .eq('box_id', id)
      .order('uploaded_at', { ascending: false });

    res.json({ success: true, box, files: files || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/boxes/:id/submission — toggle submission mode
router.patch('/:id/submission', async (req, res) => {
  try {
    const { id } = req.params;
    const { key, submission_mode } = req.body;
    const { data: box } = await supabase.from('boxes').select('key_hash').eq('id', id).single();
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    const ok = await verifyKey(key.toUpperCase().trim(), box.key_hash);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid key' });
    await supabase.from('boxes').update({ submission_mode }).eq('id', id);
    res.json({ success: true, submission_mode });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/boxes/:id/files/:fileId — delete a file
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const { key } = req.body;
    const { data: box } = await supabase.from('boxes').select('key_hash').eq('id', id).single();
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    const ok = await verifyKey(key.toUpperCase().trim(), box.key_hash);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid key' });
    const { data: file } = await supabase.from('files').select('storage_path').eq('id', fileId).single();
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    await supabase.storage.from('pandora-files').remove([file.storage_path]);
    await supabase.from('files').delete().eq('id', fileId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;