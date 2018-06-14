
import fs from 'fs';
import path from 'path';
import request from 'request-promise';
import _ from 'lodash';
import * as Util from './util';

const defaultTimeout = 30 * 1000;

export default class DownloadClient {
  constructor(token, timeout) {
    this.token = token;
    this.timeout = timeout || defaultTimeout;
    this.downFiles = [];
    this.downError = [];
  }
}

const proto = DownloadClient.prototype;

proto.getCompleteFiles = function getCompleteFiles() {
  return this.downFiles;
};

proto.getErrorFiles = function getErrorFiles() {
  return this.downError;
};

proto.downloadlist = async function downloadlist(filelist, options) {
  let fileListInfo = await Promise.all(filelist.map(file => this.getFileInfo(file.fileId, options.route, file.prefix)));
  fileListInfo = _.uniqBy(fileListInfo, 'name');
  const localpath = options.localpath;
  return Promise.all(fileListInfo.map(fileInfo => this.download(fileInfo, localpath)));
};

proto.getFileInfo = async function getFileInfo(fileId, route, prefix) {
  const url = `${route}/${fileId}/url`;
  const timeout = this.timeout;
  const completeRes = await request.get({
    uri: url,
    headers: {
      Authorization: `Bearer ${this.token}`,
    },
    json: true,
    timeout,
  });
  if (!completeRes || completeRes.code !== 200) {
    throw new Error('server response error!!');
  }
  return { ...completeRes.data.fileInfo, prefix };
};

proto.download = async function download(fileInfo, localpath) {
  try {
    const filePath = path.join(localpath, fileInfo.prefix || '', fileInfo.name);
    const timeout = this.timeout;
    await new Promise((resolve, reject) => {
      const headers = {
        // Range: `bytes=${start}-`,
        'content-type': 'application/octet-stream',
      };
      const req = request.get({ uri: fileInfo.url, headers, timeout });
      req.encoding = null;
      req
        .on('error', (err) => {
          reject(err);
        })
        .on('complete', (response) => {
          if (response && (response.statusCode === 200 || response.statusCode === 206)) {
            resolve(response);
          } else {
            reject(new Error(`(${response.statusCode})download file failed!`));
          }
        })
        .pipe(fs.createWriteStream(filePath));
    });
    const md5 = await Util.calcMD5(filePath);
    if (md5 !== fileInfo.etag) {
      throw new Error(`${filePath} md5 is dismatch!!`);
    }
    this.downFiles.push(fileInfo.fileId);
  } catch (err) {
    this.downError.push({ fileId: fileInfo.fileId, error: err });
  }
  return fileInfo;
};
