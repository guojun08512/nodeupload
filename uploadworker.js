const { loadFile, loadPart } = require('./fileloader');
const { sendRequest, sendPost } = require('./httprequest');
const _ = require('lodash');

// TODO: implement browser version
async function loadMultifiles(fileProvider, indices) {
  const buffers = [];
  var input = new Uint8Array();
  for (const fileIndex of indices) {
    buffers.push(await loadFile(fileProvider.getFileInfo(fileIndex).filepath));
  }
  return buffers;
}

async function doMultipartUpload(fileProvider, state, opts) {
  let { nextIndex, startIndex, endIndex, hashMismatch, multipart, uploaded, speed, uploadCompleteSize } = state;
  const startTime = new Date();
  if (!multipart) {
    multipart = { nextPartNo: 1 };
    if (hashMismatch.length > 0) {
      hashMismatch = hashMismatch.slice(0);
      multipart.fileIdx = hashMismatch.pop();
    } else if (nextIndex < endIndex) {
      multipart.fileIdx = nextIndex;
      nextIndex ++;
    } else {
      throw new Error('upload progress completed');
    }
  }
  const { fileIdx, nextPartNo } = multipart;

  if(uploaded.includes(fileIdx)) {
    state.nextIndex++;
    return state;
  }

  const partNo = nextPartNo;
  const start = (partNo - 1) * opts.multipartSizeLimit;
  const { size, md5, filename, filepath } = fileProvider.getFileInfo(fileIdx);
  if (start >= size) {
    return { nextIndex, startIndex, endIndex, hashMismatch, multipart: null, uploaded, speed };
  }
  const end = Math.min(partNo* opts.multipartSizeLimit, size);

  const req = {
    uri: `${opts.serverUri}/upload`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'content-type': 'application/octet-stream',
      'x-meta-content-batchtoken': opts.batchToken,
      'x-meta-content-md5': md5,
      'x-meta-content-size': size,
      'x-meta-content-partno': partNo,
      'x-meta-content-name': encodeURIComponent(filename),
      'x-meta-content-index': fileIdx,
      'ccrange': `bytes=${start}-${end}\/${size}`,
    },
    body: await loadPart(filepath, start, end),
  }
  // TODO: verify response
  await sendRequest(req);
  const usedTime = (new Date() - startTime) / 1000;
  const uploadSize = (end - start) / (1024 * 1024);
  speed = uploadSize / usedTime;
  uploadCompleteSize += (end - start);
  return { nextIndex, startIndex, endIndex, hashMismatch, multipart: { fileIdx, nextPartNo: partNo + 1 }, uploaded, speed, uploadCompleteSize };
}

async function doSingleFileUpload(fileProvider, state, opts) {
  let { nextIndex, startIndex, endIndex, hashMismatch, uploaded, speed, uploadCompleteSize } = state;
  const startTime = new Date();
  let fileIdx = null;
  if (hashMismatch.length > 0) {
    hashMismatch = hashMismatch.slice(0);
    fileIdx = hashMismatch.pop();
  } else if (nextIndex < endIndex) {
    fileIdx = nextIndex;
    nextIndex ++;
  }

  if(uploaded.includes(fileIdx)) {
    state.nextIndex++;
    return state;
  }

  if (fileIdx === null) {
    return state;
  }

  const { size, md5, filename } = fileProvider.getFileInfo(fileIdx);
  if (size > opts.multipartSizeLimit && opts.useMultipart) {
    return doMultipartUpload(fileProvider, state, opts);
  }

  const req = {
    uri: `${opts.serverUri}/upload`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'content-type': 'application/octet-stream',
      'x-meta-content-batchtoken': opts.batchToken,
      'x-meta-content-md5': md5,
      'x-meta-content-size': size,
      'x-meta-content-name': encodeURIComponent(filename),
      'x-meta-content-index': fileIdx,
    },
    body: await loadMultifiles(fileProvider, [fileIdx]),
  }

  // TODO: verify response
  await sendRequest(req);
  const usedTime = (new Date() - startTime) / 1000;
  const uploadSize = size / (1024 * 1024);
  speed = uploadSize / usedTime;
  uploadCompleteSize += size;
  return { nextIndex, startIndex, endIndex, hashMismatch, multipart: null, uploaded, speed, uploadCompleteSize };
}

async function doBatchUpload(fileProvider, state, opts) {
  const batchFileIndices = [];
  const startTime = new Date();
  let totalSize = 0;
  let { nextIndex, startIndex, endIndex, hashMismatch, uploaded, speed, uploadCompleteSize } = state;
  while (hashMismatch.length > 0 && batchFileIndices.length < opts.batchCountLimit) {
    hashMismatch = hashMismatch.slice(0);
    let idx = hashMismatch[hashMismatch.length - 1];
    const size = fileProvider.getFileInfo(idx).size;
    if (totalSize + size < opts.batchSizeLimit) {
      hashMismatch.pop();
      batchFileIndices.push(idx);
      totalSize += size;
    } else {
      break;
    }
  }

  for (let idx = nextIndex; idx < endIndex && batchFileIndices.length < opts.batchCountLimit; idx++) {
    if(uploaded.includes(idx)) {
      state.nextIndex++;
      continue;
    }
    const size = fileProvider.getFileInfo(idx).size;
    if (totalSize + size < opts.batchSizeLimit) {
      batchFileIndices.push(idx);
      nextIndex = idx + 1;
      totalSize += size;
    } else {
      break;
    }
  }

  if (batchFileIndices.length == 0) {
    return doSingleFileUpload(fileProvider, state, opts);
  }

  const req = {
    uri: `${opts.serverUri}/upload`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'content-type': 'application/octet-stream',
      'x-meta-content-batchtoken': opts.batchToken,
      'x-meta-content-md5': batchFileIndices.map((fileIdx) => fileProvider.getFileInfo(fileIdx).md5).join(';'),
      'x-meta-content-size': batchFileIndices.map((fileIdx) => fileProvider.getFileInfo(fileIdx).size).join(';'),
      'x-meta-content-name': encodeURIComponent(batchFileIndices.map((fileIdx) => fileProvider.getFileInfo(fileIdx).filename).join(';')),
      'x-meta-content-index': batchFileIndices.join(';'),
    },
    body: await loadMultifiles(fileProvider, batchFileIndices),
  }

  // TODO: verify response
  await sendRequest(req);
  const usedTime = (new Date() - startTime) / 1000;
  const uploadSize = totalSize / (1024 * 1024);
  speed = uploadSize / usedTime;
  uploadCompleteSize += totalSize;
  return { nextIndex, startIndex, endIndex, hashMismatch, multipart: null, uploaded, speed, uploadCompleteSize };
}

