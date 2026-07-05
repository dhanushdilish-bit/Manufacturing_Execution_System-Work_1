const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, 'src', 'App.css');
let css = fs.readFileSync(cssPath, 'utf8');

const replacements = [
  // Text & Borders
  { regex: /#4b5a52/gi, replace: 'var(--text-main)' },
  { regex: /#526158/gi, replace: 'var(--text-muted)' },
  { regex: /#45524b/gi, replace: 'var(--text-main)' },
  { regex: /#92400e/gi, replace: 'var(--text-main)' },
  { regex: /#b6c5bc/gi, replace: 'var(--border)' },
  { regex: /#e0e5de/gi, replace: 'var(--border)' },
  
  // Backgrounds
  { regex: /#fbfcfa/gi, replace: 'rgba(255, 255, 255, 0.05)' },
  { regex: /#f3f5f1/gi, replace: 'rgba(255, 255, 255, 0.05)' },
  { regex: /#edf2ef/gi, replace: 'rgba(255, 255, 255, 0.08)' },
  
  // Notices
  { regex: /#ecf8f4/gi, replace: 'rgba(16, 185, 129, 0.1)' },
  { regex: /#0f5f55/gi, replace: '#34d399' },
  { regex: /#9ed4c7/gi, replace: 'rgba(16, 185, 129, 0.2)' },
  { regex: /#fff1f0/gi, replace: 'rgba(239, 68, 68, 0.1)' },
  { regex: /#9f1f17/gi, replace: '#f87171' },
  { regex: /#f0aaa5/gi, replace: 'rgba(239, 68, 68, 0.2)' },
  { regex: /#b42318/gi, replace: '#ef4444' },

  // Status Badges
  { regex: /#def7ec/gi, replace: 'rgba(16, 185, 129, 0.15)' },
  { regex: /#0f6848/gi, replace: '#34d399' },
  
  { regex: /#fff4d6/gi, replace: 'rgba(245, 158, 11, 0.15)' },
  { regex: /#8a5a00/gi, replace: '#fbbf24' },
  
  { regex: /#f3e8ff/gi, replace: 'rgba(168, 85, 247, 0.15)' },
  { regex: /#6b21a8/gi, replace: '#c084fc' },
  
  { regex: /#ffe3e0/gi, replace: 'rgba(239, 68, 68, 0.15)' },
  
  { regex: /#e7eefc/gi, replace: 'rgba(59, 130, 246, 0.15)' },
  { regex: /#294c92/gi, replace: '#60a5fa' }
];

for (const {regex, replace} of replacements) {
  css = css.replace(regex, replace);
}

// Make sure the active button in the sidebar handles text color correctly
css = css.replace(/button\.active,\s*\.primary-button \{\s*border-color: var\(--primary\);\s*background: var\(--primary\);\s*color: transparent;\s*\}/g, 
  'button.active, .primary-button {\n  border-color: var(--primary);\n  background: var(--primary);\n  color: #fff;\n}');

// Wait! If `color: transparent;` was already changed to `#fff;` by my previous script, I just need to verify.
// Let's just aggressively replace any `color: transparent;` inside active/primary to `#fff`.
css = css.replace(/color: transparent;/g, 'color: #fff;'); 
// The only place `color: transparent;` existed was inside `button.active` in the previous script! 
// Wait, my previous script did `#ffffff -> transparent`. That means text became transparent! Oh no!
// Let's fix that!
// My first script did: `{ regex: /#ffffff/gi, replace: 'transparent' }`
// So anywhere `#ffffff` was used (like in button texts or whatever), it became `transparent`!
// Let's reverse the bad `transparent` back to `var(--text-main)` or `var(--bg-panel)`.

// Revert transparent text in buttons
css = css.replace(/color: transparent/g, 'color: var(--text-main)');

fs.writeFileSync(cssPath, css, 'utf8');
console.log('CSS transformed second pass successfully.');
