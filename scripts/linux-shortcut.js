// Adds JobPilot to the Linux app menu and the Desktop: node scripts/linux-shortcut.js
const fs = require('fs'), os = require('os'), path = require('path');
const root = path.join(__dirname, '..');
const icon = path.join(root, 'assets', 'icon.svg');
const entry = `[Desktop Entry]\nType=Application\nName=JobPilot\nComment=Find jobs and prepare applications\nExec=${path.join(root, 'start.sh')}\nIcon=${icon}\nTerminal=true\nCategories=Office;\n`;
for (const dir of [path.join(os.homedir(), '.local/share/applications'), path.join(os.homedir(), 'Desktop')]) {
  if (!fs.existsSync(dir)) continue;
  const f = path.join(dir, 'jobpilot.desktop');
  fs.writeFileSync(f, entry, { mode: 0o755 });
  console.log('created', f);
}
console.log('On the Desktop you may need to right-click the icon and choose "Allow Launching" once.');