async function checkHashMismatch(state, opts) {
  // TODO: checkout file hash in range [startIndex, nextIndex)
  const req = {
    uri: `${opts.serverUri}/upload/checkmd5s`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'content-type': 'application/json',
      'x-meta-content-batchtoken': opts.batchToken,
    },
    body: {}
  };

  // TODO: verify response
  const data = (await sendPost(req)).data;
  const failedIds = data.failedIds;
  const needCheck = data.needCheck;
  let hashMismatch = [];
  if (failedIds.length > 0) {
    console.log('hashMismatch files ===>', failedIds.length);
    const ids = failedIds.map(id => parseInt(id));
    hashMismatch = state.hashMismatch.concat(ids.filter(v => !state.hashMismatch.includes(v)));
  }
  return { hashMismatch, needCheck };
}

async function checkIsUploaded(fileProvider, state, opts) {
  const indexes = Array.from(new Array(state.endIndex-state.nextIndex), (val, index)=>index+state.nextIndex);
  let fileList = indexes.map((index) => {
    const { filename, size, md5 } = fileProvider.getFileInfo(index);
    return {
      name: filename,
      index: index,
      fileSize: size,
      meta: `meta of index: ${index}`,
      hash: md5
    }
  });

  const req = {
    uri: `${opts.serverUri}/upload/checkfiles`,
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'x-meta-content-batchtoken': opts.batchToken,
    },
    body: {
      fileList,
    }
  };
  const data = (await sendPost(req)).data;
  console.log('exist files ===>', data.fileIds.length);
  if(data.fileIds.length > 0) {
    state.uploaded = data.fileIds;
  }
  return state;
}

module.exports.createUploadWorker = function createUploadWorker(workerId, fileProvider, state, { notifyError, notifyFinished, notifyProgress }, opts) {
  let isRunning = false;
  let isFinished = false;
  let runningPromise = null;
  let retry = opts.maxRetry;
  let hashMismatch = null;
  let needCheck = false;
  async function doUpload() {
    let lastHashMismatchCheckPoint = 0;
    const totalFilesCount = state.endIndex - state.startIndex;
    const startTime = Date.now();
    try {
      state = await checkIsUploaded(fileProvider, state, opts);
    } catch (e) {
      notifyError(e);
      return;
    }
    console.log(`checkIsUploaded cost time:  ${Date.now()-startTime} ms`)
    try {
      while (true) {
        if (state.multipart) {
          state = await doMultipartUpload(fileProvider, state, opts);
        } else if (opts.useBatch) {
          state = await doBatchUpload(fileProvider, state, opts);
        } else {
          state = await doSingleFileUpload(fileProvider, state, opts);
        }
        if (!isRunning) {
          break;
        }
        notifyProgress(workerId, state);

        if (!isRunning) {
          break;
        }
        if ((state.nextIndex - lastHashMismatchCheckPoint) / totalFilesCount > 0.2 || (state.nextIndex === state.endIndex && state.hashMismatch.length === 0) || needCheck) {
          if(retry === 0) {
            isRunning = false;
            notifyError(`upload still wrong after uploaded 3 times, wrong state: ${JSON.stringify(state)}, upload failed fileIdx: ${hashMismatch}`);
          }
          if (!isRunning) {
            break;
          }
          lastHashMismatchCheckPoint = state.nextIndex;

          const checkMd5Info = await checkHashMismatch(state, opts);
          needCheck = checkMd5Info.needCheck;
          hashMismatch = checkMd5Info.hashMismatch;
          if (hashMismatch.length !== 0 && _.isEqual(hashMismatch, state.hashMismatch) && !state.multipart) {
            retry--
          } else {
            retry = opts.maxRetry;
          }
          state.hashMismatch = hashMismatch;
          notifyProgress(workerId, state);

          if (!isRunning) {
            break;
          }
        }
        if ((state.nextIndex === state.endIndex && state.hashMismatch.length === 0 && !state.multipart && !needCheck) || state.startIndex === state.endIndex) {
          isRunning = false;
          isFinished = true;
          notifyFinished();
          break;
        }
      }
    } catch (e) {
      notifyError(e);
    }

    runningPromise = null;
  }

  return {
    start: () => {
      isRunning = true;
      if (runningPromise == null) {
        runningPromise = doUpload();
      }
    },
    pause: () => {
      isRunning = false;
    },
    cancel: () => {
      isRunning = false;
    },
  };
}
