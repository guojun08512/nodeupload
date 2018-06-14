
import ChildProcess from 'child_process';
import path from 'path';

export function runProcess(cmd, argv, options) {
  return new Promise((resolve, reject) => {
    const process = ChildProcess.spawn(cmd, argv, { cwd: options && options.cwd });
    const command = `${cmd} ${argv.join(' ')}`;
    let outdata = '';
    process.stdout.on('data', (data) => {
      const str = data.toString('utf-8');
      outdata += str;
    });
    process.stderr.on('data', (data) => {
      const str = data.toString('utf-8');
      throw new Error(str);
    });
    process.on('close', (code) => {
      if (code === 0) {
        resolve(outdata);
      } else {
        const message = `exec \`${command}\` failed with code ${code}.`;
        reject(new Error(message));
      }
    });
  });
}

export async function calcMD5(filepath) {
  const absolutePath = path.resolve(filepath);
  const outdata = await runProcess('md5sum', [absolutePath]);
  return outdata.split(' ')[0];
}
