// =========================================================================
// CivicSays — submit.js
// Resident ticket submission: validation, photo upload, ticket insert,
// success modal. Form state preserved in sessionStorage.
//
// On successful submission, dispatches a CustomEvent
//   window.dispatchEvent(new CustomEvent('civicsays:ticket-submitted', { detail: ticket }))
// rather than setting a global variable. Listeners must explicitly subscribe.
// =========================================================================

import { getClient, friendlyError, unwrap, uploadAttachment } from './supabase.js';
import { T, BUCKET_TICKET_ATTACHMENTS } from './supabase.js';
import { generateTrackingId, formatDate } from './format.js';
import { openModal, toast, copyToClipboard, buttonBusy } from './ui.js';
import { injectSprite, icon } from './icons.js';

// -------------------------------------------------------------------------
// Constants
// -------------------------------------------------------------------------

const STORAGE_KEY = 'civicsays.submit.draft';
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_ID_RETRIES = 5; // for PK collision on CIV-XXXXXX
const MAX_DESC = 5000;

// -------------------------------------------------------------------------
// DOM refs
// -------------------------------------------------------------------------

var form = document.getElementById('ticket-form');
var submitBtn = document.getElementById('submit-btn');
var descCount = document.getElementById('desc-count');
var dropzone = document.getElementById('dropzone');
var photoInput = document.getElementById('f-photo');

var fields = ['name', 'phone', 'email', 'address', 'kind', 'location', 'title', 'description', 'video'];
var inputs = {};
fields.forEach(function (f) {
  inputs[f] = document.getElementById('f-' + f);
});

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------

injectSprite();
restoreDraft();
wireAutoSave();
wirePhotoDropzone();
renderDropzone(); // build the empty state (icon + "Click to upload")
wireDescriptionCounter();
form.addEventListener('submit', onSubmit);

// -------------------------------------------------------------------------
// Draft preservation — sessionStorage so it dies on tab close
// -------------------------------------------------------------------------

function saveDraft() {
  try {
    var draft = {};
    fields.forEach(function (f) {
      draft[f] = inputs[f].value;
    });
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  } catch { /* sessionStorage may be unavailable in private mode */ }
}

function restoreDraft() {
  try {
    var raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    var draft = JSON.parse(raw);
    fields.forEach(function (f) {
      if (draft[f] != null && inputs[f]) inputs[f].value = draft[f];
    });
    updateDescCount();
  } catch { /* ignore */ }
}

function clearDraft() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

function wireAutoSave() {
  fields.forEach(function (f) {
    if (!inputs[f]) return;
    var ev = (f === 'kind') ? 'change' : 'input';
    inputs[f].addEventListener(ev, saveDraft);
  });
}

// -------------------------------------------------------------------------
// Description character counter
// -------------------------------------------------------------------------

function wireDescriptionCounter() {
  if (!inputs.description || !descCount) return;
  inputs.description.addEventListener('input', updateDescCount);
  updateDescCount();
}

function updateDescCount() {
  if (!descCount || !inputs.description) return;
  descCount.textContent = String(inputs.description.value.length);
}

// -------------------------------------------------------------------------
// Photo dropzone
// -------------------------------------------------------------------------

var pendingPhoto = null; // { file, name, size, mime, dataUrl }

// True after a successful submit. Stays true until the user explicitly
// resets the form via the "Submit another" button. Acts as a re-entry
// guard: any subsequent submit (e.g. via a stray click that propagates
// from the success modal's backdrop) is ignored.
var posted = false;

