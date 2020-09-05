const fs = require('fs');
const path = require('path');
const requestPromise = require('request-promise');
const { createUploader } = require('./uploader');

const createBatch = async (route, token) => {
  const fr = await requestPromise.post({
    uri: `${route}`,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    json: true,
  });
  if (fr.code !== 200) {
    throw new Error(fr.errMsg);
  }
  return fr.data.uploadBatch;
};

const readAllfile = (localpath, allfiles) => {
  const tmppath = localpath;
  const files = fs.statSync(localpath);
  if (files.isDirectory()) {
    const ffs = fs.readdirSync(tmppath);
    ffs.map((f) => {
      const fpath = path.join(tmppath, f);
      const ff = fs.statSync(fpath);
      if (ff.isDirectory()) {
        readAllfile(fpath, allfiles);
      } else {
        allfiles.push(fpath);
      }
      return true;
    });
  }
};

const getToken = async (route, username, password) => {
  const fr = await requestPromise.post({
    uri: `${route}`,
    body: {
      username,
      password,
    },
    json: true,
  });
  if (fr.code !== 200) {
    throw new Error(fr.errMsg);
  }
  return fr.data.token;
};

// loginUrl like: http://xxx:7001
// UploadUrl like: http://xxx:5000

module.exports.upload = async function upload(fileProvider, loginUrl, UploadUrl) {
  const token = await getToken(`${loginUrl}/v1/users/login`, 'jung', 'guojun08512');
  const batchToken = await createBatch(`${loginUrl}/v1/batch/`, token);
  let prog = 0;
  const callbacks = {
    onStarted: () => {
      console.log('onStart');
    },
    onPaused: () => {
      console.log('onPaused');
    },
    onCanceled: () => {
      console.log('onCanceled');
    },
    onFinished: () => {
      console.log('onFinished');
    },
    onError: (err) => {
      console.log('onError', err);
    },
    onProgress: (progress, checkpoint) => {
      if ((progress - prog) > 0.2) {
        prog = progress;
        console.log('onProgress', progress, checkpoint);
      }
    },
  }
  // fileProvider, batchInfo, checkpoint, callbacks, options
  const uploader = createUploader(fileProvider, null, callbacks, {
    serverUri: `${UploadUrl}/v2`,
    token,
    batchToken,
  });
  uploader.start();
};
