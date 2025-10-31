const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const audioList = document.getElementById('audioList');
const combineBtn = document.getElementById('combineBtn');

const audioFiles = [];

// --- File Handling ---
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('bg-blue-50');
});
dropzone.addEventListener('dragleave', () => {
  dropzone.classList.remove('bg-blue-50');
});
dropzone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropzone.classList.remove('bg-blue-50');

  clearStatusError();

  const items = e.dataTransfer.items;

  if (items) {
    const files = await getFilesFromDataTransferItems(items);
    handleFiles(files);
  }
});

fileInput.addEventListener('change', () => {
  const files = Array.from(fileInput.files)
    .filter(file => file.type === 'audio/mpeg')
    .sort((a, b) => a.name.localeCompare(b.name));
  handleFiles(files);
});


async function getFilesFromDataTransferItems(items) {
  const files = [];

  const traverseEntry = async (entry) => {
    if (entry.isFile) {
      await new Promise((resolve) => {
        entry.file((file) => {
          if (file.type === 'audio/mpeg') files.push(file);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const entries = await new Promise((resolve) => reader.readEntries(resolve));
      for (const ent of entries) {
        await traverseEntry(ent);
      }
    }
  };

  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) {
      await traverseEntry(entry);
    }
  }

  return files.sort((a, b) => a.name.localeCompare(b.name));
}

function handleFiles(files) {
  for (const file of files) {
    if (file.type === 'audio/mpeg') {
      addAudioElement(file);
    }
  }
}

function addAudioElement(file) {
  updateCompileButtonState() //disable button until mp3 files added

  const container = document.createElement('div');
  container.className = 'bg-white p-4 rounded shadow mb-4';

  const label = document.createElement('p');
  label.textContent = file.name;
  label.className = 'font-semibold mb-2 truncate';

  const audio = document.createElement('audio');
  audio.controls = true;
  audio.className = 'w-full';
  audio.src = URL.createObjectURL(file);

  container.appendChild(label);
  container.appendChild(audio);
  audioList.appendChild(container);

  audioFiles.push(file);
}

// --- Audio Compilation ---

async function decodeAndExtractFull(audioCtx, file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const arrayBuffer = reader.result;
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        resolve(audioBuffer);
      } catch (e) {
        reject(e);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function concatAudioBuffers(audioCtx, buffers) {
  if (buffers.length === 0) return null;

  // Force stereo (2 channels)
  const numberOfChannels = 2;
  const sampleRate = buffers[0].sampleRate;
  let totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);

  const outputBuffer = audioCtx.createBuffer(numberOfChannels, totalLength, sampleRate);
  let offset = 0;

  for (const buffer of buffers) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = outputBuffer.getChannelData(ch);

      if (ch < buffer.numberOfChannels) {
        // Copy actual channel
        channelData.set(buffer.getChannelData(ch), offset);
      } else {
        // If missing channel (mono → stereo), duplicate channel 0
        channelData.set(buffer.getChannelData(0), offset);
      }
    }
    offset += buffer.length;
  }

  return outputBuffer;
}


function encodeWAV(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const numFrames = audioBuffer.length;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + numFrames * blockAlign);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * blockAlign, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, numFrames * blockAlign, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = audioBuffer.getChannelData(ch)[i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([view], { type: 'audio/wav' });
}

// updateCompileButtonState();
function updateCompileButtonState() {
  combineBtn.disabled = audioFiles.length === 0;
}


function createStatusElement(text) {
  const existing = document.querySelector('.compile-status');
  if (existing) existing.remove();

  const status = document.createElement('p');
  status.classList.remove("hidden");
  status.className = 'mb-7 mr-0 px-6 py-3 text-center text-sm text-gray-600 compile-status';
  status.textContent = text;

  combineBtn.insertAdjacentElement('afterend', status);
  return status;
}

function clearDownloadLinks() {
  document.querySelectorAll('a.download-link').forEach(el => el.remove());
}

function clearStatusError() {
  const status = document.querySelector('.compile-status');
  if (status) status.remove();
}


// Clear status error if mp3s added
fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) clearStatusError();
});



