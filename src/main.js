// main.js - Frontend JavaScript for HeyGen LiveAvatar + Document Ingestion Pipeline
import { StreamingAvatarApi, Configuration } from '@heygen/streaming-avatar';

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

const BACKEND_URL = () => {
  const input = document.getElementById('backendUrl')?.value.trim();
  if (input) return input;

  // VITE_BACKEND_URL is set at build-time in Vercel
  if (import.meta.env.VITE_BACKEND_URL) {
    return import.meta.env.VITE_BACKEND_URL.replace(/\/$/, ''); // Remove trailing slash
  }

  // Fallback for local development or if env var is missing
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    console.warn('BACKEND_URL is not configured for production. Please set VITE_BACKEND_URL in Vercel.');
  }
  return 'http://localhost:3002';
};

// ═══════════════════════════════════════════════════════════════════════════════
//  TAB NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DOCUMENT INGESTION PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

let selectedFile = null;
let currentJobId = null;
let pollInterval = null;

function showIngestStatus(message, type = 'info') {
  const bar = document.getElementById('ingestStatus');
  bar.className = `status-bar visible ${type}`;
  bar.innerHTML = type === 'info' && !message.includes('failed')
    ? `<span class="spinner"></span> ${message}`
    : message;
}

function hideIngestStatus() {
  document.getElementById('ingestStatus').className = 'status-bar';
}

function updatePipelineStep(step, state = 'active') {
  document.querySelectorAll('.pipeline-step').forEach(el => {
    const s = parseInt(el.dataset.step);
    if (s < step) {
      el.className = 'pipeline-step done';
      el.querySelector('.step-circle').innerHTML = '&#10003;';
    } else if (s === step) {
      el.className = `pipeline-step ${state}`;
      el.querySelector('.step-circle').textContent = s;
    } else {
      el.className = 'pipeline-step';
      el.querySelector('.step-circle').textContent = s;
    }
  });
}

function initDropZone() {
  const dropZone = document.getElementById('dropZone');
  const fileInput = document.getElementById('fileInput');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-over');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files[0]) selectFile(e.target.files[0]);
  });
}

function selectFile(file) {
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  const supported = ['.pdf', '.docx', '.doc', '.txt', '.pptx', '.csv', '.md', '.rtf'];
  if (!supported.includes(ext)) {
    showIngestStatus(`Unsupported file type: ${ext}. Supported: ${supported.join(', ')}`, 'error');
    return;
  }

  selectedFile = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileSize').textContent = formatSize(file.size);
  document.getElementById('fileCard').classList.remove('hidden');
  hideIngestStatus();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

async function startIngestion() {
  if (!selectedFile) return;

  const submitBtn = document.getElementById('submitBtn');
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Processing...';

  updatePipelineStep(1, 'active');
  showIngestStatus('Uploading document...', 'info');

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);

    const res = await fetch(`${BACKEND_URL()}/ingest`, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || err.detail || 'Upload failed');
    }

    const data = await res.json();
    currentJobId = data.job_id;

    updatePipelineStep(1, 'done');
    showIngestStatus('File uploaded. Processing started...', 'info');

    // Start polling
    startPolling();

  } catch (err) {
    showIngestStatus(`Upload failed: ${err.message}`, 'error');
    updatePipelineStep(1, 'error');
    submitBtn.disabled = false;
    submitBtn.textContent = 'Generate Video';
  }
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(pollJobStatus, 2000);
}

