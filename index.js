
import DownloadClient from './download';
import UploadClient from './multifile';

export default class Uploader {
  constructor(token, timeout) {
    this.uploader = new UploadClient(token, timeout);
  }

  start(fileList, options) {
    this.fileList = fileList;
    this.options = options;
    const isresume = false;
    return this.uploader.multifileUpload(fileList, null, { ...options, isresume });
  }

  pause(flag = true) {
    return this.uploader.pauseUpload(flag);
  }

  resume(checkpoint) {
    this.uploader.pauseUpload(false);
    const fileList = this.fileList;
    const options = this.options;
    const isresume = true;
    return this.uploader.multifileUpload(fileList, checkpoint, { ...options, isresume });
  }

  setListener(listener) {
    this.uploader.listen(listener);
  }
}

export class Downloader {
  constructor(token, timeout) {
    this.downloader = new DownloadClient(token, timeout);
  }
  // options : route, localpath
  start(fileList, options) {
    return this.downloader.downloadlist(fileList, options);
  }

  getErrorFiles() {
    return this.downloader.getErrorFiles();
  }

  getCompleteFiles() {
    return this.downloader.getCompleteFiles();
  }
}