combineBtn.addEventListener('click', async () => {
  combineBtn.disabled = true;
  combineBtn.textContent = 'Compiling...';

  const status = createStatusElement('Preparing...');
  clearDownloadLinks();

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    combineBtn.classList.add("hidden");

    status.textContent = 'Decoding files...';

    const buffers = [];
    const timestamps = [];
    let cumulativeSeconds = 0;

    const monoTracks = [];

    for (const file of audioFiles) {
      const buffer = await decodeAndExtractFull(audioCtx, file);
      buffers.push(buffer);

      // check for mono tracks
       if (buffer.numberOfChannels === 1) {
         monoTracks.push(file.name);
       }

      const minutes = String(Math.floor(cumulativeSeconds / 60)).padStart(2, '0');
      const seconds = String(Math.floor(cumulativeSeconds % 60)).padStart(2, '0');
      
      // timestamps.push(`${minutes}:${seconds} - ${file.name}`);
      const nameCleaned = file.name
      .replace(/^\d+\s*[-_.]?\s*/i, '') // remove leading track number/separator
      .replace(/\.mp3$/i, ''); // remove .mp3 extension (case-insensitive)

      timestamps.push(`${minutes}:${seconds} - ${nameCleaned}`);

      cumulativeSeconds += buffer.duration;
    }

    status.textContent = 'Merging audio...';
    const finalBuffer = concatAudioBuffers(audioCtx, buffers);
    if (!finalBuffer) throw new Error('No audio to compile.');

    const wavBlob = encodeWAV(finalBuffer);
    const wavUrl = URL.createObjectURL(wavBlob);

    const timestampBlob = new Blob([timestamps.join('\n')], { type: 'text/plain' });
    const timestampUrl = URL.createObjectURL(timestampBlob);

    status.textContent = 'Done! Compiled audio is ready.';

    // Create mono warning if needed
    let warning = null;
    if (monoTracks.length > 0) {
      warning = document.createElement('p');
      warning.className = 'mt-2 text-sm text-green-600';
      warning.textContent = `Note: The following tracks were mono and upmixed to stereo: ${monoTracks.join(', ')}`;
}

    // Always hide the "Done!" status
    status.classList.add("hidden");

    // Wrapper for buttons
    const wrapper = document.createElement('div');
    wrapper.className = 'flex flex-col gap-2 download-link-wrapper';

    // Insert warning above buttons if present
    if (warning) {
      wrapper.appendChild(warning);
    }

    // Download audio button
    const audioBtn = document.createElement('a');
    audioBtn.href = wavUrl;
    audioBtn.download = 'mp3-glue.wav';
    audioBtn.textContent = 'Download Compiled Audio';
    audioBtn.className = 'mb-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition download-link text-center';

    // Download timestamps button
    const timestampBtn = document.createElement('a');
    timestampBtn.href = timestampUrl;
    timestampBtn.download = 'timestamps.txt';
    timestampBtn.textContent = 'Download Timestamps';
    timestampBtn.className = 'mb-7 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition download-link text-center';

    // Append buttons after warning (if any)
    wrapper.appendChild(audioBtn);
    wrapper.appendChild(timestampBtn);

    // Insert everything below the combine button
    combineBtn.insertAdjacentElement('afterend', wrapper);
    combineBtn.disabled = true;


  } catch (e) {
    alert('Error: ' + e.message);
    status.textContent = 'Error: ' + e.message;
    status.classList.add('text-red-600');
    combineBtn.disabled = false;
    combineBtn.textContent = 'Combine all files';
  }
});





// CLEAR ALL BUTTON
const clearBtn = document.getElementById('clearBtn');

clearBtn.addEventListener('click', () => {
  // Clear file list
  audioFiles.length = 0;

  // Clear audio elements
  audioList.innerHTML = '';

  // Reset compile button
  // updateCompileButtonState();
  combineBtn.disabled = true;
  combineBtn.classList.remove("hidden");
  combineBtn.textContent = 'Combine all files';

  // Clear any compile status messages
  const status = document.querySelector('.compile-status');
  if (status) status.remove();

  // Remove download link + wrapper if present
  const downloadWrapper = document.querySelector('.download-link-wrapper');
  if (downloadWrapper) downloadWrapper.remove();

  // Clear individual download links if any were added separately
  document.querySelectorAll('a.download-link').forEach(el => el.remove());

  // Reset file input (optional if user might reupload same files)
  fileInput.value = '';
});
