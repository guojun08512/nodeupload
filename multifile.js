
import fs from 'fs';
// import uid from 'uid';
import UploadClient from './mutilpart';
import TaskManager from './taskmanager';

export default class MultiFileClient {
  constructor(token, route, timeout) {
    this.uploadClient = new UploadClient(token, route, timeout);
    this.isPause = false;
    this.checkpoint = null;
    this.error = null;
    this.progress = 0;
    this.parseSuccess = false;
    this.isresume = false;
  }
}

const proto = MultiFileClient.prototype;

proto.multifileUpload = async function multifileUpload(fileList, checkpoint, options) {
  this.isresume = options.isresume;
  if (fileList.length <= 0) {
    throw new Error(`fileList size == ${fileList.length}, check your folder!!`);
  }
  if (checkpoint) {
    this.checkpoint = checkpoint;
    this.resumeMultifile(fileList, options);
  } else {
    this.checkpoint = {
      allFilesSize: 0,
      doneFiles: [],
      allDoneSize: 0,
      uploadAllTime: 0,
      fileCheckout: [],
      filesStatus: [],
    };
    Promise.all([this.resumeMultifile(fileList, options), this.calcFilelistSize(fileList)]);
  }
};

proto.resumeMultifile = async function resumeMultifile(fileList, options) {
  const upLoadFiles = this.checkpoint.doneFiles.map(p => p.file);
  const unUploadFiles = fileList.filter(p => upLoadFiles.indexOf(p) < 0);
  const taskManager = new TaskManager(this, fileList, unUploadFiles, options);
  return taskManager.start();
};

proto.uploadfileJob = async function uploadfileJob(fileList, file, options) {
  await this.uploadfile(file, options);
  this.checkpoint.allDoneSize = this.getDoneFileSize(this.checkpoint.doneFiles);
  this.progress = this.checkpoint.doneFiles.length / fileList.length;
  return file;
};

proto.getDoneFileSize = function getDoneFileSize(doneFiles) {
  let allDoneSize = 0;
  doneFiles.map((done) => {
    allDoneSize += done.doneSize;
    return true;
  });
  return allDoneSize;
};

proto.getFileSize = function getFileSize(file) {
  const filestat = fs.statSync(file);
  return filestat.size;
};

proto.calcFilelistSize = function calcFilelistSize(fileList) {
  let allSize = 0;
  fileList.map((f) => {
    allSize += this.getFileSize(f);
    return true;
  });
  this.checkpoint.allFilesSize = allSize; // eslint-disable-line
};

proto.pauseUpload = async function pauseUpload(flag) {
  this.isPause = flag;
};

proto.uploadfile = async function uploadfile(file, options) {
  const uploadClient = this.uploadClient;
  const onProgress = async (progress, cp) => {
    // filesStatus 0: notstarted, 1: inprogress, 2: finished
    if (progress === 0) {
      this.checkpoint.filesStatus[file] = 0;
    } else if (progress === 1) {
      this.checkpoint.filesStatus[file] = 2;
    } else {
      this.checkpoint.filesStatus[file] = 1;
      this.checkpoint.fileCheckout[file] = cp;
    }
    // console.log(this.checkpoint.fileCheckout[file]);
  };
  const beginTime = new Date();
  const { completeResult, resMd5 } = await uploadClient.multipartUpload(file, this.checkpoint.fileCheckout[file], onProgress, options || {});
  if (!completeResult.data || !completeResult.data.fileInfo) {
    throw new Error(`server response error fileInfo is ${JSON.stringify(completeResult.data.fileInfo)}`);
  }
  if (!completeResult || completeResult.code !== 200) {
    throw new Error(completeResult.message);
  }
  const endTime = new Date() - beginTime;
  const fileInfo = completeResult.data.fileInfo;
  this.checkpoint.doneFiles.push({
    file,
    fileId: fileInfo.fileId,
    doneSize: fileInfo.size,
    doneTime: endTime,
    md5: resMd5,
  });
  this.checkpoint.uploadAllTime += endTime;
};

proto.listen = async function listen(listener) {
  const {
    onStarted, // upload开始后发出
    onError, // 发生错误时
    onPaused, // 暂停成功
    onResumed, // 续传成功
    onFinished, // 完成
    onProgress, // 进度
  } = listener;
  if (onStarted) {
    await onStarted(this.progress > 0);
  }
  if (onError) {
    await onError(this.error);
  }
  if (onPaused) {
    await onPaused(this.parseSuccess);
  }
  if (onResumed) {
    await onResumed(this.isresume);
  }
  if (onFinished) {
    await onFinished(this.progress === 1);
  }
  if (onProgress) {
    await onProgress(this.progress, this.checkpoint);
  }
};