async function pollJobStatus() {
  if (!currentJobId) return;

  try {
    const res = await fetch(`${BACKEND_URL()}/job/${currentJobId}`);
    if (!res.ok) return;

    const job = await res.json();

    // Map stage to UI step number
    const stageMap = {
      uploaded: 1,
      extracting: 1,
      text_extracted: 2,
      generating_script: 2,
      script_ready: 3,
      submitting_video: 4,
      rendering: 4,
      completed: 4,
      failed: 0,
    };

    const step = stageMap[job.stage] || 1;

    if (job.stage === 'completed') {
      clearInterval(pollInterval);
      pollInterval = null;
      updatePipelineStep(4, 'done');
      showIngestStatus('Video generated successfully!', 'success');
      showResult(job);
    } else if (job.stage === 'failed') {
      clearInterval(pollInterval);
      pollInterval = null;
      updatePipelineStep(step || 1, 'error');
      showIngestStatus(`Pipeline failed: ${job.error || 'Unknown error'}`, 'error');
      document.getElementById('submitBtn').disabled = false;
      document.getElementById('submitBtn').textContent = 'Retry';
    } else if (job.stage === 'text_extracted') {
      clearInterval(pollInterval);
      pollInterval = null;
      updatePipelineStep(2, 'active');
      showIngestStatus('Text extracted. Please customize your AI prompt.', 'success');

      const promptSection = document.getElementById('promptSection');
      if (promptSection && !promptSection.classList.contains('shown')) {
        // Hide Step 1
        document.getElementById('uploadSection').classList.add('hidden');

        document.getElementById('contentPreview').textContent = job.extracted_text || '(No text extracted)';
        promptSection.classList.remove('hidden');
        promptSection.classList.add('shown');
      }
    } else if (job.stage === 'script_ready') {
      clearInterval(pollInterval);
      pollInterval = null;
      updatePipelineStep(3, 'active');
      showIngestStatus('Script generated! Please review it below.', 'success');

      const scriptSection = document.getElementById('scriptSection');
      if (!scriptSection.classList.contains('shown')) {
        // Hide Step 2
        document.getElementById('promptSection').classList.add('hidden');

        document.getElementById('scriptPreview').value = job.script;
        scriptSection.classList.remove('hidden');
        scriptSection.classList.add('shown');
      }
    } else {
      updatePipelineStep(step, 'active');
      showIngestStatus(job.message || 'Processing...', 'info');
    }

    // Show script as soon as available during extracting/generating
    if (job.script && job.stage !== 'script_ready') {
      const scriptSection = document.getElementById('scriptSection');
      if (!scriptSection.classList.contains('shown')) {
        document.getElementById('scriptPreview').value = job.script;
        scriptSection.classList.remove('hidden');
        scriptSection.classList.add('shown');
      }
    }

  } catch (err) {
    console.error('Poll error:', err);
  }
}

async function submitPromptToScript() {
  if (!currentJobId) return;

  const promptText = document.getElementById('promptInput').value.trim();
  const btn = document.getElementById('generateScriptBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Generating...';

  updatePipelineStep(2, 'done');
  updatePipelineStep(3, 'active');
  showIngestStatus('AI is generating the script...', 'info');

  try {
    const res = await fetch(`${BACKEND_URL()}/job/${currentJobId}/generate_script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptText })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || 'Generation failed');
    }

    // Hide UI part
    document.getElementById('promptSection').classList.add('hidden');
    document.getElementById('promptInput').disabled = true;

    startPolling();

  } catch (err) {
    showIngestStatus(`Script generation failed: ${err.message}`, 'error');
    updatePipelineStep(2, 'error');
    btn.disabled = false;
    btn.textContent = 'Generate API Script';
  }
}

async function submitScriptToVideo() {
  if (!currentJobId) return;

  const scriptText = document.getElementById('scriptPreview').value.trim();
  if (!scriptText) {
    showIngestStatus('Script cannot be empty.', 'error');
    return;
  }

  const btn = document.getElementById('scriptSubmitBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Submitting...';

  // Also disable the main textarea
  document.getElementById('scriptPreview').disabled = true;

  updatePipelineStep(3, 'done');
  updatePipelineStep(4, 'active');
  showIngestStatus('Submitting edited script to HeyGen...', 'info');

  try {
    const res = await fetch(`${BACKEND_URL()}/job/${currentJobId}/generate_video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script: scriptText })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(err.error || 'Submit failed');
    }

    startPolling();

  } catch (err) {
    showIngestStatus(`Video generation failed: ${err.message}`, 'error');
    updatePipelineStep(4, 'error');
    btn.disabled = false;
    btn.textContent = 'Generate Video from Script';
    document.getElementById('scriptPreview').disabled = false;
  }
}