function wirePhotoDropzone() {
  if (!dropzone || !photoInput) return;

  // The dropzone is a <label for="f-photo">, so the browser natively opens
  // the file picker on click and handles keyboard activation. No JS needed
  // for the trigger — we only handle the resulting file selection here.

  // File input change (covers click → picker, drag-drop into input, paste)
  photoInput.addEventListener('change', function () {
    if (photoInput.files && photoInput.files[0]) {
      handlePhoto(photoInput.files[0]);
    }
  });

  // Drag & drop onto the dropzone (which is now a <label>, but drop events
  // still fire on it because labels are HTMLElements)
  ['dragenter', 'dragover'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    dropzone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('is-dragover');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files[0]) handlePhoto(dt.files[0]);
  });
}

function handlePhoto(file) {
  clearFieldError('photo');
  if (!ALLOWED_IMAGE_MIMES.includes(file.type)) {
    setFieldError('photo', 'That file type is not supported. Use JPG, PNG, GIF, or WebP.');
    pendingPhoto = null;
    renderDropzone();
    return;
  }
  if (file.size > MAX_PHOTO_BYTES) {
    setFieldError('photo', 'Photo is larger than 5 MB. Please choose a smaller image.');
    pendingPhoto = null;
    renderDropzone();
    return;
  }
  pendingPhoto = {
    file: file,
    name: file.name,
    size: file.size,
    mime: file.type,
  };
  // Build preview data URL in the background
  var reader = new FileReader();
  reader.onload = function () {
    if (pendingPhoto) pendingPhoto.dataUrl = reader.result;
    renderDropzone();
  };
  reader.onerror = function () {
    pendingPhoto.dataUrl = null;
    renderDropzone();
  };
  reader.readAsDataURL(file);
  renderDropzone();
}

function renderDropzone() {
  if (!dropzone) return;
  // IMPORTANT: do NOT touch dropzone.innerHTML — that would wipe the
  // <input type="file"> child, leaving the <label> with a `for` attribute
  // pointing to a nonexistent input. Subsequent re-uploads would silently
  // fail. Instead, we keep a dedicated content area as a stable sibling
  // and only swap its children.
  var content = dropzone.querySelector('.dropzone-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'dropzone-content';
    dropzone.appendChild(content);
  }
  content.innerHTML = '';

  if (!pendingPhoto) {
    dropzone.classList.remove('is-uploaded');
    content.appendChild(icon('image'));
    var t1 = document.createElement('div');
    t1.className = 'dropzone-text';
    t1.innerHTML = '<strong>Click to upload</strong> or drag a photo here';
    content.appendChild(t1);
    var t2 = document.createElement('div');
    t2.className = 'dropzone-hint';
    t2.textContent = 'JPG, PNG, GIF, or WebP — up to 5 MB';
    content.appendChild(t2);
    return;
  }

  dropzone.classList.add('is-uploaded');
  var preview = document.createElement('div');
  preview.className = 'dropzone-preview';

  if (pendingPhoto.dataUrl) {
    var img = document.createElement('img');
    img.src = pendingPhoto.dataUrl;
    img.alt = pendingPhoto.name;
    preview.appendChild(img);
  } else {
    var ph = document.createElement('div');
    ph.className = 'avatar';
    ph.textContent = 'IMG';
    preview.appendChild(ph);
  }

  var meta = document.createElement('div');
  meta.style.flex = '1';
  meta.style.minWidth = '0';
  var name = document.createElement('div');
  name.className = 'dropzone-preview-name';
  name.textContent = pendingPhoto.name;
  var size = document.createElement('div');
  size.className = 'dropzone-preview-size';
  size.textContent = humanBytes(pendingPhoto.size) + ' · click or drop to replace';
  meta.appendChild(name);
  meta.appendChild(size);
  preview.appendChild(meta);

  var removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'icon-btn';
  removeBtn.setAttribute('aria-label', 'Remove photo');
  removeBtn.appendChild(icon('x'));
  removeBtn.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    pendingPhoto = null;
    if (photoInput) photoInput.value = '';
    clearFieldError('photo');
    renderDropzone();
  });
  preview.appendChild(removeBtn);

  content.appendChild(preview);
}

function humanBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}

// -------------------------------------------------------------------------
// Validation
// -------------------------------------------------------------------------

