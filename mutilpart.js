
import fs from 'fs';
import path from 'path';
import request from 'request-promise';
import * as Util from './util';

const defaultTimeout = 30 * 1000;

export default class MultiPartClient {
  constructor(token, route, timeout) {
    this.token = token;
    this.route = route;
    this.pauseFile = false;
    this.timeout = timeout || defaultTimeout;
    this.fileCheckPoints = null;
    this.fileProgress = null;
    this.minPartSize = 30 * 1024 * 1024;
  }
}

const proto = MultiPartClient.prototype;

proto.multipartUpload = async function multipartUpload(file, checkpoint, onProgress, options) {
  let completeResult = null;
  let resMd5 = null;
  const md5Provider = options.md5Provider;
  if (checkpoint) {
    this.fileCheckPoints = checkpoint;
    completeResult = await this.resumeMultipart(onProgress);
    resMd5 = checkpoint.md5;
  } else {
    const fileSize = this.getFileSize(file);
    const { info, md5 } = await this.initMultipartUpload(file, md5Provider);
    // console.log(info);
    if (info && info.data.uploadInfo) {
      const url = info.data.uploadInfo.url;
      if (fileSize < this.minPartSize) {
        const stream = this.createStream(file, 0, fileSize);
        completeResult = await this.putStream(url, stream, md5);
      } else {
        this.fileCheckPoints = {
          url,
          file,
          fileSize,
          doneParts: [],
          md5,
        };
        completeResult = await this.resumeMultipart(onProgress);
      }
    } else if (info) {
      completeResult = info;
    }
    resMd5 = md5;
  }
  return {
    completeResult,
    resMd5,
  };
};

proto.pauseUpload = async function pauseUpload(flag) {
  this.pauseFile = flag;
};

proto.resumeMultipart = async function resumeMultipart(onProgress) {
  const {
    url,
    file,
    fileSize,
    doneParts,
    md5,
  } = this.fileCheckPoints;
  const partOffs = this.divideParts(fileSize, this.minPartSize);
  const numParts = partOffs.length;
  const uploadPartJob = async function uploadPartJob(self, partNo) {
    const pi = partOffs[partNo - 1];
    const size = pi.end - pi.start;
    const data = {
      stream: self.createStream(file, pi.start, pi.end),
      size,
    };
    const partMd5 = await self.uploadPart(url, partNo, data);
    doneParts.push({
      partNumber: partNo,
      size,
      etag: partMd5,
    });
    await onProgress(doneParts.length / numParts, self.fileCheckPoints);
  };
  const all = Array.from(new Array(numParts), (x, i) => i + 1);
  const done = doneParts.map(p => p.number);
  const todo = all.filter(p => done.indexOf(p) < 0);
  for (let i = 0; i < todo.length; i += 1) {
    console.log('this.pauseFile ===', this.pauseFile);
    if (this.pauseFile) {
      return this.checkpoint;
    }
    await uploadPartJob(this, todo[i]); // eslint-disable-line
  }
  const completeRes = await this.completeMultipartUpload(url, doneParts, md5);
  return completeRes;
};

proto.parseFiles = function parseFiles(filepath) {
  const absolutePath = path.resolve(filepath);
  if (!absolutePath) {
    throw new Error(`filepath: ${filepath} is error !!`);
  }
  const pathInfo = path.parse(filepath);
  return pathInfo.base;
};

proto.initMultipartUpload = async function initMultipartUpload(file, md5Provider) {
  const token = this.token;
  const route = this.route;
  let md5 = null;
  if (md5Provider) {
    md5 = await md5Provider(file);
  }
  if (!md5) {
    md5 = await Util.calcMD5(file);
  }

  const name = this.parseFiles(file);
  const timeout = this.timeout;
  const initRes = await request.post({
    uri: `${route}/files`,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-meta-content-md5': md5,
    },
    body: {
      name,
    },
    timeout,
    json: true,
  });

  if (!initRes || initRes.code !== 200) {
    throw new Error('initMultipartUpload response error!!');
  }
  return { info: initRes, md5 };
};

proto.uploadPart = async function uploadPart(url, partNo, data) {
  const { stream } = data;
  const token = this.token;
  const timeout = this.timeout;
  const partRes = await new Promise(async (resolve, reject) => {
    stream.pipe(request.put({
      uri: `${url}/${partNo}`,
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/octet-stream',
      },
      timeout,
    }, (err, response, body) => {
      if (err) {
        reject(err);
      }

      if (!response) {
        reject(new Error('response is null, check your connect!!'));
      }

      if (err || (response && response.statusCode !== 200)) {
        reject(new Error('uploadPart response error!!'));
      }
      if (response && response.statusCode === 200 && body && typeof body === 'string') {
        resolve(JSON.parse(body));
      } else if (response && response.statusCode === 200 && body && typeof body === 'object') {
        resolve(response.body);
      }
    }));
  });
  return partRes.data.etag;
};

proto.completeMultipartUpload = async function completeMultipartUpload(url, parts, md5) {
  parts.sort((a, b) => a.partNumber - b.partNumber);
  const token = this.token;
  const timeout = this.timeout;
  const completeRes = await request.post({
    uri: url,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-meta-content-md5': md5,
    },
    body: {
      parts,
    },
    timeout,
    json: true,
  });
  if (!completeRes || completeRes.code !== 200) {
    throw new Error('completeMultipartUpload response error!!');
  }
  return completeRes;
};

proto.getFileSize = function getFileSize(file) {
  const filestat = fs.statSync(file);
  return filestat.size;
};

proto.divideParts = function divideParts(fileSize, partSize) {
  const numParts = Math.ceil(fileSize / partSize);

  const partOffs = [];
  for (let i = 0; i < numParts; i += 1) {
    const start = partSize * i;
    const end = Math.min(start + partSize, fileSize);

    partOffs.push({
      start,
      end,
    });
  }

  return partOffs;
};

proto.createStream = function createStream(file, start, end) {
  const readStream = fs.createReadStream(file, {
    start,
    end: end > 0 ? (end - 1) : end,
  });
  return readStream;
};

proto.getPartSize = function getPartSize(fileSize) {
  const maxNumParts = 10 * 1000;
  const defaultPartSize = 30 * 1024 * 1024;

  return Math.max(
    Math.ceil(fileSize / maxNumParts),
    defaultPartSize,
  );
};

proto.putStream = async function putStream(url, stream, md5) {
  const token = this.token;
  const timeout = this.timeout;
  const uploadRes = await new Promise((resolve, reject) => {
    stream.pipe(request.put({
      uri: url,
      headers: {
        'content-type': 'application/octet-stream',
        Authorization: `Bearer ${token}`,
        'x-meta-content-md5': md5,
      },
      timeout,
    }, (err, response, body) => {
      if (err) {
        reject(err);
      }
      if (!response || (response && !response.statusCode)) {
        reject(new Error('response is null, check your connect!!'));
      }
      if (response && response.statusCode !== 200) {
        reject(new Error('putStream response error!!'));
      }
      if (response && response.statusCode === 200 && body && typeof body === 'string') {
        resolve(JSON.parse(body));
      } else if (response && response.statusCode === 200 && body && typeof body === 'object') {
        resolve(body);
      }
    }));
  });
  return uploadRes;
};