function showResult(job) {
  const videoSection = document.getElementById('videoSection');
  videoSection.classList.remove('hidden');

  if (job.video_url) {
    const wrapper = document.getElementById('videoWrapper');
    const videoUrl = `${BACKEND_URL()}${job.video_url}`;
    wrapper.innerHTML = `<video controls autoplay src="${videoUrl}"></video>`;

    const dlBtn = document.getElementById('downloadBtn');
    dlBtn.href = videoUrl;
    dlBtn.classList.remove('hidden');
  }

  // Hide upload section
  document.getElementById('uploadSection').classList.add('hidden');
}

function resetPipeline() {
  selectedFile = null;
  currentJobId = null;
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = null;

  document.getElementById('fileCard').classList.add('hidden');
  document.getElementById('fileInput').value = '';
  document.getElementById('promptSection').classList.add('hidden');
  document.getElementById('promptSection').classList.remove('shown');
  document.getElementById('promptInput').disabled = false;

  const generateScriptBtn = document.getElementById('generateScriptBtn');
  if (generateScriptBtn) {
    generateScriptBtn.disabled = false;
    generateScriptBtn.textContent = 'Generate API Script';
  }

  document.getElementById('scriptSection').classList.add('hidden');
  document.getElementById('scriptSection').classList.remove('shown');
  document.getElementById('scriptPreview').value = '';
  document.getElementById('scriptPreview').disabled = false;

  const scriptSubmitBtn = document.getElementById('scriptSubmitBtn');
  if (scriptSubmitBtn) {
    scriptSubmitBtn.disabled = false;
    scriptSubmitBtn.textContent = 'Generate Video from Script';
  }

  document.getElementById('videoSection').classList.add('hidden');
  document.getElementById('uploadSection').classList.remove('hidden');
  document.getElementById('downloadBtn').classList.add('hidden');
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('submitBtn').textContent = 'Generate Video';

  hideIngestStatus();

  // Reset pipeline steps
  document.querySelectorAll('.pipeline-step').forEach(el => {
    el.className = 'pipeline-step';
    el.querySelector('.step-circle').textContent = el.dataset.step;
  });
}

// Expose for onclick
window.startIngestion = startIngestion;
window.resetPipeline = resetPipeline;
window.submitPromptToScript = submitPromptToScript;
window.submitScriptToVideo = submitScriptToVideo;


// ═══════════════════════════════════════════════════════════════════════════════
//  LIVE AVATAR STREAMING (existing code, preserved)
// ═══════════════════════════════════════════════════════════════════════════════

let avatar = null;
let selectedAvatarId = null;
let sessionActive = false;
let stopTimeout = null;

function showStatus(message, type = 'info') {
  const status = document.getElementById('status');
  if (status) {
    status.className = `${type}`;
    status.textContent = message;
  }
  console.log(`[${type.toUpperCase()}]`, message);
}