var validators = {
  name: function (v) {
    if (!v || !v.trim()) return 'Please enter your name.';
    if (v.length > 100) return 'Name is too long (max 100 characters).';
    return null;
  },
  phone: function (v) {
    if (!v || !v.trim()) return 'Please enter your phone number.';
    // Filipino mobile format: 11 digits, starts with "09" (e.g. 0912 345 6789).
    // The DB still permits 7–15 digits for non-mobile or future formats, but
    // the submission form enforces 11 because the form is built for a
    // Filipino audience. Visitors typing "+63..." or "63..." will get a
    // clear inline error rather than silent truncation.
    var digits = v.replace(/\D/g, '');
    if (!/^[0-9]+$/.test(digits)) return 'Phone must contain digits only.';
    if (digits.length !== 11) {
      return 'Phone must be exactly 11 digits (Filipino mobile, e.g. 0912 345 6789).';
    }
    if (!/^09/.test(digits)) {
      return 'Filipino mobile numbers start with 09 (e.g. 0912 345 6789).';
    }
    return null;
  },
  email: function (v) {
    if (!v || !v.trim()) return 'Please enter your email.';
    // Reasonable email check; schema also enforces server-side.
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return 'Please enter a valid email address.';
    return null;
  },
  kind: function (v) {
    if (!v) return 'Please choose a type.';
    if (v !== 'request' && v !== 'complaint') return 'Please choose a type.';
    return null;
  },
  location: function (v) {
    if (!v || !v.trim()) return 'Please enter a location.';
    if (v.length > 300) return 'Location is too long (max 300 characters).';
    return null;
  },
  address: function (v) {
    // Optional. The form lets residents skip it (some don't want to
    // share their home address). We only enforce the length cap.
    if (v && v.length > 300) return 'Address is too long (max 300 characters).';
    return null;
  },
  title: function (v) {
    if (!v || !v.trim()) return 'Please enter a title.';
    if (v.trim().length < 3) return 'Title must be at least 3 characters.';
    if (v.length > 200) return 'Title is too long (max 200 characters).';
    return null;
  },
  description: function (v) {
    if (!v || !v.trim()) return 'Please describe the issue.';
    if (v.length > MAX_DESC) return 'Description is too long (max 5000 characters).';
    return null;
  },
  video: function (v) {
    if (!v) return null; // optional
    // SECURITY: allowlist of accepted video hosts. Prevents phishing links
    // like https://internal-server.local/admin being submitted and shown to
    // officials in the ticket detail view. Mirrors the server-side CHECK
    // constraint in 0007_video_hosts.sql.
    var ALLOWED_VIDEO_HOSTS = [
      /^https?:\/\/(www\.)?youtube\.com\//i,
      /^https?:\/\/youtu\.be\//i,
      /^https?:\/\/(www\.)?vimeo\.com\//i,
      /^https?:\/\/(www\.)?tiktok\.com\//i,
      /^https?:\/\/drive\.google\.com\//i,
      /^https?:\/\/(www\.)?facebook\.com\//i,
      /^https?:\/\/fb\.watch\//i,
      /^https?:\/\/(www\.)?(x|twitter)\.com\//i,
    ];
    if (!/^https?:\/\//i.test(v)) return 'Video link must start with http:// or https://';
    if (!ALLOWED_VIDEO_HOSTS.some(function (re) { return re.test(v); })) {
      return 'Video link must be from YouTube, Vimeo, TikTok, Google Drive, Facebook, or X.';
    }
    return null;
  },
};

function validateAll() {
  var firstInvalid = null;
  fields.forEach(function (f) {
    var val = inputs[f] ? inputs[f].value : '';
    var err = validators[f](val);
    if (err) {
      setFieldError(f, err);
      if (!firstInvalid) firstInvalid = inputs[f];
    } else {
      clearFieldError(f);
    }
  });
  return firstInvalid;
}

function setFieldError(field, message) {
  var errEl = document.getElementById('err-' + field);
  if (errEl) errEl.textContent = message;
  if (inputs[field]) {
    var fieldEl = inputs[field].closest('.field');
    if (fieldEl) fieldEl.classList.add('invalid');
    // A11y: tell assistive tech the field is invalid.
    inputs[field].setAttribute('aria-invalid', 'true');
  }
}

function clearFieldError(field) {
  var errEl = document.getElementById('err-' + field);
  if (errEl) errEl.textContent = '';
  if (inputs[field]) {
    var fieldEl = inputs[field].closest('.field');
    if (fieldEl) fieldEl.classList.remove('invalid');
    inputs[field].removeAttribute('aria-invalid');
  }
}

// Real-time validation: clear the error as the user types
fields.forEach(function (f) {
  if (!inputs[f]) return;
  inputs[f].addEventListener('input', function () { clearFieldError(f); });
  inputs[f].addEventListener('change', function () { clearFieldError(f); });
});

// -------------------------------------------------------------------------
// Submit handler
// -------------------------------------------------------------------------

async function onSubmit(e) {
  e.preventDefault();
  // Re-entry guard: a previous submit already created a ticket. The
  // form is "spent" — ignore any further submit events (including
  // accidental taps on the form area after the success modal closes).
  // The only way to submit again is to click "Submit another" in the
  // success modal, which calls form.reset() and clears this flag.
  if (posted) return;
  var firstInvalid = validateAll();
  if (firstInvalid) {
    firstInvalid.focus();
    toast('Please fix the highlighted fields.', 'error');
    return;
  }

  // Mark the submit button as busy for screen readers BEFORE we start.
  if (submitBtn) submitBtn.setAttribute('aria-busy', 'true');

  var restore = buttonBusy(submitBtn);
  var uploadedPath = null; // track for cleanup if the DB insert fails
  try {
    // 1. Generate the tracking ID first. We'll use it as the Storage path so
    //    the file lives at <CIV-XXXXXX>/<filename> from the start — no rename.
    var id = null;
    var row = null;
    var lastError = null;
    var attempts = 0;
    while (attempts < MAX_ID_RETRIES) {
      id = generateTrackingId();
      attempts++;

      // 2. Upload the photo (if any) under the ID-scoped path.
      //    SECURITY: path is enforced client-side to match the Storage RLS
      //    policy. The leading "CIV-" + 6-char ID makes the prefix unique.
      var attachmentPath = null;
      var attachmentMime = null;
      if (pendingPhoto && pendingPhoto.file) {
        // safeFilename strips leading dots and restricts to a safe charset.
        var safeName = safeFilename(pendingPhoto.name);
        attachmentPath = id + '/' + Date.now() + '_' + safeName;
        attachmentMime = pendingPhoto.mime;
        try {
          await uploadAttachment(attachmentPath, pendingPhoto.file, pendingPhoto.mime);
          uploadedPath = attachmentPath; // remember for cleanup
        } catch (uploadErr) {
          // If upload fails, no DB write happens — bail out cleanly.
          throw uploadErr;
        }
      }

      // 3. Insert the ticket row.
      try {
        row = await unwrap(
          getClient().then(function (c) {
            return c.from(T.TICKETS).insert({
              id: id,
              resident_name: inputs.name.value.trim(),
              resident_phone: inputs.phone.value.replace(/\D/g, ''),
              resident_email: inputs.email.value.trim(),
              resident_address: inputs.address.value.trim() || null,
              kind: inputs.kind.value,
              location: inputs.location.value.trim(),
              title: inputs.title.value.trim(),
              description: inputs.description.value.trim(),
              attachment_path: attachmentPath,
              attachment_mime: attachmentMime,
              video_link: inputs.video.value.trim() || null,
              status: 'pending',
            }).select('id, created_at').single();
          })
        );
        lastError = null;
        uploadedPath = null; // success — file ownership transferred to the DB row
        break;
      } catch (err) {
        // 23505 = unique_violation. Roll back the orphan upload, then retry.
        if (err && /duplicate key|23505/i.test(err.message || '')) {
          lastError = err;
          if (uploadedPath) {
            try {
              var c = await getClient();
              await c.storage.from(BUCKET_TICKET_ATTACHMENTS).remove([uploadedPath]);
            } catch { /* best effort */ }
            uploadedPath = null;
          }
          continue;
        }
        throw err;
      }
    }
    if (!row) {
      throw lastError || new Error('Could not generate a unique tracking ID. Please try again.');
    }

    // 4. Success.
    clearDraft();
    pendingPhoto = null;
    if (photoInput) photoInput.value = '';
    // Lock the form against re-submit. The user can still click
    // "Submit another" in the success modal, which calls form.reset()
    // and clears this flag.
    posted = true;
    showSuccessModal({
      id: row.id,
      createdAt: row.created_at,
      title: inputs.title.value.trim(),
    });
  } catch (err) {
    toast(friendlyError(err), 'error', 6000);
  } finally {
    // Clean up any orphan upload if we exited without success.
    if (uploadedPath) {
      try {
        var c = await getClient();
        await c.storage.from(BUCKET_TICKET_ATTACHMENTS).remove([uploadedPath]);
      } catch { /* best effort */ }
    }
    if (submitBtn) submitBtn.removeAttribute('aria-busy');
    restore();
  }
}

function safeFilename(name) {
  return String(name || 'photo')
    // Strip leading dots — prevents path traversal ("../foo") and hidden files ("...png").
    .replace(/^\.+/, '')
    // Whitelist safe characters only.
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .slice(0, 80) || 'photo';
}

// -------------------------------------------------------------------------
// Success modal
// -------------------------------------------------------------------------

function showSuccessModal(ticket) {
  var modal = openModal(function (body, ctx) {
    // Center the whole success content (icon, text, ID card, hint)
    body.style.textAlign = 'center';

    var iconWrap = document.createElement('div');
    iconWrap.style.cssText = 'display:inline-flex; align-items:center; justify-content:center; width:56px; height:56px; background:var(--status-success-soft); color:var(--status-success); border-radius:var(--radius-full); margin: 0 auto var(--space-4);';
    iconWrap.appendChild(icon('check-circle', { size: 28 }));
    body.appendChild(iconWrap);

    var h = document.createElement('p');
    h.textContent = 'Your ticket has been submitted.';
    h.style.cssText = 'text-align:center; font-size:var(--fs-md); font-weight:var(--fw-semibold); color:var(--text-primary); margin-bottom:var(--space-1);';
    body.appendChild(h);

    var sub = document.createElement('p');
    sub.textContent = 'Save this tracking ID — you\'ll need it to follow up or add more information.';
    sub.style.cssText = 'text-align:center; font-size:var(--fs-sm); color:var(--text-secondary); line-height:var(--lh-relaxed); margin-bottom:var(--space-6); max-width:380px;';
    body.appendChild(sub);

    // ID card — block-level so it can center itself with margin auto
    var idCard = document.createElement('div');
    idCard.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:var(--space-3); padding:var(--space-3) var(--space-4); background:var(--glass-secondary); border:1px solid var(--border-default); border-radius:var(--radius-card); max-width:360px; margin: 0 auto var(--space-4); text-align:left;';
    var idText = document.createElement('code');
    idText.id = 'success-id';
    idText.textContent = ticket.id;
    idText.style.cssText = 'font-family:var(--font-mono); font-size:var(--fs-md); font-weight:var(--fw-semibold); color:var(--accent); letter-spacing:var(--letter-wide);';
    idCard.appendChild(idText);
    var copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-ghost btn-sm';
    copyBtn.id = 'copy-id-btn';
    copyBtn.appendChild(icon('copy', { size: 14 }));
    var copyLabel = document.createElement('span');
    copyLabel.textContent = 'Copy';
    copyBtn.appendChild(copyLabel);
    copyBtn.addEventListener('click', async function () {
      var ok = await copyToClipboard(ticket.id);
      if (ok) {
        copyLabel.textContent = 'Copied';
        copyBtn.disabled = true;
        setTimeout(function () {
          copyLabel.textContent = 'Copy';
          copyBtn.disabled = false;
        }, 1600);
      } else {
        toast('Could not copy. Select the ID manually.', 'error');
      }
    });
    idCard.appendChild(copyBtn);
    body.appendChild(idCard);

    // Filed-on date — disambiguates among multiple tickets filed in the
    // same week. Small, muted, centered under the ID card.
    if (ticket.created_at) {
      var filed = document.createElement('p');
      filed.textContent = 'Filed on ' + formatDate(ticket.created_at);
      filed.style.cssText = 'text-align:center; font-size:var(--fs-xs); color:var(--text-muted); margin: 0 auto var(--space-4); font-variant-numeric: tabular-nums;';
      body.appendChild(filed);
    }

    // What happens next
    var next = document.createElement('p');
    next.textContent = 'You can now track this ticket to see status updates and post comments.';
    next.style.cssText = 'text-align:center; font-size:var(--fs-xs); color:var(--text-muted); margin-bottom:var(--space-2);';
    body.appendChild(next);

    ctx.setFooter(buildSuccessFooter(ticket, ctx));
    // Non-dismissible: this modal shows the tracking ID the resident needs
    // to copy/follow up. A stray tap on the backdrop should NOT close it
    // (the user would lose the ID and — worse — the same click used to
    // bubble through to the form and re-fire submit). The footer has
    // explicit "Submit another" / close buttons; those call ctx.close()
    // directly. Escape and backdrop clicks are intentionally inert.
  }, { dismissible: false, size: 'sm' });

  // Dispatch a custom event instead of setting a global. Only listeners
  // that explicitly subscribe will see the data — third-party scripts and
  // browser extensions cannot passively read this.
  try {
    window.dispatchEvent(new CustomEvent('civicsays:ticket-submitted', { detail: ticket }));
  } catch { /* CustomEvent may not exist in very old browsers */ }
}

function buildSuccessFooter(ticket, ctx) {
  var footer = document.createElement('div');
  // Override the default modal-footer (justify-content: flex-end) so the
  // two action buttons share the row evenly and the footer spans full width.
  footer.style.cssText = 'display:flex; gap:var(--space-3); width:100%; justify-content:stretch;';

  var trackBtn = document.createElement('a');
  trackBtn.className = 'btn btn-primary';
  trackBtn.href = 'ticket.html?id=' + encodeURIComponent(ticket.id);
  trackBtn.style.flex = '1';
  trackBtn.appendChild(icon('eye', { size: 16 }));
  var trackLabel = document.createElement('span');
  trackLabel.textContent = 'Track this ticket';
  trackBtn.appendChild(trackLabel);
  footer.appendChild(trackBtn);

  var anotherBtn = document.createElement('button');
  anotherBtn.type = 'button';
  anotherBtn.className = 'btn btn-secondary';
  anotherBtn.textContent = 'Submit another';
  anotherBtn.addEventListener('click', function () {
    ctx.close();
    // Reset the form for a fresh entry AND clear the persisted draft so
    // the next session doesn't see stale data. Clear the `posted` flag
    // so the user can actually submit the new entry.
    form.reset();
    clearDraft();
    pendingPhoto = null;
    if (photoInput) photoInput.value = '';
    posted = false;
    renderDropzone();
    updateDescCount();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(function () { inputs.name && inputs.name.focus(); }, 250);
  });
  footer.appendChild(anotherBtn);

  return footer;
}
