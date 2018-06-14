
export default class TaskQueue {
  constructor(taskmanager) {
    this.taskmanager = taskmanager;
  }

  async do() {
    while (true) { // eslint-disable-line
      try {
        return this.consumer();
      } catch (err) {
        this.taskmanager.error = err;
      }
    }
  }

  consumer() {
    const runningJob = this.taskmanager.getJob();
    const parseState = this.taskmanager.getPauseState();
    console.log('parseState ==', parseState);
    this.taskmanager.setFileHandlePause(parseState);
    if (parseState) {
      return 'stop';
    }
    if (!runningJob) {
      return 'complete';
    }
    if (this.taskmanager.error) {
      return 'error';
    }

    const fileList = this.taskmanager.getFileList();
    const handle = this.taskmanager.getFileHandle();
    const options = this.taskmanager.getOptions();
    return handle.uploadfileJob(fileList, runningJob, options);
  }
}
