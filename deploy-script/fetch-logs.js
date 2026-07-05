const { NodeSSH } = require('node-ssh');
const ssh = new NodeSSH();

async function run() {
  try {
    await ssh.connect({
      host: '46.225.88.221',
      username: 'root',
      password: 'root@123#',
      tryKeyboard: true,
    });
    
    console.log('Fetching logs...');
    const res = await ssh.execCommand('pm2 logs manufacture-app --lines 100 --nostream');
    console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);
    
    ssh.dispose();
  } catch (err) {
    console.error('Error:', err);
    ssh.dispose();
  }
}
run();
