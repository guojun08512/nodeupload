const { createUploadWorker, checkIsUploaded } = require('./uploadworker');

module.exports.createUploader = function createUploader(fileProvider, checkpoint, callbacks, options) {
  const opts = {
    maxRetry: 3,
    timeout: 30 * 1000,

    useMultiProcess: true,

    workerCountLimit: 1,

    useBatch: true,
    batchCountLimit: 10,
    batchSizeLimit: 5 * 1024 * 1024,

    useMultipart: true,
    multipartSizeLimit: 20 * 1024 * 1024,

    apiVersion: 2,

    ...(options || {}),
  };

  if (!opts.serverUri) {
    throw new Error('server uri is not provided');
  }

  if (!opts.token || !opts.batchToken) {
    throw new Error('no token provided');
  }

  if(!fileProvider.getFileCount) {
    throw new Error('getFileCount is not provided in fileProvider')
  }

  if(!fileProvider.getFileInfo) {
    throw new Error('getFileInfo is not provided in fileProvider')
  }

  const fileCount = fileProvider.getFileCount();
  if (fileCount <= 0) {
    throw new Error('illegeal file count');
  }

  const workers_cp = (function makeCheckPoints() {
    let ret = [];
    const workerCount = Math.min(fileCount, opts.workerCountLimit);
    const filesPerBatch = Math.floor(fileCount / workerCount);
    if (!checkpoint) {
      for (let i = 0; i < workerCount; ++i) {
        ret.push({
          nextIndex: filesPerBatch * i,
          multipart: null,
          startIndex: filesPerBatch * i,
          endIndex: (i === workerCount - 1) ? fileCount : (filesPerBatch * (i + 1)),
          hashMismatch: [],
          uploaded: [],
          uploadCompleteSize: 0,
          speed: 0,
        });
      }
    } else {
      ret = checkpoint.workers_cp;
      if (!ret || ret.length != workerCount) {
        throw new Error('illegeal checkpoint');
      }
    }
    return ret;
  })();

  const listener = (function makeListener() {
    if (!callbacks || !callbacks.onProgress || !callbacks.onError || !callbacks.onFinished) {
      throw Error('callbacks is not provided');
    }
    let errorCount = 0;
    let lastProgressTimeMS = 0;
    let lastProgressValue = 0;
    return {
      notifyStarted: () => {
        if (callbacks.onStarted) {
          setTimeout(callbacks.onStarted, 0);
        }
      },
      notifyPaused: () => {
        if (callbacks.onPaused) {
          setTimeout(callbacks.onPaused, 0);
        }
      },
      notifyCanceled: () => {
        if (callbacks.onFinished) {
          setTimeout(callbacks.onCanceled, 0);
        }
      },
      notifyFinished: () => {
        setTimeout(callbacks.onFinished, 0);
      },
      notifyError: (err) => {
        setTimeout(() => callbacks.onError(err), 0);
        errorCount++;
      },
      notifyProgress: (workerId, state) => {
        workers_cp[workerId] = state;
        // mininal interval 500 ms
        const now = Date.now();
        if (now - lastProgressTimeMS > 500) {
          lastProgressTimeMS = now;
          let uploadCount = 0;
          let speed = 0;
          for (let i = workers.length - 1; i >= 0; i--) {
            const cp = workers_cp[i];
            uploadCount += cp.nextIndex - cp.hashMismatch.length;
            speed += cp.speed;
          }
          const progress = Math.max(uploadCount / fileCount, lastProgressValue);
          lastProgressValue = progress;
          setTimeout(() => callbacks.onProgress(progress, { workers_cp }), 0);
        }
      },
    };
  })();
  const workers = workers_cp.map((cp, index) => createUploadWorker(index, fileProvider, cp, listener, opts));

  let canceled = false;
  return {
    start: () => {
      if (canceled) {
        console.error('uploader.start() is called after canceled.');
        return;
      }
      for (let i = workers.length - 1; i >= 0; i--) {
        workers[i].start();
      }
      listener.notifyStarted();
    },
    pause: () => {
      if (canceled) {
        console.error('uploader.pause() is called after canceled.');
        return;
      }
      for (let i = workers.length - 1; i >= 0; i--) {
        workers[i].pause();
      }
      listener.notifyPaused();
    },
    cancel: () => {
      if (canceled) {
        console.error('uploader.cancel() is called after canceled.');
        return;
      }
      for (let i = workers.length - 1; i >= 0; i--) {
        workers[i].cancel();
      }
      listener.notifyCanceled();
    },
  };
}
