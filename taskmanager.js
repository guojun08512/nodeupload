
import TaskQueue from './taskqueue';

export default class TaskManager {
  constructor(filehandle, fileList, joblist, options) {
    this.filehandle = filehandle;
    this.fileList = fileList;
    this.joblist = joblist;
    this.options = options;
    this.error = null;
  }

  getJob() {
    if (this.joblist && this.joblist.length > 0) {
      return this.joblist.pop();
    }
    return null;
  }

  getFileHandle() {
    return this.filehandle;
  }

  getCheckPoint() {
    return this.filehandle.checkpoint;
  }

  getOptions() {
    return this.options;
  }

  getFileList() {
    return this.fileList;
  }

  getPauseState() {
    return this.filehandle.isPause;
  }

  setFileHandlePause(flag) {
    this.filehandle.pauseUpload(flag);
  }

  async start() {
    if (this.getPauseState()) {
      this.filehandle.pauseId = false;
    }
    const tasks = [];
    for (let i = 0; i < 10; i += 1) {
      const taskQueue = new TaskQueue(this);
      tasks.push(taskQueue.do());
    }
    const res = await Promise.all(tasks);
    if (this.filehandle.error) {
      throw this.filehandle.error;
    }
    if (res[res.length - 1].indexOf('stop')) {
      this.filehandle.parseSuccess = true;
    } else {
      this.filehandle.parseSuccess = false;
    }
    console.log('res == ', res);
    return res;
  }
}
