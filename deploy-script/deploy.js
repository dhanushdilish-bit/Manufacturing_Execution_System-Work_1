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

    console.log('Connected to server! Starting deployment...');
    const remoteDir = '/var/www/manufacture';
    
    // Stop pm2 gracefully to prevent locking files
    await ssh.execCommand('pm2 stop manufacture-app', { cwd: remoteDir });

    // Clean old files (keep .env and data intact)
    console.log('Cleaning old build files...');
    await ssh.execCommand(`rm -rf ${remoteDir}/dist ${remoteDir}/server`, { cwd: remoteDir });
    
    // Upload files
    console.log('Uploading dist folder...');
    await ssh.putDirectory('../manufacturing_execution_system 2/dist', `${remoteDir}/dist`, {
      recursive: true,
      concurrency: 10
    });
    
    console.log('Uploading server folder...');
    await ssh.putDirectory('../manufacturing_execution_system 2/server', `${remoteDir}/server`, {
      recursive: true,
      concurrency: 10
    });
    
    console.log('Uploading package.json...');
    await ssh.putFile('../manufacturing_execution_system 2/package.json', `${remoteDir}/package.json`);
    await ssh.putFile('../manufacturing_execution_system 2/package-lock.json', `${remoteDir}/package-lock.json`);

    // NPM install & Restart
    console.log('Running npm install and restarting PM2...');
    const res = await ssh.execCommand('npm install --production && pm2 restart manufacture-app', { cwd: remoteDir });
    console.log(res.stdout);
    if (res.stderr) console.error(res.stderr);

    console.log('Deployment complete!');
    ssh.dispose();
  } catch (err) {
    console.error('Error during deployment:', err);
    ssh.dispose();
  }
}

run();