async function loadAvatars() {
  const container = document.getElementById('avatars');
  container.innerHTML = '<div style="padding:12px;color:var(--text-muted);">Loading Interactive Avatars...</div>';
  showStatus('Loading Interactive Avatars...', 'info');

  try {
    const response = await fetch(`${BACKEND_URL()}/interactive_avatars`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const result = await response.json();
    let avatars = result.data?.avatars || result.data?.data?.avatars || result.data || result.avatars || result || [];
    if (!Array.isArray(avatars)) avatars = [];

    if (avatars.length === 0) {
      container.innerHTML = '<div style="padding:16px;text-align:center;color:var(--warning);">No Interactive Avatars found. Check your HeyGen account.</div>';
      showStatus('No Interactive Avatars found.', 'warning');
      return;
    }

    container.innerHTML = '';
    avatars.forEach(av => {
      const avatarId = av.avatar_id || av.avatarName || av.name || av.id;
      const avatarName = av.name || av.avatarName || av.avatar_id || avatarId;
      if (!avatarId) return;

      const card = document.createElement('div');
      card.className = 'card';
      card.addEventListener('click', () => selectAvatar(avatarId, card));
      card.innerHTML = `
        <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${avatarName}</div>
        <div style="font-size:11px;color:var(--text-dim);word-break:break-all;">${avatarId}</div>
        <div style="font-size:11px;color:var(--success);margin-top:6px;font-weight:600;">Interactive Avatar</div>
      `;
      container.appendChild(card);
    });

    showStatus(`Loaded ${avatars.length} Interactive Avatars`, 'success');
  } catch (error) {
    showStatus(`Error: ${error.message}`, 'error');
    container.innerHTML = '';
  }
}

function selectAvatar(avatarId, cardElement) {
  selectedAvatarId = avatarId;
  document.querySelectorAll('#avatars .card').forEach(c => c.classList.remove('selected'));
  cardElement.classList.add('selected');
  document.getElementById('startBtn').disabled = false;
  showStatus(`Avatar selected: ${avatarId}`, 'success');
}

async function getStreamingToken() {
  showStatus('Getting streaming token...', 'info');
  const response = await fetch(`${BACKEND_URL()}/streaming_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || 'Failed to get streaming token');
  }

  const result = await response.json();
  const token = result.data?.token || result.data?.data?.token || result.token || result.access_token;
  if (!token) throw new Error('Token not found in response');
  return token;
}

async function startSession() {
  if (!selectedAvatarId) { showStatus('Please select an avatar first', 'error'); return; }
  if (sessionActive) { showStatus('Session already active.', 'warning'); return; }

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const speakBtn = document.getElementById('speakBtn');

  startBtn.disabled = true;
  showStatus('Initializing session...', 'info');

  try {
    const token = await getStreamingToken();
    showStatus('Creating avatar session...', 'info');

    const videoContainer = document.getElementById('videoContainer');
    videoContainer.className = 'stream-video-container';
    videoContainer.innerHTML = '<div style="color:var(--text-muted)">Connecting to avatar...</div>';

    avatar = new StreamingAvatarApi(
      new Configuration({
        accessToken: token,
        apiKey: () => token,
      })
    );

    const sessionRequest = {
      newSessionRequest: { quality: "low", avatarName: selectedAvatarId },
    };

    await avatar.createStartAvatar(sessionRequest);

    showStatus('Waiting for stream...', 'info');
    let streamCheckInterval = setInterval(() => {
      if (avatar.mediaStream) {
        clearInterval(streamCheckInterval);
        const video = document.createElement('video');
        video.id = 'avatarVideo';
        video.autoplay = true;
        video.playsInline = true;
        video.controls = false;
        video.srcObject = avatar.mediaStream;
        videoContainer.innerHTML = '';
        videoContainer.appendChild(video);
        showStatus('Stream ready! Avatar is live.', 'success');
      }
    }, 100);

    setTimeout(() => {
      clearInterval(streamCheckInterval);
      if (!avatar.mediaStream) {
        showStatus('Stream timeout. Please try again.', 'warning');
        stopSession();
      }
    }, 10000);

    sessionActive = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    speakBtn.disabled = false;
    showStatus('Session started!', 'success');

    if (stopTimeout) clearTimeout(stopTimeout);
    stopTimeout = setTimeout(() => {
      if (sessionActive) {
        showStatus('3 minute limit reached. Stopping...', 'warning');
        stopSession();
      }
    }, 180000);

  } catch (error) {
    console.error('Start session error:', error);
    showStatus(`Error: ${error.message}`, 'error');
    startBtn.disabled = false;
    sessionActive = false;
    if (avatar && avatar.peerConnection) {
      try { avatar.peerConnection.close(); } catch (e) { }
    }
    avatar = null;
    const videoContainer = document.getElementById('videoContainer');
    videoContainer.className = 'stream-video-container placeholder';
    videoContainer.innerHTML = '<div>Error starting session. Please try again.</div>';
  }
}

async function stopSession() {
  if (!sessionActive || !avatar) return;

  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const speakBtn = document.getElementById('speakBtn');

  showStatus('Stopping session...', 'info');

  try {
    if (stopTimeout) { clearTimeout(stopTimeout); stopTimeout = null; }
    if (avatar && typeof avatar.stopAvatar === 'function') {
      try { await avatar.stopAvatar({ stopSessionRequest: { sessionId: avatar.sessionId } }); } catch (e) { }
    }
    if (avatar && avatar.peerConnection) avatar.peerConnection.close();

    const videoElement = document.getElementById('avatarVideo');
    if (videoElement && videoElement.srcObject) {
      videoElement.srcObject.getTracks().forEach(t => t.stop());
      videoElement.srcObject = null;
    }

    avatar = null;
    sessionActive = false;
    startBtn.disabled = false;
    stopBtn.disabled = true;
    speakBtn.disabled = true;

    const videoContainer = document.getElementById('videoContainer');
    videoContainer.className = 'stream-video-container placeholder';
    videoContainer.innerHTML = '<div>Video stream will appear here when session starts</div>';
    showStatus('Session stopped.', 'success');
  } catch (error) {
    showStatus(`Error stopping: ${error.message}`, 'error');
  }
}

async function sendSpeak() {
  if (!sessionActive || !avatar) { showStatus('Start a session first', 'warning'); return; }

  const input = document.getElementById('textInput').value.trim();
  if (!input) { showStatus('Please enter a question', 'error'); return; }

  const speakBtn = document.getElementById('speakBtn');
  speakBtn.disabled = true;
  speakBtn.textContent = 'Getting answer...';
  showStatus('Calling RAG API...', 'info');
  document.getElementById('answerSection').classList.add('hidden');

  try {
    const ragResponse = await fetch(`${BACKEND_URL()}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    });

    const ragResult = await ragResponse.json();
    if (!ragResponse.ok) throw new Error(ragResult.error || 'RAG API call failed');

    const answerText = ragResult.message || ragResult.data?.message || 'No answer received';

    document.getElementById('answerText').textContent = answerText;
    document.getElementById('answerSection').classList.remove('hidden');
    showStatus('Got answer! Speaking to avatar...', 'success');

    speakBtn.textContent = 'Speaking...';

    let textToSpeak = answerText;
    if (textToSpeak.length > 300) {
      textToSpeak = textToSpeak.substring(0, 300) + '...';
    }

    const sessionId = avatar.sessionId;
    if (!sessionId) throw new Error('Session ID not found. Restart session.');

    await avatar.speak({ taskRequest: { text: textToSpeak, sessionId } });
    showStatus('Avatar is speaking...', 'success');
    speakBtn.disabled = false;
    speakBtn.textContent = 'Get Answer & Speak';
    document.getElementById('textInput').value = '';
  } catch (error) {
    console.error('Error:', error);
    showStatus(`Error: ${error.message}`, 'error');
    speakBtn.disabled = false;
    speakBtn.textContent = 'Get Answer & Speak';
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // Tabs
  initTabs();

  // Ingestion pipeline
  initDropZone();

  // Streaming controls
  const loadBtn = document.getElementById('loadAvatarsBtn');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const speakBtn = document.getElementById('speakBtn');

  if (loadBtn) loadBtn.addEventListener('click', loadAvatars);
  if (startBtn) startBtn.addEventListener('click', startSession);
  if (stopBtn) stopBtn.addEventListener('click', stopSession);
  if (speakBtn) speakBtn.addEventListener('click', sendSpeak);

  console.log('App initialized. Backend:', BACKEND_URL());
});

// Export for debugging
window.app = {
  loadAvatars, startSession, stopSession, sendSpeak, selectAvatar,
  startIngestion, resetPipeline,
  get avatar() { return avatar; },
  get selectedAvatarId() { return selectedAvatarId; },
  get sessionActive() { return sessionActive; },
  get currentJobId() { return currentJobId; },
};
