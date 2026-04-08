const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const supabase = require('../lib/supabase');
const { generateKey, generateViewerKey, hashKey, verifyKey, keyIndex, daysFromNow } = require('../lib/utils');
const QRCode = require('qrcode');

// POST /api/boxes — create
router.post('/', async (req, res) => {
  try {
    const { label, description, key_override, viewer_key_override, duration_days, chat_enabled, password } = req.body;
    const plainKey = (key_override || generateKey()).toUpperCase().trim();
    const plainViewerKey = (viewer_key_override || generateViewerKey()).toUpperCase().trim();
    const days = parseInt(duration_days) || 7;

    const [key_hash, viewer_key_hash] = await Promise.all([hashKey(plainKey), hashKey(plainViewerKey)]);
    const key_idx = keyIndex(plainKey);
    const viewer_key_idx = keyIndex(plainViewerKey);
    let password_hash = null;
    if (password && password.trim()) password_hash = await hashKey(password.trim());

    const { data, error } = await supabase.from('boxes').insert({
      key_hash, key_index: key_idx,
      viewer_key_hash, viewer_key_index: viewer_key_idx,
      label: label || null, description: description || null,
      expires_at: daysFromNow(days), duration_days: days,
      chat_enabled: !!chat_enabled, password_hash, submission_mode: false
    }).select('id, created_at, label, description, submission_mode, chat_enabled, expires_at, duration_days, password_hash').single();

    if (error) throw error;

    const boxUrl = `${req.protocol}://${req.get('host')}/box/${data.id}`;
    const qr = await QRCode.toDataURL(boxUrl, { width: 300, margin: 2 });
    const hasPassword = !!data.password_hash;
    delete data.password_hash;

    res.json({ success: true, key: plainKey, viewerKey: plainViewerKey, box: { ...data, hasPassword }, boxUrl, qr });
  } catch (err) {
    console.error('Create box error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /api/boxes/login
router.post('/login', async (req, res) => {
  try {
    const { key, password } = req.body;
    if (!key) return res.status(400).json({ success: false, error: 'Key required' });

    const normalised = key.toUpperCase().trim();
    const idx = keyIndex(normalised);

    let matched = null, isOwner = false;

    // Try owner key
    const { data: ownerBoxes } = await supabase.from('boxes')
      .select('id, key_hash, viewer_key_hash, password_hash, created_at, label, description, submission_mode, chat_enabled, expires_at, duration_days')
      .eq('key_index', idx);
    if (ownerBoxes?.length > 0 && await verifyKey(normalised, ownerBoxes[0].key_hash)) {
      matched = ownerBoxes[0]; isOwner = true;
    }

    // Try viewer key
    if (!matched) {
      const { data: viewerBoxes } = await supabase.from('boxes')
        .select('id, key_hash, viewer_key_hash, password_hash, created_at, label, description, submission_mode, chat_enabled, expires_at, duration_days')
        .eq('viewer_key_index', idx);
      if (viewerBoxes?.length > 0 && await verifyKey(normalised, viewerBoxes[0].viewer_key_hash)) {
        matched = viewerBoxes[0]; isOwner = false;
      }
    }

    if (!matched) return res.status(401).json({ success: false, error: 'Invalid key' });

    // Check password if box has one (skip for owner)
    if (!isOwner && matched.password_hash) {
      if (!password) return res.status(401).json({ success: false, error: 'PASSWORD_REQUIRED' });
      const pwOk = await verifyKey(password, matched.password_hash);
      if (!pwOk) return res.status(401).json({ success: false, error: 'Wrong password' });
    }

    const hasPassword = !!matched.password_hash;
    delete matched.password_hash;

    const [filesRes, messagesRes] = await Promise.all([
      supabase.from('files').select('id, original_name, mime_type, size_bytes, uploaded_at, expires_at, download_count').eq('box_id', matched.id).order('uploaded_at', { ascending: false }),
      supabase.from('messages').select('id, nickname, avatar_color, content, is_creator, created_at').eq('box_id', matched.id).order('created_at', { ascending: true }).limit(100)
    ]);

    const boxUrl = `${req.protocol}://${req.get('host')}/box/${matched.id}`;
    const qr = await QRCode.toDataURL(boxUrl, { width: 300, margin: 2 });

    res.json({ success: true, box: { ...matched, hasPassword }, files: filesRes.data || [], messages: messagesRes.data || [], boxUrl, qr, isOwner });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/boxes/:id/public
router.get('/:id/public', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: box, error } = await supabase.from('boxes')
      .select('id, label, description, submission_mode, chat_enabled, created_at, expires_at, duration_days, password_hash')
      .eq('id', id).single();

    if (error || !box) return res.status(404).json({ success: false, error: 'Box not found' });

    // Keep password_hash for verification, extract it cleanly
    const storedHash = box.password_hash;
    const hasPassword = !!storedHash;
    delete box.password_hash;

    if (hasPassword) {
      const { password } = req.query;
      // No password supplied — tell client to show the gate
      if (!password) return res.status(401).json({ success: false, error: 'PASSWORD_REQUIRED', box: { label: box.label, hasPassword: true } });
      // Wrong password
      const pwOk = await verifyKey(password, storedHash);
      if (!pwOk) return res.status(401).json({ success: false, error: 'Wrong password' });
    }

    const [filesRes, messagesRes] = await Promise.all([
      supabase.from('files').select('id, original_name, mime_type, size_bytes, uploaded_at, expires_at, download_count').eq('box_id', id).order('uploaded_at', { ascending: false }),
      supabase.from('messages').select('id, nickname, avatar_color, content, is_creator, created_at').eq('box_id', id).order('created_at', { ascending: true }).limit(100)
    ]);

    res.json({ success: true, box: { ...box, hasPassword }, files: filesRes.data || [], messages: messagesRes.data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/boxes/:id/refresh
router.get('/:id/refresh', async (req, res) => {
  try {
    const { id } = req.params;
    const [filesRes, messagesRes] = await Promise.all([
      supabase.from('files').select('id, original_name, mime_type, size_bytes, uploaded_at, expires_at, download_count').eq('box_id', id).order('uploaded_at', { ascending: false }),
      supabase.from('messages').select('id, nickname, avatar_color, content, is_creator, created_at').eq('box_id', id).order('created_at', { ascending: true }).limit(100)
    ]);
    res.json({ success: true, files: filesRes.data || [], messages: messagesRes.data || [] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/boxes/:id/settings
router.patch('/:id/settings', async (req, res) => {
  try {
    const { id } = req.params;
    const { key, submission_mode, chat_enabled } = req.body;
    const { data: box } = await supabase.from('boxes').select('key_hash').eq('id', id).single();
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    const ok = await verifyKey(key, box.key_hash);
    if (!ok) return res.status(401).json({ success: false, error: 'Invalid key' });
    const updates = {};
    if (submission_mode !== undefined) updates.submission_mode = submission_mode;
    if (chat_enabled !== undefined) updates.chat_enabled = chat_enabled;
    await supabase.from('boxes').update(updates).eq('id', id);
    res.json({ success: true, ...updates });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /api/boxes/:id/files/:fileId
router.delete('/:id/files/:fileId', async (req, res) => {
  try {
    const { id, fileId } = req.params;
    const { key } = req.body;
    const { data: box } = await supabase.from('boxes').select('key_hash').eq('id', id).single();
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });
    const ok = await verifyKey(key, box.key_hash);
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

// POST /api/boxes/:id/messages
router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { key, content, nickname, avatar_color } = req.body;
    if (!content?.trim()) return res.status(400).json({ success: false, error: 'Empty message' });

    const { data: box } = await supabase.from('boxes')
      .select('key_hash, viewer_key_hash, chat_enabled').eq('id', id).single();
    if (!box) return res.status(404).json({ success: false, error: 'Box not found' });

    const normalised = (key || '').toUpperCase().trim();
    let isCreator = false;

    if (normalised && await verifyKey(normalised, box.key_hash)) {
      isCreator = true;
    } else {
      if (!box.chat_enabled) return res.status(403).json({ success: false, error: 'Chat not enabled' });
      // Allow public viewers (key='VIEWER') or verified viewer key holders
      if (normalised && normalised !== 'VIEWER' && box.viewer_key_hash) {
        const viewerOk = await verifyKey(normalised, box.viewer_key_hash);
        if (!viewerOk) return res.status(401).json({ success: false, error: 'Invalid key' });
      }
    }

    const { data: msg, error } = await supabase.from('messages')
      .insert({ box_id: id, nickname, avatar_color, content: content.trim(), is_creator: isCreator })
      .select().single();
    if (error) throw error;
    res.json({ success: true, message: msg });
  } catch (err) {
    console.error('Message error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;